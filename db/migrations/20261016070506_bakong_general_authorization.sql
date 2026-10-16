-- LOCAL CANDIDATE. No authorization rows, provider calls, flags, or payment writes.
-- Expand first, deploy compatible readers, then separately approve an operator authorization.
-- Rollback: stop new checkout; retain evidence/schema/caps and allow saved-payment reconciliation.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';

create temporary table bakong_contract_before on commit drop as
select p.oid,p.proname,p.proacl,p.proowner,p.prosecdef,p.proconfig,
  replace(pg_get_functiondef(p.oid),chr(13),'') as source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('tenh_bakong_capacity','tenh_prepare_bakong_payment','tenh_claim_bakong_check');
do $preflight$
begin
  if current_user not in ('postgres','supabase_admin') or not public.tenh_payment_application_guards_ready()
    or (select count(*) from bakong_contract_before)<>3 or exists(
      select 1 from bakong_contract_before where pg_get_userbyid(proowner)<>'postgres' or not prosecdef
        or has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('authenticated',oid,'EXECUTE')
        or not has_function_privilege('service_role',oid,'EXECUTE') or proconfig is distinct from array['search_path=""']
        or md5(source)<>case proname when 'tenh_bakong_capacity' then '3b6add16029595ca51839b16a00e2df1'
          when 'tenh_prepare_bakong_payment' then '5a8e24c0b490ef0bb5d8785bda3aa567'
          when 'tenh_claim_bakong_check' then '9e28b273066812e763e78dafe2ce47c1' end) then
    raise exception 'Review the installed Bakong contracts, request_time repair and grants';
  end if;
end $preflight$;

-- Operator risk acceptance is explicitly different from a provider-verified capacity review.
-- General scope: every otherwise-authorized managed workspace; no pilot user/workspace allowlist.
create table tenh_bakong_private.general_authorizations (
  id uuid primary key default gen_random_uuid(),
  credential_fingerprint text not null check(credential_fingerprint ~ '^[a-f0-9]{64}$'),
  recipient text not null check(length(trim(recipient))>0),
  environment text not null check(environment='production'),
  quota_source text not null check(quota_source='user-attested'),
  reported_daily_limit integer not null check(reported_daily_limit=100),
  allocated_daily_budget integer not null check(allocated_daily_budget between 3 and 90),
  dedicated_token_attested boolean not null check(dedicated_token_attested),
  provider_eligibility text not null check(provider_eligibility='not-independently-verified'),
  approved_by uuid not null, approval_reference text not null check(length(trim(approval_reference))>0),
  attestation_reference text not null check(length(trim(attestation_reference))>0),
  authorized_at timestamptz not null default clock_timestamp(), revoked_at timestamptz,
  check(allocated_daily_budget<=reported_daily_limit-10), check(revoked_at is null or revoked_at>=authorized_at)
);
create unique index bakong_active_general_authorization on tenh_bakong_private.general_authorizations(credential_fingerprint,recipient)
  where revoked_at is null;
alter table tenh_bakong_private.general_authorizations enable row level security;
create table tenh_bakong_private.general_authorization_audit (
  id bigint generated always as identity primary key, authorization_id uuid not null,
  event text not null, database_actor text not null, occurred_at timestamptz not null default clock_timestamp()
);
alter table tenh_bakong_private.general_authorization_audit enable row level security;
create trigger bakong_immutable_general_audit before update or delete on tenh_bakong_private.general_authorization_audit
  for each row execute function tenh_billing_private.deny_audit_mutation();
create function tenh_bakong_private.protect_general_authorization() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Retain general authorization evidence'; end if;
  if tg_op='UPDATE' and ((to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
    or old.revoked_at is not null or new.revoked_at is null) then raise exception 'Only one-way revocation is allowed'; end if;
  insert into tenh_bakong_private.general_authorization_audit(authorization_id,event,database_actor)
    values(new.id,case when tg_op='INSERT' then 'operator-authorized' else 'revoked' end,current_user);
  return new;
end $$;
create trigger bakong_protect_general_authorization before insert or update or delete on tenh_bakong_private.general_authorizations
  for each row execute function tenh_bakong_private.protect_general_authorization();

create index bakong_calls_attempt_lifetime on tenh_bakong_private.provider_calls(attempt_id);
-- Failed, timed-out and abandoned claims remain counted for the entire attempt lifetime.
create function tenh_bakong_private.reserved_inquiries(p_environment text,p_exclude uuid default null) returns integer
language sql stable security definer set search_path='' as $$
  select coalesce(sum(greatest(0,3-(select count(*) from tenh_bakong_private.provider_calls c where c.attempt_id=a.id))),0)::integer
  from public.bakong_payment_attempts a where a.environment=p_environment and a.state in ('pending','review')
    and a.verified_hash is null and (p_exclude is null or a.id<>p_exclude)
$$;

create or replace function public.tenh_bakong_capacity(p_fingerprint text,p_environment text,p_recipient text,p_budget integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r tenh_bakong_private.capacity_reviews%rowtype; g tenh_bakong_private.general_authorizations%rowtype;
  n integer; used integer; reserved integer; can_verify boolean; basis text:='sandbox';
begin
  if p_budget is null or p_budget not between 1 and 10000 then return jsonb_build_object('eligible',false,'budget',0); end if;
  if p_environment='sandbox' then n:=least(90,p_budget);
  elsif p_environment='production' then
    select * into r from tenh_bakong_private.capacity_reviews where credential_fingerprint=p_fingerprint and recipient=p_recipient and production_eligible;
    if found then
      n:=least(90,p_budget,r.allocated_daily_limit-10,r.verified_daily_limit-10); basis:='provider-reviewed';
      if n<r.required_daily_requests then return jsonb_build_object('eligible',false,'budget',0); end if;
    else
      select * into g from tenh_bakong_private.general_authorizations where credential_fingerprint=p_fingerprint and recipient=p_recipient
        and environment=p_environment and revoked_at is null and authorized_at<=clock_timestamp();
      if not found then return jsonb_build_object('eligible',false,'budget',0); end if;
      n:=least(90,p_budget,g.allocated_daily_budget,g.reported_daily_limit-10); basis:='operator-attested';
    end if;
  else return jsonb_build_object('eligible',false,'budget',0); end if;
  select count(*) into used from tenh_bakong_private.provider_calls where environment=p_environment and counted_at>clock_timestamp()-interval '24 hours';
  reserved:=tenh_bakong_private.reserved_inquiries(p_environment);
  can_verify:=not exists(select 1 from tenh_bakong_private.request_budgets where budget_key='khqr:'||p_environment
    and (invalid_credentials=p_fingerprint or blocked_until>clock_timestamp()+interval '5 minutes'));
  return jsonb_build_object('eligible',true,'budget',n,'approvalBasis',basis,
    'providerEligibility',case when basis='operator-attested' then 'not-independently-verified' when basis='provider-reviewed' then 'reviewed' else 'sandbox' end,
    'canVerify',can_verify,'canIssue',can_verify and used+reserved+3<=n);
end $$;

-- Patch only the reviewed preparation/claim contracts; retain OIDs, ACLs, financial guards and lock order.
do $contracts$
declare s text; original text; replacement text;
begin
  select source into s from bakong_contract_before where proname='tenh_prepare_bakong_payment';
  original:=$old$pilot:=tenh_bakong_private.authorize_pilot(p_record,p_actor,p_member,p_selection,p_environment,p_fingerprint,p_recipient,p_expires_at);
  if pilot is null then cap:=public.tenh_bakong_capacity(p_fingerprint,p_environment,p_recipient,p_budget); else$old$;
  replacement:=$new$cap:=public.tenh_bakong_capacity(p_fingerprint,p_environment,p_recipient,p_budget);
  if cap->>'eligible' is distinct from 'true' then
    pilot:=tenh_bakong_private.authorize_pilot(p_record,p_actor,p_member,p_selection,p_environment,p_fingerprint,p_recipient,p_expires_at);
  end if;
  if pilot is not null then$new$;
  if strpos(s,original)=0 then raise exception 'Preparation capacity clause missing'; end if;
  s:=replace(s,original,replacement);
  original:=$old$select coalesce(sum(greatest(0,3-check_count)),0) into reserved from public.bakong_payment_attempts
    where environment=p_environment and state in ('pending','review') and verified_hash is null;$old$;
  if strpos(s,original)=0 then raise exception 'Preparation reservation clause missing'; end if;
  execute replace(s,original,'reserved:=tenh_bakong_private.reserved_inquiries(p_environment);');

  select source into s from bakong_contract_before where proname='tenh_claim_bakong_check';
  original:='  cap:=tenh_bakong_private.pilot_check_capacity(p_attempt,p_fingerprint,p_budget);';
  replacement:=$new$  select count(*) into n from tenh_bakong_private.provider_calls where attempt_id=p_attempt;
  if n>=3 then return jsonb_build_object('claimed',false,'reason','INQUIRY_LIMIT_REVIEW'); end if;
  cap:=tenh_bakong_private.pilot_check_capacity(p_attempt,p_fingerprint,p_budget);$new$;
  if strpos(s,original)=0 then raise exception 'Claim capacity clause missing'; end if;
  s:=replace(s,original,replacement);
  original:=$old$select coalesce(sum(greatest(0,3-check_count)),0) into reserved from public.bakong_payment_attempts
    where environment=a.environment and state in ('pending','review') and verified_hash is null and id<>p_attempt;$old$;
  if strpos(s,original)=0 then raise exception 'Claim reservation clause missing'; end if;
  execute replace(s,original,'reserved:=tenh_bakong_private.reserved_inquiries(a.environment,p_attempt);');
end $contracts$;

-- Read-only UI/admin status. The atomic claim above remains authoritative under races.
create function public.tenh_bakong_inquiry_status(p_attempt uuid,p_fingerprint text,p_budget integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.bakong_payment_attempts%rowtype; r tenh_bakong_private.pilot_authorizations%rowtype;
  b tenh_bakong_private.request_budgets%rowtype; cap jsonb; n integer; used integer; oldest timestamptz; reason text; next_at timestamptz;
begin
  select * into a from public.bakong_payment_attempts where id=p_attempt;
  if not found then return jsonb_build_object('canCheck',false,'inquiriesRemaining',0,'reconciliationRequired',true,'reason','missing'); end if;
  if a.state='verified' then return jsonb_build_object('canCheck',true,'inquiriesRemaining',0,'reconciliationRequired',false); end if;
  if a.state in ('applied','test_paid') then return jsonb_build_object('canCheck',false,'inquiriesRemaining',0,'reconciliationRequired',false); end if;
  select count(*) into n from tenh_bakong_private.provider_calls where attempt_id=p_attempt;
  select * into b from tenh_bakong_private.request_budgets where budget_key='khqr:'||a.environment;
  next_at:=greatest(a.next_check_at,a.lease_until,b.blocked_until);
  if a.verified_hash is not null then reason:=coalesce(a.reason,'SETTLEMENT_REVIEW');
  elsif n>=3 then reason:='INQUIRY_LIMIT_REVIEW';
  elsif p_budget is null or p_budget not between 1 and 10000 then reason:='VERIFICATION_UNAVAILABLE';
  elsif a.pilot_authorization_id is not null then
    select * into r from tenh_bakong_private.pilot_authorizations where id=a.pilot_authorization_id and attempt_id=a.id;
    if not found or r.revoked_at is not null or r.inquiry_until<=clock_timestamp() or r.credential_fingerprint<>p_fingerprint then
      reason:='PILOT_AUTHORIZATION_REVIEW';
    else cap:=jsonb_build_object('eligible',true,'budget',least(90,p_budget,r.reported_daily_limit-10),'canVerify',true); end if;
  else cap:=public.tenh_bakong_capacity(p_fingerprint,a.environment,a.recipient,p_budget);
  end if;
  if reason is null then
    if cap->>'eligible' is distinct from 'true' or cap->>'canVerify' is distinct from 'true'
      or b.invalid_credentials=p_fingerprint then reason:='VERIFICATION_UNAVAILABLE';
    else
      select count(*),min(counted_at) into used,oldest from tenh_bakong_private.provider_calls
        where environment=a.environment and counted_at>clock_timestamp()-interval '24 hours';
      if used+tenh_bakong_private.reserved_inquiries(a.environment,p_attempt)+1>(cap->>'budget')::integer then
        reason:='DAILY_BUDGET_REVIEW'; next_at:=greatest(next_at,oldest+interval '24 hours');
      elsif b.blocked_until>clock_timestamp()+interval '5 minutes' then reason:='VERIFICATION_UNAVAILABLE'; end if;
    end if;
  end if;
  return jsonb_build_object('canCheck',reason is null,'inquiriesRemaining',greatest(0,3-n),
    'reconciliationRequired',reason is not null,'reason',reason,'nextCheckAt',next_at);
end $$;

revoke all on table tenh_bakong_private.general_authorizations,tenh_bakong_private.general_authorization_audit from public,anon,authenticated,service_role;
revoke all on sequence tenh_bakong_private.general_authorization_audit_id_seq from public,anon,authenticated,service_role;
revoke all on function tenh_bakong_private.protect_general_authorization(),tenh_bakong_private.reserved_inquiries(text,uuid),
  public.tenh_bakong_inquiry_status(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.tenh_bakong_inquiry_status(uuid,text,integer) to service_role;
do $preservation$
begin
  if exists(select 1 from bakong_contract_before b left join pg_proc p on p.oid=b.oid
    where p.oid is null or row(p.proacl,p.proowner,p.prosecdef,p.proconfig) is distinct from row(b.proacl,b.proowner,b.prosecdef,b.proconfig)) then
    raise exception 'Bakong RPC identity or permissions changed'; end if;
end $preservation$;
commit;
