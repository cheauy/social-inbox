-- FORWARD REVIEW DRAFT. No hosted execution, activation, quota approval or backfill.
-- Requires the reviewed coexistence core, manual-upload and application-baseline migrations.
-- Keep Bakong checkout disabled until NBC/bank eligibility and the allocated quota are reviewed.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
create schema tenh_bakong_private;
revoke all on schema tenh_bakong_private from public,anon,authenticated,service_role;

-- A tenant's existing table grants cannot turn a browser JWT into a payment writer.
create function tenh_bakong_private.protect_billing_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (tg_op<>'DELETE' and new.provider='bakong') or (tg_op<>'INSERT' and old.provider='bakong') then
    if current_user not in ('postgres','supabase_admin','service_role') then raise exception 'Bakong writes require a trusted billing service' using errcode='42501'; end if;
    if tg_op='UPDATE' and old.provider='bakong' and
      row(new.id,new.business_id,new.provider,new.provider_transaction_id,new.amount,new.currency,new.plan_code,new.billing_cycle,new.target_member_limit,new.target_channel_limit,new.pricing_snapshot,new.renew_same)
      is distinct from row(old.id,old.business_id,old.provider,old.provider_transaction_id,old.amount,old.currency,old.plan_code,old.billing_cycle,old.target_member_limit,old.target_channel_limit,old.pricing_snapshot,old.renew_same) then
      raise exception 'Issued Bakong purchase identity is immutable'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger bakong_trusted_billing_write before insert or update or delete on public.billing_transactions
  for each row execute function tenh_bakong_private.protect_billing_write();

-- Reuse the installed, reviewed financial algorithm without presenting Bakong as PayWay.
-- Existing PayWay/manual activation bodies remain unchanged. Unknown contracts fail installation.
do $contracts$
declare s text; item record; c record; col smallint; typ oid;
begin
  if current_user not in ('postgres','supabase_admin') then raise exception 'Trusted database owner review is required'; end if;
  if not public.tenh_payment_application_guards_ready() then raise exception 'Billing application guards are required'; end if;
  s:=pg_get_functiondef('tenh_billing_private.activate_payway_v2(text,numeric,numeric,text,text,integer,text,jsonb,boolean)'::regprocedure);
  if strpos(s,'v_purchase_type')=0 or strpos(s,'payway_verified_payload')=0 or strpos(s,'v_tx.pricing_snapshot')=0 then
    raise exception 'Review the installed activation contract before adapting Bakong'; end if;
  s:=regexp_replace(s,'^CREATE OR REPLACE FUNCTION [^(]+','CREATE OR REPLACE FUNCTION tenh_bakong_private.apply_subscription');
  s:=replace(replace(replace(replace(s,'''payway''','''bakong'''),'payway_verified_payload','bakong_verified_payload'),'tenh-payway-activate:','tenh-bakong-activate:'),'PayWay','Bakong');
  execute s;
  s:=pg_get_functiondef('public.tenh_issue_billing_invoice(text,uuid)'::regprocedure);
  if strpos(s,'public.billing_transactions')=0 or strpos(s,'''payway''')=0 then raise exception 'Review the installed invoice contract'; end if;
  execute regexp_replace(s,'^CREATE OR REPLACE FUNCTION [^(]+','CREATE OR REPLACE FUNCTION tenh_bakong_private.issue_existing_invoice');
  s:=regexp_replace(s,'^CREATE OR REPLACE FUNCTION [^(]+','CREATE OR REPLACE FUNCTION tenh_bakong_private.issue_bakong_invoice');
  execute replace(replace(replace(s,'''payway''','''bakong'''),'payway_verified_payload','bakong_verified_payload'),'ABA PayWay','Bakong KHQR');
  s:=pg_get_functiondef('public.tenh_guard_pending_payment_claim()'::regprocedure);
  if strpos(s,'new.provider <> ''payway''')=0 or strpos(s,'provider = ''payway'' and status = ''pending''')=0 then raise exception 'Review the installed pending-claim contract'; end if;
  execute replace(replace(replace(s,'new.provider <> ''payway''','new.provider not in (''payway'',''bakong'')'),
    'old.provider = ''payway''','old.provider in (''payway'',''bakong'')'),
    'provider = ''payway'' and status = ''pending''','provider in (''payway'',''bakong'') and status = ''pending''');
  s:=pg_get_functiondef('public.tenh_set_custom_upgrade_invoice_period()'::regprocedure);
  if strpos(s,'new.source_type = ''payway''')=0 then raise exception 'Review custom invoice periods'; end if;
  execute replace(s,'new.source_type = ''payway''','new.source_type in (''payway'',''bakong'')');
  for item in select * from (values ('billing_transactions','provider'),('business_subscriptions','payment_provider'),
      ('tenh_billing_invoices','provider'),('tenh_billing_invoices','source_type')) as x(tbl,field) loop
    select attnum,atttypid into col,typ from pg_attribute where attrelid=('public.'||item.tbl)::regclass and attname=item.field and not attisdropped;
    if col is null or typ not in ('text'::regtype,'varchar'::regtype) then raise exception 'Review provider column type: %.%',item.tbl,item.field; end if;
    for c in select conname,pg_get_expr(conbin,conrelid) as expr from pg_constraint
      where conrelid=('public.'||item.tbl)::regclass and contype='c' and conkey=array[col] loop
      execute format('alter table public.%I drop constraint %I',item.tbl,c.conname);
      execute format('alter table public.%I add constraint %I check ((%s) or %I = ''bakong'')',item.tbl,c.conname,c.expr,item.field);
    end loop;
  end loop;
end
$contracts$;

create table public.bakong_payment_attempts (
  id uuid primary key references public.billing_transactions(id), business_id uuid not null,
  user_id uuid not null, member_id uuid not null, intent_id uuid not null, selection jsonb not null,
  environment text not null check(environment in ('sandbox','production')), credential_fingerprint text not null,
  recipient text not null, amount numeric(18,2) not null check(amount>0), currency text not null check(currency='USD'),
  reference text not null unique, qr text not null, md5 text not null unique check(md5 ~ '^[a-f0-9]{32}$'),
  expires_at timestamptz not null, baseline jsonb not null,
  state text not null default 'pending' check(state in ('pending','verified','applied','review','test_paid')),
  verified_hash text unique check(verified_hash ~ '^[a-f0-9]{64}$'), verified_at timestamptz,
  evidence jsonb, reason text, next_check_at timestamptz not null default clock_timestamp(),
  check_count integer not null default 0, failure_count integer not null default 0, lease_id uuid,
  lease_until timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(business_id,user_id,intent_id)
);
alter table public.bakong_payment_attempts enable row level security;
revoke all on public.bakong_payment_attempts from public,anon,authenticated;
grant select on public.bakong_payment_attempts to service_role;
create index bakong_attempt_workspace on public.bakong_payment_attempts(business_id,created_at desc,id);

create function tenh_bakong_private.protect_attempt_identity() returns trigger language plpgsql set search_path='' as $$
declare mutable text[]:=array['state','verified_hash','verified_at','evidence','reason','next_check_at','check_count','failure_count','lease_id','lease_until','updated_at'];
begin
  if (to_jsonb(new)-mutable) is distinct from (to_jsonb(old)-mutable)
    or (old.verified_hash is not null and (new.verified_hash is distinct from old.verified_hash or new.evidence is distinct from old.evidence or new.verified_at is distinct from old.verified_at)) then
    raise exception 'Issued KHQR identity and settlement evidence are immutable'; end if;
  return new;
end $$;
create trigger bakong_immutable_attempt_identity before update on public.bakong_payment_attempts
  for each row execute function tenh_bakong_private.protect_attempt_identity();

create table tenh_bakong_private.capacity_reviews (
  credential_fingerprint text primary key, recipient text not null, environment text not null check(environment='production'),
  production_eligible boolean not null default false, verified_daily_limit integer not null check(verified_daily_limit>0),
  allocated_daily_limit integer not null check(allocated_daily_limit between 1 and verified_daily_limit),
  required_daily_requests integer not null check(required_daily_requests>0),
  review_reference text not null check(length(trim(review_reference))>0), reviewed_by uuid not null, reviewed_at timestamptz not null,
  check(allocated_daily_limit>=required_daily_requests+10)
);
-- No approval row is seeded. Token possession is not eligibility or capacity evidence.
create table tenh_bakong_private.request_budgets (
  budget_key text primary key, blocked_until timestamptz, invalid_credentials text
);
create table tenh_bakong_private.provider_calls (
  id uuid primary key, fingerprint text not null, environment text not null check(environment in ('sandbox','production')), attempt_id uuid not null,
  counted_at timestamptz not null default clock_timestamp(), completed_at timestamptz, outcome text
);
create index bakong_calls_rolling_budget on tenh_bakong_private.provider_calls(environment,counted_at);
create table tenh_bakong_private.events (
  id bigint generated always as identity primary key, attempt_id uuid not null, actor_user_id uuid,
  event text not null, reason text, occurred_at timestamptz not null default clock_timestamp()
);
create trigger bakong_immutable_events before update or delete on tenh_bakong_private.events
  for each row execute function tenh_billing_private.deny_audit_mutation();
create table tenh_bakong_private.settlements (
  hash text primary key check(hash ~ '^[a-f0-9]{64}$'), attempt_id uuid not null references public.bakong_payment_attempts(id),
  evidence jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create trigger bakong_immutable_settlements before update or delete on tenh_bakong_private.settlements
  for each row execute function tenh_billing_private.deny_audit_mutation();

create function public.tenh_bakong_capacity(p_fingerprint text,p_environment text,p_recipient text,p_budget integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r tenh_bakong_private.capacity_reviews%rowtype; n integer; used integer; reserved integer; can_verify boolean;
begin
  if p_budget is null or p_budget not between 1 and 10000 then return jsonb_build_object('eligible',false,'budget',0); end if;
  if p_environment='sandbox' then n:=least(90,p_budget);
  elsif p_environment='production' then
    select * into r from tenh_bakong_private.capacity_reviews where credential_fingerprint=p_fingerprint and recipient=p_recipient and production_eligible;
    if not found then return jsonb_build_object('eligible',false,'budget',0); end if;
    n:=least(p_budget,r.allocated_daily_limit-10,r.verified_daily_limit-10);
    if n<r.required_daily_requests then return jsonb_build_object('eligible',false,'budget',0); end if;
  else return jsonb_build_object('eligible',false,'budget',0); end if;
  select count(*) into used from tenh_bakong_private.provider_calls where environment=p_environment and counted_at>clock_timestamp()-interval '24 hours';
  select coalesce(sum(greatest(0,3-check_count)),0) into reserved from public.bakong_payment_attempts where environment=p_environment and state in ('pending','review') and verified_hash is null;
  can_verify:=not exists(select 1 from tenh_bakong_private.request_budgets where budget_key='khqr:'||p_environment
    and (invalid_credentials=p_fingerprint or blocked_until>clock_timestamp()+interval '5 minutes'));
  return jsonb_build_object('eligible',true,'budget',n,'canVerify',can_verify,'canIssue',can_verify and used+reserved+3<=n);
end $$;

create function public.tenh_complete_bakong_check(p_attempt uuid,p_claim uuid,p_observation jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.bakong_payment_attempts%rowtype; call tenh_bakong_private.provider_calls%rowtype;
  e jsonb:=p_observation->'settlement'; observed_state text:=p_observation->>'state'; bid uuid; delay integer; consumed_by uuid;
begin
  select * into call from tenh_bakong_private.provider_calls where id=p_claim and attempt_id=p_attempt;
  if not found then raise exception 'Verification lease missing'; end if;
  perform 1 from tenh_bakong_private.request_budgets where budget_key='khqr:'||call.environment for update;
  select business_id into bid from public.bakong_payment_attempts where id=p_attempt;
  perform 1 from public.business_subscriptions where business_id=bid for update;
  select * into a from public.bakong_payment_attempts where id=p_attempt for update;
  if call.completed_at is not null then return to_jsonb(a); end if;
  update tenh_bakong_private.provider_calls set completed_at=clock_timestamp(),outcome=observed_state where id=p_claim;
  if observed_state='paid' then
    if e->>'md5' is distinct from a.md5 or e->>'recipient' is distinct from a.recipient
      or e->>'currency' is distinct from a.currency or e->>'environment' is distinct from a.environment
      or coalesce(e->>'hash','') !~ '^[a-f0-9]{64}$' or coalesce(e->>'amount','') !~ '^\d+(\.\d+)?$'
      or (e->>'amount')::numeric is distinct from a.amount then raise exception 'Settlement evidence does not match saved KHQR'; end if;
    insert into tenh_bakong_private.settlements(hash,attempt_id,evidence) values(e->>'hash',p_attempt,e) on conflict do nothing;
    select attempt_id into consumed_by from tenh_bakong_private.settlements where hash=e->>'hash';
    if consumed_by is distinct from p_attempt or (a.verified_hash is not null and a.verified_hash<>e->>'hash') then
      update public.bakong_payment_attempts set state='review',reason=case when consumed_by is distinct from p_attempt then 'TRANSACTION_ALREADY_CONSUMED' else 'DUPLICATE_PAYMENT_REVIEW' end,
        lease_until=null,updated_at=clock_timestamp() where id=p_attempt returning * into a;
      insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'review',a.reason||':'||(e->>'hash'));
      return to_jsonb(a);
    end if;
    if a.verified_hash is not null then return to_jsonb(a); end if;
    begin
      update public.bakong_payment_attempts set verified_hash=e->>'hash',evidence=e,verified_at=clock_timestamp(),
        state=case when environment='sandbox' then 'test_paid' when clock_timestamp()>expires_at then 'review' else 'verified' end,
        reason=case when environment='production' and clock_timestamp()>expires_at then 'LATE_PAYMENT_REVIEW' else null end,
        lease_until=null,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    exception when unique_violation then
      update public.bakong_payment_attempts set state='review',reason='TRANSACTION_ALREADY_CONSUMED',lease_until=null,updated_at=clock_timestamp()
        where id=p_attempt returning * into a;
      insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'review','TRANSACTION_ALREADY_CONSUMED:'||(e->>'hash'));
      return to_jsonb(a);
    end;
    update public.billing_transactions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('bakong_verification',e,'bakong_state',a.state),
      status=case when a.environment='sandbox' then 'cancelled' else status end,
      provider_status=case when a.environment='sandbox' then 'TEST_CONFIRMED' else 'VERIFIED' end,
      provider_approval_code=a.verified_hash,verified_at=a.verified_at where id=p_attempt;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,a.state,a.reason);
  elsif a.lease_id=p_claim and a.verified_hash is null then
    if observed_state='credential_error' then update tenh_bakong_private.request_budgets set invalid_credentials=call.fingerprint where budget_key='khqr:'||call.environment; end if;
    delay:=greatest(300,coalesce((p_observation->>'retryAfterSeconds')::integer,0));
    if p_observation ? 'retryAfterSeconds' then update tenh_bakong_private.request_budgets set blocked_until=greatest(blocked_until,clock_timestamp()+make_interval(secs=>delay)) where budget_key='khqr:'||call.environment; end if;
    update public.bakong_payment_attempts set state=case when observed_state='mismatch' then 'review' else a.state end,
      reason=case when observed_state='mismatch' then 'PAYMENT_DETAILS_MISMATCH' when observed_state='pending' then null else 'CHECK_UNRESOLVED' end,
      failure_count=case when observed_state='pending' then 0 else failure_count+1 end,
      next_check_at=greatest(next_check_at,clock_timestamp()+make_interval(secs=>greatest(delay,least(3600,300*power(2,least(failure_count,4))::integer)))),
      lease_until=null,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'checked',a.reason);
  end if;
  return to_jsonb(a);
end $$;

create function public.tenh_apply_bakong_payment(p_attempt uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.bakong_payment_attempts%rowtype; s public.business_subscriptions%rowtype; bid uuid; r record; why text; detail text;
begin
  select business_id into bid from public.bakong_payment_attempts where id=p_attempt;
  select * into s from public.business_subscriptions where business_id=bid for update;
  select * into a from public.bakong_payment_attempts where id=p_attempt for update;
  if not found then raise exception 'Payment missing'; end if;
  if a.state<>'verified' then return to_jsonb(a); end if;
  if a.environment<>'production' or a.evidence is null or a.verified_hash is null then why:='PAYMENT_EVIDENCE_MISSING';
  elsif a.verified_at>a.expires_at then why:='LATE_PAYMENT_REVIEW';
  elsif public.tenh_compat_subscription_identity(to_jsonb(s)) is distinct from a.baseline then why:='SUBSCRIPTION_CHANGED';
  elsif not exists(select 1 from public.team_members where id=a.member_id and user_id=a.user_id and business_id=bid and is_active) then why:='PURCHASER_MEMBERSHIP_REMOVED'; end if;
  if why is not null then
    update public.bakong_payment_attempts set state='review',reason=why,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    update public.billing_transactions set metadata=metadata||jsonb_build_object('bakong_state','review') where id=p_attempt;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'review',why);
    return to_jsonb(a);
  end if;
  begin
    select * into r from tenh_bakong_private.apply_subscription(a.reference,a.amount,a.amount,a.currency,'APPROVED',0,a.verified_hash,a.evidence,false);
    if r.business_id is distinct from a.business_id or r.subscription_status<>'active' then raise exception 'Activation result mismatch'; end if;
    update public.bakong_payment_attempts set state='applied',reason=null,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    update public.billing_transactions set metadata=metadata||jsonb_build_object('bakong_state','applied') where id=p_attempt;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event) values(p_attempt,p_actor,'applied');
  exception when others then
    -- Keep verified evidence committed while rolling back this activation/invoice attempt.
    get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
    update public.bakong_payment_attempts set state=case when detail like 'TENH_%' then 'review' else 'verified' end,
      reason=case when detail like 'TENH_%' then 'APPLICATION_REVIEW_REQUIRED' else 'ACTIVATION_PENDING' end,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    update public.billing_transactions set metadata=metadata||jsonb_build_object('bakong_state',a.state) where id=p_attempt;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'activation_pending',sqlstate);
  end;
  return to_jsonb(a);
end $$;

-- Preserve the existing function OID/trigger callers and route Bakong invoices explicitly.
create or replace function public.tenh_issue_billing_invoice(p_source_type text,p_source_payment_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if p_source_type='bakong' or (p_source_type='payway' and exists(select 1 from public.billing_transactions where id=p_source_payment_id and provider='bakong')) then
    return tenh_bakong_private.issue_bakong_invoice('bakong',p_source_payment_id);
  end if;
  return tenh_bakong_private.issue_existing_invoice(p_source_type,p_source_payment_id);
end $$;



create function tenh_bakong_private.issue_on_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider='bakong' and new.status='approved' and old.status is distinct from 'approved' then
    perform public.tenh_issue_billing_invoice('bakong',new.id);
  end if;
  return new;
end $$;
create trigger bakong_issue_approved_invoice after update of status on public.billing_transactions
  for each row execute function tenh_bakong_private.issue_on_approval();

create function public.tenh_prepare_bakong_payment(p_record jsonb,p_actor uuid,p_member uuid,p_intent uuid,p_selection jsonb,
  p_environment text,p_fingerprint text,p_recipient text,p_qr text,p_md5 text,p_reference text,p_expires_at timestamptz,p_budget integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.bakong_payment_attempts%rowtype; s public.business_subscriptions%rowtype;
  bid uuid:=(p_record->>'business_id')::uuid; pid uuid:=(p_record->>'id')::uuid; cap jsonb; used integer; reserved integer;
begin
  -- Same global-budget -> subscription -> attempt lock order as verification.
  insert into tenh_bakong_private.request_budgets(budget_key) values('khqr:'||p_environment) on conflict do nothing;
  perform 1 from tenh_bakong_private.request_budgets where budget_key='khqr:'||p_environment for update;
  select * into s from public.business_subscriptions where business_id=bid for update;
  if not found then raise exception 'Subscription missing'; end if;
  if not exists(select 1 from public.team_members where id=p_member and business_id=bid and user_id=p_actor and is_active) then raise exception 'Membership revoked' using errcode='42501'; end if;
  select * into a from public.bakong_payment_attempts where business_id=bid and user_id=p_actor and intent_id=p_intent;
  if found then
    if a.selection is distinct from p_selection then raise exception 'Purchase intent is immutable' using errcode='22023'; end if;
    return to_jsonb(a);
  end if;
  select a0.* into a from public.bakong_payment_attempts a0 join public.billing_transactions b on b.id=a0.id
    where a0.business_id=bid and b.status='pending' order by a0.created_at limit 1;
  if found then return to_jsonb(a); end if;
  cap:=public.tenh_bakong_capacity(p_fingerprint,p_environment,p_recipient,p_budget);
  if cap->>'eligible' is distinct from 'true' then raise exception 'Bakong capacity is unverified' using errcode='55000'; end if;
  if cap->>'canVerify' is distinct from 'true' then raise exception 'Bakong verification is temporarily unavailable' using errcode='55000'; end if;
  select count(*) into used from tenh_bakong_private.provider_calls where environment=p_environment and counted_at>clock_timestamp()-interval '24 hours';
  select coalesce(sum(greatest(0,3-check_count)),0) into reserved from public.bakong_payment_attempts
    where environment=p_environment and state in ('pending','review') and verified_hash is null;
  if used+reserved+3>(cap->>'budget')::integer then raise exception 'Bakong request capacity is reserved for existing purchases' using errcode='55000'; end if;
  if public.tenh_compat_subscription_identity(to_jsonb(s)) is distinct from public.tenh_compat_subscription_identity(p_record->'_expected_subscription') then raise exception 'Quote changed' using errcode='40001'; end if;
  if p_environment not in ('sandbox','production') or p_record->>'currency'<>'USD' or (p_record->>'amount')::numeric<=0
    or p_md5 !~ '^[a-f0-9]{32}$' or md5(p_qr)<>p_md5 or length(p_reference)>25 or length(p_reference)=0
    or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '16 minutes' then raise exception 'Invalid KHQR preparation' using errcode='22023'; end if;
  insert into public.billing_transactions(id,business_id,requested_by_member_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,
    target_member_limit,target_channel_limit,pricing_version,renew_same,pricing_snapshot,metadata)
    values(pid,bid,p_member,'bakong',p_reference,p_record->>'plan_code',p_record->>'billing_cycle',(p_record->>'amount')::numeric,'USD','pending',
    (p_record->>'target_member_limit')::integer,(p_record->>'target_channel_limit')::integer,p_record->>'pricing_version',
    (p_record->>'renew_same')::boolean,p_record->'pricing_snapshot',jsonb_build_object('environment',p_environment,'live_enabled',p_environment='production','_expected_subscription',to_jsonb(s)));
  insert into public.bakong_payment_attempts(id,business_id,user_id,member_id,intent_id,selection,environment,credential_fingerprint,
    recipient,amount,currency,reference,qr,md5,expires_at,baseline)
    values(pid,bid,p_actor,p_member,p_intent,p_selection,p_environment,p_fingerprint,p_recipient,(p_record->>'amount')::numeric,'USD',p_reference,p_qr,p_md5,p_expires_at,public.tenh_compat_subscription_identity(to_jsonb(s))) returning * into a;
  insert into tenh_bakong_private.events(attempt_id,actor_user_id,event) values(pid,p_actor,'prepared');
  return to_jsonb(a);
end $$;

create function public.tenh_claim_bakong_check(p_attempt uuid,p_fingerprint text,p_budget integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.bakong_payment_attempts%rowtype; b tenh_bakong_private.request_budgets%rowtype; cap jsonb; n integer; cid uuid; oldest timestamptz; quota_key text; reserved integer;
begin
  select 'khqr:'||environment into quota_key from public.bakong_payment_attempts where id=p_attempt;
  if not found then return jsonb_build_object('claimed',false,'reason','missing'); end if;
  insert into tenh_bakong_private.request_budgets(budget_key) values(quota_key) on conflict do nothing;
  select * into b from tenh_bakong_private.request_budgets where budget_key=quota_key for update;
  select * into a from public.bakong_payment_attempts where id=p_attempt for update;
  if not found then return jsonb_build_object('claimed',false,'reason','missing'); end if;
  if a.state in ('verified','applied','test_paid') or a.verified_hash is not null then return jsonb_build_object('claimed',false,'reason','settled'); end if;
  cap:=public.tenh_bakong_capacity(p_fingerprint,a.environment,a.recipient,p_budget);
  if cap->>'eligible' is distinct from 'true' or b.invalid_credentials=p_fingerprint then return jsonb_build_object('claimed',false,'reason','unavailable'); end if;
  if b.blocked_until>clock_timestamp() or a.next_check_at>clock_timestamp() or a.lease_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','cooldown','nextCheckAt',greatest(b.blocked_until,a.next_check_at,a.lease_until)); end if;
  select count(*),min(counted_at) into n,oldest from tenh_bakong_private.provider_calls where environment=a.environment and counted_at>clock_timestamp()-interval '24 hours';
  select coalesce(sum(greatest(0,3-check_count)),0) into reserved from public.bakong_payment_attempts
    where environment=a.environment and state in ('pending','review') and verified_hash is null and id<>p_attempt;
  if n+reserved+1>(cap->>'budget')::integer then return jsonb_build_object('claimed',false,'reason','budget','nextCheckAt',coalesce(oldest+interval '24 hours',clock_timestamp()+interval '1 hour')); end if;
  cid:=gen_random_uuid();
  insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) values(cid,p_fingerprint,a.environment,p_attempt);
  update tenh_bakong_private.request_budgets set blocked_until=clock_timestamp()+interval '60 seconds' where budget_key=quota_key;
  update public.bakong_payment_attempts set lease_id=cid,lease_until=clock_timestamp()+interval '90 seconds',
    next_check_at=clock_timestamp()+interval '5 minutes',check_count=check_count+1 where id=p_attempt;
  return jsonb_build_object('claimed',true,'claimId',cid,'nextCheckAt',clock_timestamp()+interval '5 minutes');
end $$;

revoke all on all tables in schema tenh_bakong_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema tenh_bakong_private from public,anon,authenticated,service_role;
revoke all on all functions in schema tenh_bakong_private from public,anon,authenticated,service_role;
revoke all on function public.tenh_bakong_capacity(text,text,text,integer),
  public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer),
  public.tenh_claim_bakong_check(uuid,text,integer),public.tenh_complete_bakong_check(uuid,uuid,jsonb,uuid),
  public.tenh_apply_bakong_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tenh_bakong_capacity(text,text,text,integer),
  public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer),
  public.tenh_claim_bakong_check(uuid,text,integer),public.tenh_complete_bakong_check(uuid,uuid,jsonb,uuid),
  public.tenh_apply_bakong_payment(uuid,uuid) to service_role;
commit;
