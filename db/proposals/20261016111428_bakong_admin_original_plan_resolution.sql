-- LOCAL COMPONENT PROPOSAL. User selected explicit admin application of the original purchase.
-- No automatic application, refund, transfer, provider inquiry, or feature enablement.
-- Service RPC caller must be the server's canonical freshly verified TENH billing admin;
-- p_actor is taken from that authentication result, never from the browser's request body.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';

create table tenh_bakong_private.late_application_resolutions (
  request_id uuid primary key, attempt_id uuid not null, business_id uuid not null,
  actor_user_id uuid not null, reason text not null check(length(trim(reason)) between 10 and 500),
  transaction_hash text not null check(transaction_hash ~ '^[a-f0-9]{64}$'),
  purchase jsonb not null, evidence jsonb not null, baseline jsonb not null,
  outcome text not null check(outcome in ('applied','conflict','application_failed')),
  conflict_reason text, invoice_id uuid, recorded_at timestamptz not null default clock_timestamp()
);
alter table tenh_bakong_private.late_application_resolutions enable row level security;
revoke all on tenh_bakong_private.late_application_resolutions from public,anon,authenticated,service_role;
create unique index bakong_one_original_plan_resolution on tenh_bakong_private.late_application_resolutions(attempt_id) where outcome='applied';
create trigger bakong_immutable_late_resolution before update or delete on tenh_bakong_private.late_application_resolutions
  for each row execute function tenh_billing_private.deny_audit_mutation();

create function tenh_bakong_private.original_plan_conflict(p_attempt uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare a public.bakong_payment_attempts%rowtype; b public.billing_transactions%rowtype;
  s public.business_subscriptions%rowtype; m public.team_members%rowtype; e jsonb;
begin
  select * into a from public.bakong_payment_attempts where id=p_attempt;
  if not found then return 'PAYMENT_MISSING'; end if;
  if a.state='applied' then return 'ALREADY_APPLIED'; end if;
  if a.environment<>'production' or a.state<>'review' or a.reason is null or a.reason not in ('CANCELLATION_PAYMENT_REVIEW','LATE_PAYMENT_REVIEW') then return 'NOT_ORIGINAL_LATE_PAYMENT'; end if;
  if a.verified_hash is null or a.verified_at is null or a.evidence is null then return 'RECEIPT_NOT_CONFIRMED'; end if;
  select evidence into e from tenh_bakong_private.settlements where hash=a.verified_hash and attempt_id=a.id;
  if not found or e is distinct from a.evidence or e->>'hash' is distinct from a.verified_hash
    or e->>'md5' is distinct from a.md5 or e->>'recipient' is distinct from a.recipient
    or e->>'currency' is distinct from a.currency or e->>'environment' is distinct from a.environment
    or coalesce(e->>'amount','') !~ '^\d+(\.\d+)?$' then return 'RECEIPT_EVIDENCE_MISMATCH'; end if;
  if (e->>'amount')::numeric is distinct from a.amount then return 'RECEIPT_EVIDENCE_MISMATCH'; end if;
  select * into b from public.billing_transactions where id=a.id and business_id=a.business_id and provider='bakong';
  if not found or b.status<>'pending' or b.amount is distinct from a.amount or b.currency is distinct from a.currency
    or b.provider_approval_code is distinct from a.verified_hash or b.metadata->'bakong_verification' is distinct from e
    then return 'SAVED_PURCHASE_MISMATCH'; end if;
  select * into s from public.business_subscriptions where business_id=a.business_id;
  if not found or public.tenh_compat_subscription_identity(to_jsonb(s)) is distinct from a.baseline then return 'SUBSCRIPTION_BASELINE_CHANGED'; end if;
  select * into m from public.team_members where id=a.member_id and business_id=a.business_id and user_id=a.user_id and is_active;
  if not found then return 'PURCHASER_MEMBERSHIP_REMOVED'; end if;
  if coalesce(m.role,'')<>'owner' and coalesce(m.permissions->>'billing','view')<>'manage' then return 'PURCHASER_PERMISSION_CHANGED'; end if;
  -- Later replacements include cancelled/expired issued QRs: their saved bank QR can still receive money.
  if exists(select 1 from public.billing_transactions x where x.business_id=a.business_id and x.id<>a.id
      and (x.created_at>=a.created_at or (x.provider='payway' and x.status='pending')))
    or exists(select 1 from public.bakong_payment_attempts x where x.business_id=a.business_id and x.id<>a.id
      and (x.state in ('verified','review') or (x.state='pending' and x.expires_at>clock_timestamp()
        and not exists(select 1 from public.payment_cancellations c where c.kind='bakong' and c.payment_id=x.id::text))))
    or exists(select 1 from public.manual_payment_requests x where x.business_id=a.business_id
      and (x.created_at>=a.created_at or x.status::text='submitted'))
    or exists(select 1 from public.manual_payment_uploads x where x.business_id=a.business_id and x.created_at>=a.created_at)
    then return 'OVERLAPPING_PURCHASE'; end if;
  if exists(select 1 from public.tenh_billing_invoices i where i.business_id=a.business_id
    and i.source_type='bakong' and i.source_payment_id=a.id) then return 'EXISTING_INVOICE_REVIEW'; end if;
  return null;
end $$;

create function public.tenh_bakong_original_plan_preview(p_attempts uuid[]) returns jsonb
language sql volatile security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(id::text,jsonb_build_object('canApplyOriginal',why is null,'reason',why)),'{}'::jsonb)
  from (select id,tenh_bakong_private.original_plan_conflict(id) why from unnest(p_attempts) id limit 50) q
$$;

create function public.tenh_apply_reviewed_bakong_original_plan(p_attempt uuid,p_actor uuid,p_request uuid,p_reason text,p_expected_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.bakong_payment_attempts%rowtype; b public.billing_transactions%rowtype;
  prior tenh_bakong_private.late_application_resolutions%rowtype; receipt uuid; r record;
  bid uuid; env text; why text; outcome text:='conflict'; purchase jsonb;
begin
  if p_actor is null or p_request is null or p_reason is null or length(trim(p_reason)) not between 10 and 500
    or coalesce(p_expected_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit reviewed payment identity and reason required' using errcode='22023'; end if;
  select business_id,environment into bid,env from public.bakong_payment_attempts where id=p_attempt;
  if not found then raise exception 'Payment missing'; end if;
  perform 1 from tenh_bakong_private.request_budgets where budget_key='khqr:'||env for update;
  if not found then raise exception 'Saved inquiry budget missing'; end if;
  perform 1 from public.business_subscriptions where business_id=bid for update;
  select * into a from public.bakong_payment_attempts where id=p_attempt for update;
  select * into b from public.billing_transactions where id=p_attempt for update;
  perform 1 from public.team_members where id=a.member_id for share;
  select * into prior from tenh_bakong_private.late_application_resolutions where request_id=p_request;
  if found then
    if prior.attempt_id<>p_attempt or prior.actor_user_id<>p_actor or prior.reason<>trim(p_reason) or prior.transaction_hash<>p_expected_hash then
      raise exception 'Resolution request identity changed' using errcode='22023'; end if;
    return jsonb_build_object('outcome',prior.outcome,'reason',prior.conflict_reason,'invoiceId',prior.invoice_id,'resolutionId',prior.request_id,'businessId',prior.business_id);
  end if;
  if a.verified_hash is null or a.verified_hash<>p_expected_hash then raise exception 'Reviewed receipt changed' using errcode='22023'; end if;
  why:=tenh_bakong_private.original_plan_conflict(p_attempt);
  purchase:=jsonb_build_object('planCode',b.plan_code,'billingCycle',b.billing_cycle,'amount',b.amount,'currency',b.currency,
    'memberLimit',b.target_member_limit,'channelLimit',b.target_channel_limit,'reference',a.reference);
  if why is null then
    begin
      -- Explicit admin decision bypasses only the ordinary late-time rejection. The existing
      -- financial algorithm still validates the original saved purchase/evidence/baseline.
      select * into r from tenh_bakong_private.apply_subscription(a.reference,a.amount,a.amount,a.currency,'APPROVED',0,a.verified_hash,a.evidence,false);
      if r.business_id is distinct from bid or r.subscription_status<>'active' then raise exception 'Application result mismatch'; end if;
      select id into receipt from public.tenh_billing_invoices where business_id=bid and source_type='bakong' and source_payment_id=a.id and status='paid';
      if receipt is null then raise exception 'Confirmed receipt missing'; end if;
      update public.bakong_payment_attempts set state='applied',reason=null,updated_at=clock_timestamp() where id=a.id;
      update public.billing_transactions set metadata=metadata||jsonb_build_object('bakong_state','applied','admin_resolution_request',p_request) where id=a.id;
      outcome:='applied';
    exception when others then
      -- This savepoint rolls back ALL entitlement/invoice effects. Evidence and review stay.
      outcome:='application_failed'; why:='ORIGINAL_PLAN_APPLICATION_FAILED'; receipt:=null;
    end;
  end if;
  insert into tenh_bakong_private.late_application_resolutions(request_id,attempt_id,business_id,actor_user_id,reason,transaction_hash,purchase,evidence,baseline,outcome,conflict_reason,invoice_id)
    values(p_request,a.id,bid,p_actor,trim(p_reason),a.verified_hash,purchase,coalesce(a.evidence,'null'::jsonb),a.baseline,outcome,why,receipt);
  insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason)
    values(a.id,p_actor,'admin_original_plan_resolution',outcome||coalesce(':'||why,''));
  return jsonb_build_object('outcome',outcome,'reason',why,'invoiceId',receipt,'resolutionId',p_request,'businessId',bid);
end $$;

revoke all on function tenh_bakong_private.original_plan_conflict(uuid),
  public.tenh_bakong_original_plan_preview(uuid[]),public.tenh_apply_reviewed_bakong_original_plan(uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.tenh_bakong_original_plan_preview(uuid[]),public.tenh_apply_reviewed_bakong_original_plan(uuid,uuid,uuid,text,text) to service_role;
commit;
