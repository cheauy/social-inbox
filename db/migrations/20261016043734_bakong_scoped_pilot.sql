-- LOCAL REVIEW DRAFT ONLY. No authorization rows, quota approvals, or hosted execution.
-- Requires the installed Bakong/payment-baseline contracts. Keep both checkout flags false.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
do $preflight$
begin
  if current_user not in ('postgres','supabase_admin') or not public.tenh_payment_application_guards_ready() then
    raise exception 'Trusted owner and installed payment guards are required'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('tenh_prepare_bakong_payment','tenh_claim_bakong_check') and p.prosecdef
    and pg_get_userbyid(p.proowner)='postgres' and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not has_function_privilege('authenticated',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE'))<>2 then
    raise exception 'Review Bakong RPC ownership and permissions before pilot installation'; end if;
end
$preflight$;

-- This is deliberately one named experiment, not a general-purpose capacity approval.
create table tenh_bakong_private.pilot_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null check(user_id='6b84cd6d-deb5-4191-b1c6-0f3861eda892'),
  business_id uuid not null unique check(business_id='f79eeac0-db5e-4f3f-8783-2dfb9b818dd9'),
  member_id uuid not null, credential_fingerprint text not null check(credential_fingerprint ~ '^[a-f0-9]{64}$'),
  recipient text not null check(length(trim(recipient))>0),
  baseline jsonb not null, approved_quote jsonb not null,
  approved_max_cents integer not null check(approved_max_cents between 1 and 3253),
  approved_by uuid not null, approval_reference text not null check(length(trim(approval_reference))>0),
  authorized_at timestamptz not null default clock_timestamp(), issue_until timestamptz not null, inquiry_until timestamptz not null,
  quota_source text not null check(quota_source='user-attested'), reported_daily_limit integer not null check(reported_daily_limit=100),
  dedicated_token_attested boolean not null check(dedicated_token_attested),
  provider_eligibility text not null check(provider_eligibility='not-independently-verified'),
  attestation_reference text not null check(length(trim(attestation_reference))>0),
  attempt_id uuid unique references public.bakong_payment_attempts(id), issued_quote jsonb, revoked_at timestamptz,
  check(issue_until>authorized_at and issue_until<=authorized_at+interval '30 minutes'),
  check(inquiry_until>=issue_until+interval '16 minutes' and inquiry_until<=authorized_at+interval '1 hour'),
  check((attempt_id is null)=(issued_quote is null)),
  check((approved_quote->>'currentConnections'='12' and approved_quote->>'currentUsers'='8'
    and approved_quote->>'targetConnections'='13' and approved_quote->>'targetUsers'='8'
    and approved_quote->>'targetBillingCycle'='12-months' and approved_quote->>'extensionMonths'='0'
    and approved_quote->>'durationExtensionCents'='0' and (approved_quote->>'totalCents')::integer=approved_max_cents) is true)
);
alter table tenh_bakong_private.pilot_authorizations enable row level security;
alter table public.bakong_payment_attempts add column pilot_authorization_id uuid references tenh_bakong_private.pilot_authorizations(id);
create table tenh_bakong_private.pilot_audit (
  id bigint generated always as identity primary key, authorization_id uuid not null,
  event text not null, database_actor text not null, occurred_at timestamptz not null default clock_timestamp()
);
alter table tenh_bakong_private.pilot_audit enable row level security;
create trigger bakong_immutable_pilot_audit before update or delete on tenh_bakong_private.pilot_audit
  for each row execute function tenh_billing_private.deny_audit_mutation();

create function tenh_bakong_private.protect_pilot() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Retain pilot authorization and payment evidence'; end if;
  if tg_op='UPDATE' and ((to_jsonb(new)-array['attempt_id','issued_quote','revoked_at']) is distinct from
      (to_jsonb(old)-array['attempt_id','issued_quote','revoked_at'])
    or (old.attempt_id is not null and row(new.attempt_id,new.issued_quote) is distinct from row(old.attempt_id,old.issued_quote))
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)) then
    raise exception 'Pilot approval, consumption and revocation are immutable';
  end if;
  insert into tenh_bakong_private.pilot_audit(authorization_id,event,database_actor)
    values(new.id,case when tg_op='INSERT' then 'authorized' when new.revoked_at is not null and old.revoked_at is null then 'revoked' else 'consumed' end,current_user);
  return new;
end $$;
create trigger bakong_protect_pilot before insert or update or delete on tenh_bakong_private.pilot_authorizations
  for each row execute function tenh_bakong_private.protect_pilot();

-- The caller already holds the global budget and subscription locks. No browser-supplied approval ID.
create function tenh_bakong_private.authorize_pilot(p_record jsonb,p_actor uuid,p_member uuid,p_selection jsonb,
  p_environment text,p_fingerprint text,p_recipient text,p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare r tenh_bakong_private.pilot_authorizations%rowtype; q jsonb:=p_record->'pricing_snapshot';
begin
  select * into r from tenh_bakong_private.pilot_authorizations where business_id=(p_record->>'business_id')::uuid for update;
  if not found then return null; end if;
  if p_actor is distinct from r.user_id or p_member is distinct from r.member_id or p_environment is distinct from 'production'
    or p_fingerprint is distinct from r.credential_fingerprint or p_recipient is distinct from r.recipient
    or r.attempt_id is not null or r.revoked_at is not null or r.issue_until<=clock_timestamp() or r.authorized_at>clock_timestamp()
    or p_expires_at>r.inquiry_until then raise exception 'Pilot authorization unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.team_members where id=r.member_id and user_id=r.user_id and business_id=r.business_id and is_active and role='owner')
    then raise exception 'Pilot owner access revoked' using errcode='42501'; end if;
  if public.tenh_compat_subscription_identity(p_record->'_expected_subscription') is distinct from r.baseline
    or r.baseline->>'plan_code' is distinct from 'pro' or r.baseline->>'status' is distinct from 'active'
    or r.baseline->>'channel_limit' is distinct from '12' or r.baseline->>'member_limit' is distinct from '8'
    or (r.baseline->>'current_period_end')::numeric is distinct from extract(epoch from '2027-08-21T10:03:56.418985Z'::timestamptz)
    or p_selection is distinct from '{"planCode":"custom","billingCycle":"12-months","connections":13,"users":8,"renewSame":false,"customUpgrade":true,"extensionBillingCycle":"none"}'::jsonb
    or p_record->>'plan_code' is distinct from 'custom' or p_record->>'billing_cycle' is distinct from '12-months'
    or p_record->>'target_member_limit' is distinct from '8' or p_record->>'target_channel_limit' is distinct from '13'
    or p_record->>'currency' is distinct from 'USD' or (p_record->>'amount')::numeric*100>r.approved_max_cents
    or q->>'purchase_type' is distinct from 'custom-upgrade' or q->>'custom_upgrade_version' is distinct from '2'
    or q->>'extension_months' is distinct from '0' or q->>'duration_extension_cents' is distinct from '0'
    or extract(epoch from (q->>'new_period_end')::timestamptz) is distinct from trunc((r.baseline->>'current_period_end')::numeric,3)
    or q->>'monthly_cents' is distinct from r.approved_quote->>'targetMonthlyCents'
    or extract(epoch from (r.approved_quote->>'currentPeriodEnd')::timestamptz) is distinct from trunc((r.baseline->>'current_period_end')::numeric,3)
    or extract(epoch from (r.approved_quote->>'newPeriodEnd')::timestamptz) is distinct from trunc((r.baseline->>'current_period_end')::numeric,3) then
    raise exception 'Pilot quote or subscription differs from the approved scope' using errcode='22023';
  end if;
  -- Existing billing triggers still validate the exact fresh server amount and paid-term basis.
  return r.id;
end $$;

create function public.tenh_bakong_pilot_status(p_actor uuid,p_business uuid,p_member uuid,p_fingerprint text,p_recipient text,p_attempt uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r tenh_bakong_private.pilot_authorizations%rowtype; n integer; allowed boolean; verify boolean;
begin
  select * into r from tenh_bakong_private.pilot_authorizations where business_id=p_business;
  if not found then return jsonb_build_object('pilot',false,'eligible',false); end if;
  select count(*) into n from tenh_bakong_private.provider_calls where attempt_id=r.attempt_id;
  allowed:=r.user_id=p_actor and r.member_id=p_member and r.credential_fingerprint=p_fingerprint and r.recipient=p_recipient
    and r.revoked_at is null and r.authorized_at<=clock_timestamp() and r.inquiry_until>clock_timestamp()
    and exists(select 1 from public.team_members where id=p_member and user_id=p_actor and business_id=p_business and is_active and role='owner');
  verify:=allowed and n<3 and (p_attempt is null or p_attempt=r.attempt_id)
    and not exists(select 1 from tenh_bakong_private.request_budgets where budget_key='khqr:production'
      and (invalid_credentials=p_fingerprint or blocked_until>clock_timestamp()+interval '5 minutes'));
  return jsonb_build_object('pilot',true,'eligible',allowed,'canIssue',verify and r.attempt_id is null and r.issue_until>clock_timestamp()
    and r.inquiry_until>clock_timestamp()+interval '16 minutes','canVerify',verify and r.attempt_id is not null,
    'inquiriesRemaining',case when allowed then greatest(0,3-n) else 0 end);
end $$;

-- Claim accounting is lifetime, not a resettable UI counter or a rolling daily allowance.
create function tenh_bakong_private.pilot_check_capacity(p_attempt uuid,p_fingerprint text,p_budget integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r tenh_bakong_private.pilot_authorizations%rowtype; n integer;
begin
  select * into r from tenh_bakong_private.pilot_authorizations where attempt_id=p_attempt for update;
  if not found then return null; end if;
  select count(*) into n from tenh_bakong_private.provider_calls where attempt_id=p_attempt;
  return jsonb_build_object('eligible',r.revoked_at is null and r.inquiry_until>clock_timestamp() and n<3
    and r.credential_fingerprint=p_fingerprint and p_budget between 1 and 10000,
    'budget',least(p_budget,r.reported_daily_limit-10),'canVerify',n<3);
end $$;

-- Preserve the existing RPC signatures/OIDs, idempotency, lock order and financial insert triggers.
-- Abort instead of patching an unknown installed contract.
do $contracts$
declare s text; original text; replacement text;
begin
  s:=pg_get_functiondef('public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer)'::regprocedure);
  original:='cap:=public.tenh_bakong_capacity(p_fingerprint,p_environment,p_recipient,p_budget);';
  if strpos(s,original)=0 or strpos(s,'if used+reserved+3>')=0 or strpos(s,'pid,p_actor,''prepared''')=0 then
    raise exception 'Review the installed Bakong preparation contract'; end if;
  s:=replace(s,'reserved integer;','reserved integer; pilot uuid;');
  replacement:='pilot:=tenh_bakong_private.authorize_pilot(p_record,p_actor,p_member,p_selection,p_environment,p_fingerprint,p_recipient,p_expires_at);
  if pilot is null then '||original||' else
    if p_budget is null or p_budget not between 1 and 10000 then raise exception ''Invalid pilot request budget''; end if;
    cap:=jsonb_build_object(''eligible'',true,''budget'',least(p_budget,90),''canVerify'',not exists(
      select 1 from tenh_bakong_private.request_budgets where budget_key=''khqr:production''
      and (invalid_credentials=p_fingerprint or blocked_until>clock_timestamp()+interval ''5 minutes'')));
  end if;';
  s:=replace(s,original,replacement);
  if strpos(s,'expires_at,baseline)')=0 or strpos(s,'public.tenh_compat_subscription_identity(to_jsonb(s))) returning * into a;')=0 then
    raise exception 'Review the installed Bakong attempt insert contract'; end if;
  s:=replace(s,'expires_at,baseline)','expires_at,baseline,pilot_authorization_id)');
  s:=replace(s,'public.tenh_compat_subscription_identity(to_jsonb(s))) returning * into a;',
    'public.tenh_compat_subscription_identity(to_jsonb(s)),pilot) returning * into a;');
  s:=replace(s,'insert into tenh_bakong_private.events(attempt_id,actor_user_id,event) values(pid,p_actor,''prepared'');',
    'if pilot is not null then
      update tenh_bakong_private.pilot_authorizations set attempt_id=pid,issued_quote=p_record where id=pilot;
    end if;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event) values(pid,p_actor,''prepared'');');
  execute s;
  s:=pg_get_functiondef('public.tenh_claim_bakong_check(uuid,text,integer)'::regprocedure);
  original:='cap:=public.tenh_bakong_capacity(p_fingerprint,a.environment,a.recipient,p_budget);';
  if strpos(s,original)=0 or strpos(s,'check_count=check_count+1')=0 then raise exception 'Review the installed Bakong claim contract'; end if;
  s:=replace(s,original,'cap:=tenh_bakong_private.pilot_check_capacity(p_attempt,p_fingerprint,p_budget);
  if cap is null then '||original||' end if;');
  execute s;
end
$contracts$;

revoke all on table tenh_bakong_private.pilot_authorizations,tenh_bakong_private.pilot_audit from public,anon,authenticated,service_role;
revoke all on sequence tenh_bakong_private.pilot_audit_id_seq from public,anon,authenticated,service_role;
revoke all on function tenh_bakong_private.protect_pilot(),
  tenh_bakong_private.authorize_pilot(jsonb,uuid,uuid,jsonb,text,text,text,timestamptz),
  tenh_bakong_private.pilot_check_capacity(uuid,text,integer),
  public.tenh_bakong_pilot_status(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.tenh_bakong_pilot_status(uuid,uuid,uuid,text,text,uuid) to service_role;
commit;
