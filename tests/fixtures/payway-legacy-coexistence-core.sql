-- REVIEW DRAFT / ISOLATED TEST FIXTURE ONLY. NOT AN APPROVED INSTALLER.
-- A separately reviewed installer must pin original functions, triggers, ACLs,
-- exact enrolled payment identities and subscription baselines under NOWAIT locks.
-- It must create private, unmodified v1 and reviewed v2 activation function copies.
create schema tenh_billing_private;
revoke all on schema tenh_billing_private from public,anon,authenticated,service_role;

create function public.tenh_compat_payment_identity(p_row jsonb)
returns jsonb language sql immutable set search_path=public as $function$
select coalesce(jsonb_object_agg(key,
 case when key='created_at' and value<>'null'::jsonb
 then to_jsonb(extract(epoch from (value#>>'{}')::timestamptz)) else value end),'{}'::jsonb)
from jsonb_each(p_row) where key=any(array[
 'id','business_id','provider','provider_transaction_id','plan_code','billing_cycle',
 'amount','currency','target_member_limit','target_channel_limit','renew_same',
 'pricing_version','pricing_snapshot','requested_by_member_id','request_time','created_at'])
$function$;
create function public.tenh_compat_subscription_identity(p_row jsonb)
returns jsonb language sql immutable set search_path=public as $function$
select coalesce(jsonb_object_agg(key,
 case when key=any(array['current_period_start','current_period_end',
 'cancellation_requested_at','cancellation_effective_at','pending_plan_requested_at',
 'pending_plan_effective_at','suspended_at']) and value<>'null'::jsonb
 then to_jsonb(extract(epoch from (value#>>'{}')::timestamptz)) else value end),'{}'::jsonb)
from jsonb_each(p_row) where key<>all(array['id','created_at','updated_at'])
$function$;

create table tenh_billing_private.legacy_payway_enrollments(
 source_payment_id uuid primary key, provider_transaction_id text unique not null,
 business_id uuid not null, payment_identity jsonb not null, subscription_identity jsonb not null,
 activation_policy text not null check(activation_policy in ('review','captured-v1')),
 merchant_binding_verified boolean not null default false,
 activation_timezone text not null,
 review_reference text not null check(length(trim(review_reference))>0),
 enrolled_at timestamptz not null default clock_timestamp(),
 check(payment_identity->>'id'=source_payment_id::text),
 check(payment_identity->>'provider_transaction_id'=provider_transaction_id),
 check(payment_identity->>'business_id'=business_id::text)
);
create table tenh_billing_private.approval_attempts(
 source_payment_id uuid not null, xact_id bigint not null,
 payment_identity jsonb not null, subscription_identity jsonb not null,
 primary key(source_payment_id,xact_id)
);
create table tenh_billing_private.resolution_attempts(
 source_payment_id uuid not null,xact_id bigint not null,target_status text not null,
 primary key(source_payment_id,xact_id)
);
create table tenh_billing_private.reconciliation_events(
 id uuid primary key default gen_random_uuid(),event_key text unique not null,
 source_type text not null,source_payment_id uuid not null,business_id uuid not null,
 kind text not null,reason text,observation jsonb not null,
 occurred_at timestamptz not null default clock_timestamp()
);
revoke all on all tables in schema tenh_billing_private from public,anon,authenticated,service_role;
create function tenh_billing_private.deny_audit_mutation()
returns trigger language plpgsql as $function$
begin raise exception 'Billing enrollment and audit evidence are append-only.'; end
$function$;
create trigger immutable_legacy_enrollment before update or delete
on tenh_billing_private.legacy_payway_enrollments for each row
execute function tenh_billing_private.deny_audit_mutation();
create trigger immutable_reconciliation_event before update or delete
on tenh_billing_private.reconciliation_events for each row
execute function tenh_billing_private.deny_audit_mutation();

-- Account release authorizes only Auth SET NULL/member-profile cleanup. It
-- never deletes a member, unlinks a payment requester or changes financial facts.
create table tenh_billing_private.account_deletion_releases(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,
 release_reference text unique not null,operator_reference text not null,
 database_role name not null default session_user,
 identity_disposition text not null check(identity_disposition='preserve_member_reference_redact_member_profile'),
 review_items jsonb not null,reviewed_snapshot jsonb not null,
 released_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '30 minutes')
);
revoke all on tenh_billing_private.account_deletion_releases from public,anon,authenticated,service_role;
create trigger immutable_account_deletion_release before update or delete
on tenh_billing_private.account_deletion_releases for each row
execute function tenh_billing_private.deny_audit_mutation();

create function tenh_billing_private.account_deletion_snapshot(p_user_id uuid)
returns jsonb language sql stable set search_path=public as $function$
with members as (select id,business_id,role from public.team_members where user_id=p_user_id),
 affected as (select distinct e.source_payment_id,e.business_id,e.payment_identity
 from tenh_billing_private.legacy_payway_enrollments e join members m
 on e.payment_identity->>'requested_by_member_id'=m.id::text or (m.role='owner' and e.business_id=m.business_id))
select jsonb_build_object(
 'members',coalesce((select jsonb_agg(to_jsonb(m) order by id) from members m),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('source_payment_id',a.source_payment_id,
  'business_id',a.business_id,'status',b.status,'identity_fingerprint',md5(a.payment_identity::text),
  'latest_conflict',(select max(extract(epoch from r.occurred_at)) from tenh_billing_private.reconciliation_events r
    where r.source_payment_id=a.source_payment_id and r.kind='recovery_required')) order by a.source_payment_id)
  from affected a join public.billing_transactions b on b.id=a.source_payment_id),'[]'::jsonb),
 'other_unresolved',coalesce((select jsonb_agg(to_jsonb(x) order by x.source_type,x.id) from (
  select 'payway'::text as source_type,b.id,b.status from public.billing_transactions b
   where b.business_id in (select business_id from affected) and b.provider='payway' and b.status='pending'
    and b.id not in (select source_payment_id from affected)
  union all select 'manual',m.id,m.status from public.manual_payment_requests m
   where m.business_id in (select business_id from affected) and m.status in ('draft','pending','submitted')) x),'[]'::jsonb))
$function$;

create function tenh_billing_private.release_account_deletion(
 p_user_id uuid,p_release_reference text,p_operator_reference text,p_review_items jsonb,
 p_identity_disposition text)
returns jsonb language plpgsql security definer set search_path=public as $function$
declare v_snapshot jsonb;v_prior tenh_billing_private.account_deletion_releases%rowtype;
 v_payment jsonb;v_review jsonb;v_count integer;v_id uuid;
begin
 if p_user_id is null or length(trim(coalesce(p_release_reference,''))) not between 1 and 200
  or length(trim(coalesce(p_operator_reference,''))) not between 1 and 200
  or p_identity_disposition is distinct from 'preserve_member_reference_redact_member_profile'
  or jsonb_typeof(p_review_items) is distinct from 'array' then
  raise exception 'Explicit operator reference, exact reviews and identity disposition are required.';
 end if;
 select * into v_prior from tenh_billing_private.account_deletion_releases
 where release_reference=p_release_reference;
 if found then
  if v_prior.user_id is distinct from p_user_id or v_prior.operator_reference is distinct from p_operator_reference
   or v_prior.identity_disposition is distinct from p_identity_disposition or v_prior.review_items is distinct from p_review_items then
   raise exception 'Release reference replay differs; use a new operator review.';
  end if;
  return jsonb_build_object('release_id',v_prior.id,'already_released',true,'scope','account_unlink_only',
   'currently_effective',v_prior.expires_at>clock_timestamp() and v_prior.reviewed_snapshot=tenh_billing_private.account_deletion_snapshot(p_user_id));
 end if;
 -- Same subscription-first order as creation/approval, including multi-workspace accounts.
 perform 1 from public.business_subscriptions s where s.business_id in (
  select distinct e.business_id from tenh_billing_private.legacy_payway_enrollments e
  join public.team_members m on e.payment_identity->>'requested_by_member_id'=m.id::text
    or (m.role='owner' and e.business_id=m.business_id) where m.user_id=p_user_id)
 order by s.business_id for update;
 perform 1 from public.billing_transactions b where b.id in (
  select e.source_payment_id from tenh_billing_private.legacy_payway_enrollments e
  join public.team_members m on e.payment_identity->>'requested_by_member_id'=m.id::text
    or (m.role='owner' and e.business_id=m.business_id) where m.user_id=p_user_id)
 order by b.id for update;
 -- A concurrent identical release may have committed while these locks waited.
 select * into v_prior from tenh_billing_private.account_deletion_releases
 where release_reference=p_release_reference;
 if found then
  if v_prior.user_id is distinct from p_user_id or v_prior.operator_reference is distinct from p_operator_reference
   or v_prior.identity_disposition is distinct from p_identity_disposition or v_prior.review_items is distinct from p_review_items then
   raise exception 'Release reference replay differs; use a new operator review.';
  end if;
  return jsonb_build_object('release_id',v_prior.id,'already_released',true,'scope','account_unlink_only',
   'currently_effective',v_prior.expires_at>clock_timestamp() and v_prior.reviewed_snapshot=tenh_billing_private.account_deletion_snapshot(p_user_id));
 end if;
 v_snapshot:=tenh_billing_private.account_deletion_snapshot(p_user_id);
 if jsonb_array_length(v_snapshot->'payments')=0 then raise exception 'No affected retained payment was found.'; end if;
 if jsonb_array_length(v_snapshot->'other_unresolved')<>0 then raise exception 'Other unresolved purchases require separate review.'; end if;
 if jsonb_array_length(p_review_items)<>jsonb_array_length(v_snapshot->'payments') then
  raise exception 'Every affected retained payment must be explicitly reviewed.';
 end if;
 for v_payment in select value from jsonb_array_elements(v_snapshot->'payments') loop
  select count(*) into v_count from jsonb_array_elements(p_review_items) r
    where r->>'source_payment_id'=v_payment->>'source_payment_id';
  if v_count<>1 then raise exception 'Missing, duplicate or extra payment review.'; end if;
  select value into v_review from jsonb_array_elements(p_review_items)
    where value->>'source_payment_id'=v_payment->>'source_payment_id';
  if jsonb_typeof(v_review) is distinct from 'object'
   or v_review->>'identity_fingerprint' is distinct from v_payment->>'identity_fingerprint'
   or v_review->>'payment_status' is distinct from v_payment->>'status'
   or v_review->>'review_disposition' is distinct from
    (case v_payment->>'status' when 'pending' then 'retain_unresolved_recovery'
     when 'approved' then 'approved_verified' when 'failed' then 'resolved_terminal'
     when 'declined' then 'resolved_terminal' when 'cancelled' then 'resolved_terminal' else '' end)
   or v_review->>'evidence_kind' is distinct from 'authoritative_operator_case_review'
   or jsonb_typeof(v_review->'evidence_reference') is distinct from 'string'
   or jsonb_typeof(v_review->'evidence_sha256') is distinct from 'string'
   or length(trim(coalesce(v_review->>'evidence_reference',''))) not between 1 and 200
   or coalesce(v_review->>'evidence_sha256','') !~ '^[0-9a-f]{64}$'
   or v_review->'authorizes_account_unlink_only' is distinct from 'true'::jsonb
   or v_review->'preserves_financial_history' is distinct from 'true'::jsonb
   or exists(select 1 from jsonb_object_keys(v_review) k where k<>all(array[
    'source_payment_id','identity_fingerprint','payment_status','review_disposition','evidence_kind',
    'evidence_reference','evidence_sha256','authorizes_account_unlink_only','preserves_financial_history'])) then
   raise exception 'Payment review evidence, status or scope is invalid.';
  end if;
  if v_payment->>'status' in ('failed','declined','cancelled') and not exists(
   select 1 from tenh_billing_private.reconciliation_events r
   where r.source_payment_id=(v_payment->>'source_payment_id')::uuid and r.kind='reviewed_resolution'
    and r.observation->>'new_status'=v_payment->>'status') then
   raise exception 'Terminal payment lacks its authoritative resolution audit.';
  end if;
  if v_payment->>'status'='approved' and (not exists(
   select 1 from tenh_billing_private.reconciliation_events r
   where r.source_payment_id=(v_payment->>'source_payment_id')::uuid and r.kind='applied')
   or not exists(select 1 from public.tenh_billing_invoices i
    join public.billing_transactions b on b.id=i.source_payment_id
    where i.source_type='payway' and b.id=(v_payment->>'source_payment_id')::uuid
     and i.business_id=b.business_id and i.status='paid' and i.amount=b.amount and i.currency=b.currency)) then
   raise exception 'Approved payment lacks its guarded approval or matching receipt.';
  end if;
 end loop;
 insert into tenh_billing_private.account_deletion_releases(user_id,release_reference,operator_reference,
  identity_disposition,review_items,reviewed_snapshot)
 values(p_user_id,p_release_reference,p_operator_reference,p_identity_disposition,p_review_items,v_snapshot)
 returning id into v_id;
 return jsonb_build_object('release_id',v_id,'already_released',false,'scope','account_unlink_only','currently_effective',true);
end
$function$;

create function public.tenh_get_account_deletion_billing_hold(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public as $function$
with snapshot as (select tenh_billing_private.account_deletion_snapshot(p_user_id) as value)
select jsonb_build_object('held',jsonb_array_length(value->'payments')>0 and not exists(
 select 1 from tenh_billing_private.account_deletion_releases r
 where r.user_id=p_user_id and r.expires_at>clock_timestamp() and r.reviewed_snapshot=value)) from snapshot
$function$;
revoke all on function public.tenh_get_account_deletion_billing_hold(uuid) from public,anon,authenticated;
grant execute on function public.tenh_get_account_deletion_billing_hold(uuid) to service_role;

-- Account release cannot end an unresolved workspace's paid term. This trigger
-- already owns the subscription row; only nonlocking sibling reads are used.
create function public.tenh_guard_retained_subscription_closure()
returns trigger language plpgsql security definer set search_path=public as $function$
begin
 if exists(select 1 from tenh_billing_private.legacy_payway_enrollments e where e.business_id=old.business_id)
  and ((new.status='cancelled' and old.status is distinct from 'cancelled')
    or (old.current_period_end>clock_timestamp() and (new.status is null or new.status not in ('active','trialing'))
      and new.status is distinct from old.status)
    or (old.current_period_end is not null and
      (new.current_period_end is null or new.current_period_end<old.current_period_end)))
  and (exists(select 1 from public.billing_transactions b where b.business_id=old.business_id
    and b.provider='payway' and b.status='pending') or exists(
    select 1 from public.manual_payment_requests m where m.business_id=old.business_id
     and m.status in ('draft','pending','submitted'))) then
  raise exception 'Unresolved retained payments prevent ending the subscription. Transfer Owner access or finish billing recovery.';
 end if;
 return new;
end
$function$;
create trigger tenh_guard_retained_subscription_closure before update on public.business_subscriptions
for each row execute function public.tenh_guard_retained_subscription_closure();
revoke all on function public.tenh_guard_retained_subscription_closure() from public,anon,authenticated,service_role;

create function tenh_billing_private.record_event(
 p_type text,p_payment_id uuid,p_business_id uuid,p_kind text,p_reason text,p_observation jsonb)
returns void language sql security definer set search_path=public as $function$
insert into tenh_billing_private.reconciliation_events(
 event_key,source_type,source_payment_id,business_id,kind,reason,observation)
values(p_type||':'||p_payment_id::text||':'||p_kind||':'||
 md5(coalesce(p_reason,'')||coalesce(p_observation,'{}'::jsonb)::text),
 p_type,p_payment_id,p_business_id,p_kind,p_reason,coalesce(p_observation,'{}'::jsonb))
on conflict(event_key) do nothing
$function$;
create function tenh_billing_private.has_other_unresolved(
 p_business_id uuid,p_source_type text,p_source_id uuid)
returns boolean language sql stable set search_path=public as $function$
select exists(select 1 from public.billing_transactions b
 where b.business_id=p_business_id and b.provider='payway' and b.status='pending'
 and not(p_source_type='payway' and b.id=p_source_id))
or exists(select 1 from public.manual_payment_requests m
 where m.business_id=p_business_id and m.status in ('draft','pending','submitted')
 and not(p_source_type='manual' and m.id=p_source_id))
$function$;
create function public.tenh_legacy_approval_authorized(p_payment_id uuid)
returns boolean language sql security definer set search_path=public as $function$
select exists(select 1 from tenh_billing_private.approval_attempts a
 join tenh_billing_private.legacy_payway_enrollments e on e.source_payment_id=a.source_payment_id
 join public.billing_transactions b on b.id=a.source_payment_id
 join public.business_subscriptions s on s.business_id=b.business_id
 where a.source_payment_id=p_payment_id and a.xact_id=txid_current()
 and a.payment_identity=e.payment_identity
 and a.payment_identity=public.tenh_compat_payment_identity(to_jsonb(b))
 and a.subscription_identity=e.subscription_identity
 and a.subscription_identity=public.tenh_compat_subscription_identity(to_jsonb(s)))
$function$;

create function public.tenh_guard_enrolled_payway_identity()
returns trigger language plpgsql security definer set search_path=public as $function$
declare v_identity jsonb;
begin
 select payment_identity into v_identity from tenh_billing_private.legacy_payway_enrollments
 where source_payment_id=old.id;
 if not found then return coalesce(new,old); end if;
 if tg_op='DELETE' then raise exception 'Enrolled payment history cannot be deleted.'; end if;
 if public.tenh_compat_payment_identity(to_jsonb(new)) is distinct from v_identity then
   raise exception 'Enrolled payment identity or saved quote changed: %.',
     (select string_agg(key,',') from jsonb_each(public.tenh_compat_payment_identity(to_jsonb(new)))
      where value is distinct from v_identity->key);
 end if;
 if new.metadata->>'checkout_contract_version' is distinct from old.metadata->>'checkout_contract_version'
   or new.metadata->>'environment' is distinct from old.metadata->>'environment'
   or new.metadata->>'live_enabled' is distinct from old.metadata->>'live_enabled' then
   raise exception 'Enrolled payment contract or environment changed.';
 end if;
 if new.status='approved' and old.status is distinct from 'approved'
   and not public.tenh_legacy_approval_authorized(old.id) then
   raise exception 'Enrolled payment approval requires guarded legacy dispatch.';
 end if;
 if new.status is distinct from old.status and new.status<>'approved'
   and not exists(select 1 from tenh_billing_private.resolution_attempts r
     where r.source_payment_id=old.id and r.xact_id=txid_current() and r.target_status=new.status) then
   raise exception 'Enrolled payment resolution requires a reviewed resolution permit.';
 end if;
 return new;
end
$function$;
create trigger tenh_01_guard_enrolled_payway_identity before update or delete
on public.billing_transactions for each row execute function public.tenh_guard_enrolled_payway_identity();

-- The captured invoice function assumes a fresh full billing cycle. A legacy
-- custom upgrade instead retains its original start and extends its old expiry.
-- Correct only the new invoice issued inside the exact guarded legacy attempt.
create function tenh_billing_private.set_legacy_invoice_period()
returns trigger language plpgsql security definer set search_path=public as $function$
declare v_identity jsonb;v_quote jsonb;
begin
 if new.source_type<>'payway' then return new; end if;
 select e.payment_identity into v_identity from tenh_billing_private.legacy_payway_enrollments e
 where e.source_payment_id=new.source_payment_id;
 if not found then return new; end if;
 if not public.tenh_legacy_approval_authorized(new.source_payment_id) then
   raise exception 'Enrolled payment invoice requires its exact guarded approval attempt.';
 end if;
 if new.business_id::text is distinct from v_identity->>'business_id'
   or new.source_transaction_id is distinct from v_identity->>'provider_transaction_id'
   or new.amount is distinct from (v_identity->>'amount')::numeric
   or new.currency is distinct from v_identity->>'currency' then
   raise exception 'Enrolled invoice does not match its immutable payment.';
 end if;
 v_quote:=v_identity->'pricing_snapshot';
 if v_quote->>'purchase_type'='custom-upgrade' then
   new.period_start:=new.paid_at;
   new.period_end:=(v_quote->>'new_period_end')::timestamptz;
   new.snapshot:=coalesce(new.snapshot,'{}'::jsonb)||jsonb_build_object('legacy_saved_quote',v_quote);
 end if;
 return new;
end
$function$;
create trigger tenh_01_set_legacy_invoice_period before insert on public.tenh_billing_invoices
for each row execute function tenh_billing_private.set_legacy_invoice_period();

create function public.tenh_guard_new_billing_purchase()
returns trigger language plpgsql security definer set search_path=public as $function$
declare v_type text;
begin
 v_type:=case when tg_table_name='billing_transactions' then 'payway' else 'manual' end;
 if tg_op='UPDATE' then
   if new.business_id is distinct from old.business_id
     or to_jsonb(new)->>'provider' is distinct from to_jsonb(old)->>'provider'
     or to_jsonb(new)->>'provider_transaction_id' is distinct from to_jsonb(old)->>'provider_transaction_id' then
     raise exception 'Saved payment workspace and provider identity are immutable.';
   end if;
 end if;
 if (v_type='payway' and (to_jsonb(new)->>'provider' is distinct from 'payway' or new.status is distinct from 'pending'))
 or (v_type='manual' and new.status not in ('draft','pending','submitted')) then return new; end if;
 if tg_op='UPDATE' then
   if (v_type='payway' and old.status='pending' and to_jsonb(old)->>'provider'='payway')
   or (v_type='manual' and old.status in ('draft','pending','submitted')) then return new; end if;
   -- UPDATE already owns a payment row lock. Do not acquire a subscription
   -- lock here: terminal->pending reopening requires explicit recovery instead.
   raise exception 'A terminal payment cannot be reopened by an ordinary update.';
 end if;
 if current_setting('transaction_isolation') <> 'read committed' then
   raise exception 'Billing purchase creation requires READ COMMITTED.';
 end if;
 perform 1 from public.business_subscriptions where business_id=new.business_id for update;
 if not found then raise exception 'Billing subscription record is missing.'; end if;
 -- Nonlocking reads: never wait for a sibling payment row while owning subscription.
 if tenh_billing_private.has_other_unresolved(new.business_id,v_type,new.id) then
   raise exception using errcode='23505',detail='TENH_BILLING_PURCHASE_PENDING',
     message='An existing payment must be resolved before a new purchase.';
 end if;
 return new;
end
$function$;
create trigger tenh_00_guard_new_billing_purchase
before insert or update on public.billing_transactions
for each row execute function public.tenh_guard_new_billing_purchase();
create trigger tenh_00_guard_new_manual_purchase
before insert or update on public.manual_payment_requests
for each row execute function public.tenh_guard_new_billing_purchase();

create or replace function public.tenh_activate_verified_payway_payment(
 p_provider_transaction_id text,p_original_amount numeric,p_payment_amount numeric default null,
 p_payment_currency text default null,p_payment_status text default null,
 p_payment_status_code integer default null,p_approval_code text default null,
 p_provider_payload jsonb default '{}',p_callback_received boolean default false)
returns table(business_id uuid,plan_code text,subscription_status text,current_period_end timestamptz,
 member_limit integer,channel_limit integer,already_approved boolean)
language plpgsql security definer set search_path=public as $function$
declare
 v_tx public.billing_transactions%rowtype;v_sub public.business_subscriptions%rowtype;
 v_enrollment tenh_billing_private.legacy_payway_enrollments%rowtype;
 v_business uuid;v_reason text;v_observation jsonb;v_original_timezone text;
 v_legacy boolean;v_months integer;v_result record;
begin
 select b.business_id into v_business from public.billing_transactions b
 where b.provider='payway' and b.provider_transaction_id=p_provider_transaction_id;
 if not found then raise exception 'TENH billing transaction was not found.'; end if;
 select * into v_sub from public.business_subscriptions s where s.business_id=v_business for update;
 if not found then raise exception 'TENH subscription row was not found.'; end if;
 select * into v_tx from public.billing_transactions b
 where b.provider='payway' and b.provider_transaction_id=p_provider_transaction_id for update;
 if not found or v_tx.business_id is distinct from v_business then
   raise exception 'Payment identity changed while its subscription was locked.';
 end if;
 select * into v_enrollment from tenh_billing_private.legacy_payway_enrollments e
 where e.source_payment_id=v_tx.id;
 v_legacy:=found;
 v_observation:=jsonb_build_object(
 'provider_transaction_id',p_provider_transaction_id,'original_amount',p_original_amount,
 'payment_amount',p_payment_amount,'payment_currency',p_payment_currency,
 'payment_status',p_payment_status,'payment_status_code',p_payment_status_code,
 'approval_code',p_approval_code,'provider',p_provider_payload);
 if v_tx.status='approved' then
   return query select v_sub.business_id,v_sub.plan_code,v_sub.status,v_sub.current_period_end,
     v_sub.member_limit,v_sub.channel_limit,true;return;
 end if;
 if coalesce(p_payment_status_code,-1)<>0 or upper(coalesce(p_payment_status,''))<>'APPROVED'
 or p_provider_payload->'status'->>'code' is distinct from '00'
 or p_provider_payload->'status'->>'tran_id' is distinct from p_provider_transaction_id then
   v_reason:='PROVIDER_APPROVAL_NOT_VERIFIED';
 elsif p_original_amount is null or p_original_amount is distinct from v_tx.amount
 or p_original_amount*100<>trunc(p_original_amount*100)
 or upper(v_tx.currency)<>'USD' then v_reason:='PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH';
 elsif v_tx.status<>'pending' then v_reason:='PAYMENT_STATUS_REQUIRES_RECOVERY';
 elsif tenh_billing_private.has_other_unresolved(v_business,'payway',v_tx.id) then
   v_reason:='CONFLICTING_UNRESOLVED_PAYMENT';
 elsif v_legacy then
   if public.tenh_compat_payment_identity(to_jsonb(v_tx)) is distinct from v_enrollment.payment_identity then
     v_reason:='LEGACY_PAYMENT_IDENTITY_CHANGED';
   elsif not v_enrollment.merchant_binding_verified then v_reason:='LEGACY_MERCHANT_BINDING_UNVERIFIED';
   elsif v_enrollment.activation_policy<>'captured-v1' then v_reason:='LEGACY_RECOVERY_REVIEW_REQUIRED';
   elsif public.tenh_compat_subscription_identity(to_jsonb(v_sub))
     is distinct from v_enrollment.subscription_identity then v_reason:='LEGACY_SUBSCRIPTION_BASELINE_CHANGED';
   elsif coalesce(v_sub.cancel_at_period_end,false) or v_sub.pending_plan_change_type is not null then
     v_reason:='LEGACY_SCHEDULED_CHANGE_REQUIRES_REVIEW';
   elsif v_tx.pricing_snapshot->>'purchase_type'='custom-upgrade' then
     if v_sub.status<>'active' or v_sub.current_period_end is null or v_sub.current_period_end<=now()
       or v_tx.pricing_snapshot->>'current_period_end' is null
       or (v_tx.pricing_snapshot->>'current_period_end')::timestamptz is distinct from v_sub.current_period_end
       or v_tx.pricing_snapshot->>'current_billing_cycle' is distinct from v_sub.billing_cycle
       or coalesce(v_tx.pricing_snapshot->>'extension_months','') !~ '^[0-9]+$'
     then v_reason:='LEGACY_QUOTE_BASELINE_UNPROVEN';
     else
       v_months:=(v_tx.pricing_snapshot->>'extension_months')::integer;
       v_original_timezone:=current_setting('TimeZone');
       perform set_config('TimeZone',v_enrollment.activation_timezone,true);
       if v_tx.pricing_snapshot->>'new_period_end' is null
         or (v_tx.pricing_snapshot->>'new_period_end')::timestamptz
           is distinct from v_sub.current_period_end+make_interval(months=>v_months)
       then v_reason:='LEGACY_EXTENSION_SEMANTICS_UNPROVEN'; end if;
       perform set_config('TimeZone',v_original_timezone,true);
     end if;
   end if;
 end if;
 if v_reason is null then
   begin
     if v_legacy then
       insert into tenh_billing_private.approval_attempts values(
         v_tx.id,txid_current(),v_enrollment.payment_identity,v_enrollment.subscription_identity);
       v_original_timezone:=current_setting('TimeZone');
       perform set_config('TimeZone',v_enrollment.activation_timezone,true);
       select * into v_result from tenh_billing_private.activate_payway_v1(
         p_provider_transaction_id,p_original_amount,p_payment_amount,p_payment_currency,
         p_payment_status,p_payment_status_code,p_approval_code,p_provider_payload,p_callback_received);
       perform set_config('TimeZone',v_original_timezone,true);
       delete from tenh_billing_private.approval_attempts a
         where a.source_payment_id=v_tx.id and a.xact_id=txid_current();
     else
       select * into v_result from tenh_billing_private.activate_payway_v2(
         p_provider_transaction_id,p_original_amount,p_payment_amount,p_payment_currency,
         p_payment_status,p_payment_status_code,p_approval_code,p_provider_payload,p_callback_received);
     end if;
     perform tenh_billing_private.record_event('payway',v_tx.id,v_business,'applied',null,
       jsonb_build_object('contract',case when v_legacy then 'captured-v1' else 'v2' end,
         'payment_identity',public.tenh_compat_payment_identity(to_jsonb(v_tx)),
         'before_subscription',public.tenh_compat_subscription_identity(to_jsonb(v_sub)),
         'result',to_jsonb(v_result)));
     return query select v_result.business_id,v_result.plan_code,v_result.subscription_status,
       v_result.current_period_end,v_result.member_limit,v_result.channel_limit,v_result.already_approved;
     return;
   exception when others then
     -- The subtransaction rolls back activation, invoice, attempt and GUC changes.
     -- Evidence is written outside it, so a rejected late payment remains reviewable.
     v_reason:='ACTIVATION_REJECTED:'||sqlstate||':'||sqlerrm;
   end;
 end if;
 perform tenh_billing_private.record_event('payway',v_tx.id,v_business,'recovery_required',v_reason,v_observation);
 return query select v_tx.business_id,v_tx.plan_code,'recovery_required'::text,
   v_sub.current_period_end,v_sub.member_limit,v_sub.channel_limit,false;
end
$function$;

create or replace function public.tenh_approve_manual_payment(
 p_request_id uuid,p_reviewed_by_user_id uuid default null,p_reviewed_by_email text default null,
 p_review_note text default null)
returns table(request_id uuid,business_id uuid,plan_code text,subscription_status text,
 current_period_end timestamptz,member_limit integer,channel_limit integer,already_approved boolean)
language plpgsql security definer set search_path=public as $function$
declare v_request public.manual_payment_requests%rowtype;v_sub public.business_subscriptions%rowtype;
 v_business uuid;v_reason text;v_result record;
begin
 select m.business_id into v_business from public.manual_payment_requests m where m.id=p_request_id;
 if not found then raise exception 'Manual payment request was not found.'; end if;
 select * into v_sub from public.business_subscriptions s where s.business_id=v_business for update;
 if not found then raise exception 'TENH subscription row was not found.'; end if;
 select * into v_request from public.manual_payment_requests m where m.id=p_request_id for update;
 if not found or v_request.business_id is distinct from v_business then
   raise exception 'Manual payment identity changed while its subscription was locked.';
 end if;
 if v_request.status='approved' then
   return query select v_request.id,v_sub.business_id,v_sub.plan_code,v_sub.status,v_sub.current_period_end,
     v_sub.member_limit,v_sub.channel_limit,true;return;
 end if;
 if tenh_billing_private.has_other_unresolved(v_business,'manual',v_request.id) then
   v_reason:='CONFLICTING_UNRESOLVED_PAYMENT';
 else
   begin
     select * into v_result from tenh_billing_private.approve_manual_v2(
       p_request_id,p_reviewed_by_user_id,p_reviewed_by_email,p_review_note);
     return query select v_result.request_id,v_result.business_id,v_result.plan_code,
       v_result.subscription_status,v_result.current_period_end,v_result.member_limit,
       v_result.channel_limit,v_result.already_approved;return;
   exception when others then v_reason:='MANUAL_APPROVAL_REJECTED:'||sqlstate||':'||sqlerrm; end;
 end if;
 perform tenh_billing_private.record_event('manual',v_request.id,v_business,'recovery_required',v_reason,
   jsonb_build_object('reviewed_by_user_id',p_reviewed_by_user_id));
 return query select v_request.id,v_request.business_id,v_request.plan_code,'recovery_required'::text,
   v_sub.current_period_end,v_sub.member_limit,v_sub.channel_limit,false;
end
$function$;

create function public.tenh_observe_payway_verification(
 p_provider_transaction_id text,p_observation jsonb,p_callback_received boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $function$
declare v_business uuid;v_tx public.billing_transactions%rowtype;v_status text;v_enrolled boolean;
begin
 select b.business_id into v_business from public.billing_transactions b
 where b.provider='payway' and b.provider_transaction_id=p_provider_transaction_id;
 if not found then raise exception 'TENH billing transaction was not found.'; end if;
 perform 1 from public.business_subscriptions s where s.business_id=v_business for update;
 if not found then raise exception 'TENH subscription row was not found.'; end if;
 select * into v_tx from public.billing_transactions b
 where b.provider='payway' and b.provider_transaction_id=p_provider_transaction_id for update;
 if not found or v_tx.business_id is distinct from v_business then
   raise exception 'Payment identity changed while its subscription was locked.';
 end if;
 v_enrolled:=exists(select 1 from tenh_billing_private.legacy_payway_enrollments e where e.source_payment_id=v_tx.id);
 v_status:=v_tx.status;
 -- An inquiry error/not-found is an observation, not a provider cancellation.
 -- Enrolled rows retain their status until guarded approval or explicit reviewed resolution.
 if not v_enrolled and v_status='pending' and p_observation->>'provider_status_code'='00'
   and p_observation->>'provider_transaction_id'=v_tx.provider_transaction_id then
   v_status:=case upper(p_observation->>'payment_status')
     when 'DECLINED' then 'declined' when 'FAILED' then 'failed'
     when 'CANCELLED' then 'cancelled' when 'CANCELED' then 'cancelled' else v_status end;
 end if;
 perform tenh_billing_private.record_event('payway',v_tx.id,v_business,
   case when p_observation->>'conflict_reason' is not null then 'recovery_required' else 'observed' end,
   p_observation->>'conflict_reason',p_observation);
 if v_status is distinct from v_tx.status then
   update public.billing_transactions b set status=v_status where b.id=v_tx.id;
 end if;
 update public.billing_transactions b set
   metadata=coalesce(b.metadata,'{}'::jsonb)||jsonb_build_object('payway_last_verification',p_observation),
   callback_received_at=case when p_callback_received then coalesce(b.callback_received_at,now())
     else b.callback_received_at end where b.id=v_tx.id;
 return jsonb_build_object('payment_state',case when p_observation->>'conflict_reason' is not null
   then 'recovery_required' else v_status end,'enrolled_legacy',v_enrolled);
end
$function$;

-- Owner-only resolution building block. No service/API grant is provided.
-- It cannot be used to discard unknown payments or approved payment evidence.
create function tenh_billing_private.resolve_legacy_payment(
 p_payment_id uuid,p_target_status text,p_review_reference text,p_evidence jsonb)
returns void language plpgsql security definer set search_path=public as $function$
declare v_business uuid;v_tx public.billing_transactions%rowtype;
begin
 if p_target_status not in ('cancelled','declined','failed') or length(trim(coalesce(p_review_reference,'')))=0
   or p_evidence->>'owner_authorization_reference' is null
   or p_evidence->>'merchant_binding_verified' is distinct from 'true'
   or p_evidence->>'provider_status_code' is distinct from '00'
   or upper(p_evidence->>'payment_status') is distinct from
      (case p_target_status when 'cancelled' then 'CANCELLED' when 'declined' then 'DECLINED' else 'FAILED' end) then
   raise exception 'Resolution requires explicit reviewed authorization and verified provider terminal evidence.';
 end if;
 select b.business_id into v_business from billing_transactions b where b.id=p_payment_id;
 if not found then raise exception 'Payment not found.'; end if;
 perform 1 from business_subscriptions s where s.business_id=v_business for update;
 select * into v_tx from billing_transactions b where b.id=p_payment_id for update;
 if not found or v_tx.business_id is distinct from v_business or v_tx.status<>'pending'
   or p_evidence->>'provider_transaction_id' is distinct from v_tx.provider_transaction_id
   or not exists(select 1 from tenh_billing_private.legacy_payway_enrollments e where e.source_payment_id=p_payment_id)
 then raise exception 'Enrolled pending payment identity or status differs.'; end if;
 insert into tenh_billing_private.resolution_attempts values(p_payment_id,txid_current(),p_target_status);
 perform tenh_billing_private.record_event('payway',v_tx.id,v_business,'reviewed_resolution',
   p_review_reference,jsonb_build_object('prior_status',v_tx.status,'new_status',p_target_status,'evidence',p_evidence));
 update billing_transactions set status=p_target_status where id=p_payment_id;
 delete from tenh_billing_private.resolution_attempts where source_payment_id=p_payment_id and xact_id=txid_current();
end
$function$;

create function public.tenh_get_billing_recovery_queue(p_business_id uuid)
returns jsonb language sql security definer set search_path=public as $function$
select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at,e.id),'[]'::jsonb)
from tenh_billing_private.reconciliation_events e
where e.business_id=p_business_id and e.kind='recovery_required'
$function$;

revoke all on all functions in schema tenh_billing_private from public,anon,authenticated,service_role;
revoke all on function public.tenh_compat_payment_identity(jsonb),
 public.tenh_compat_subscription_identity(jsonb),public.tenh_legacy_approval_authorized(uuid),
 public.tenh_guard_enrolled_payway_identity(),public.tenh_guard_new_billing_purchase()
 from public,anon,authenticated;
revoke all on function public.tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean),
 public.tenh_approve_manual_payment(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean),
 public.tenh_approve_manual_payment(uuid,uuid,text,text) to service_role;
revoke all on function public.tenh_observe_payway_verification(text,jsonb,boolean),
 public.tenh_get_billing_recovery_queue(uuid) from public,anon,authenticated;
grant execute on function public.tenh_observe_payway_verification(text,jsonb,boolean),
 public.tenh_get_billing_recovery_queue(uuid) to service_role;
