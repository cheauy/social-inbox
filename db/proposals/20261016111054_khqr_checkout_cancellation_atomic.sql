-- LOCAL ATOMIC PROPOSAL ONLY. CLI-generated filename; deliberately outside db/migrations.
-- No hosted execution, enablement, provider inquiries, refunds or transfers.
-- Requires the installed CHAT billing/manual/Bakong core through the reviewed authorization era.
-- Expected body hashes were independently matched by read-only metadata queries on CHAT
-- dvieoqprsmzydtepbxwn (PostgreSQL17.6) at 2026-10-16 11:36 UTC. Recheck before any rollout.
-- Fence/drain billing writers before any separately authorized rollout. Unknown/partial schemas fail closed.
-- Component comments are provenance, not separate rollout instructions. Final accounting removes the
-- historical one-hour grace reservations within this single uncommitted transaction. No QR-count cap.
-- Source db/migrations/20261016083154_payment_cancellation_safety.sql raw-sha256=0b8863031e08fa7058e41b4b6ff0dcb9301acb59d3de62bb75bced624535f399 lf-sha256=f989f0d5a6042f21721ab666b4f93206e167bf2f53af12c3193acc1be4556f5b
-- Source db/migrations/20261016093000_bakong_checkout_lifecycle.sql raw-sha256=7796936cd533683a0d4149261eefe45236952da261b8a2d0878c42b67cf983ac lf-sha256=05a4fe6355a1c50579d2e978933cc48b64f8c513f7fe58a9858bcb0df0e55516
-- Source db/proposals/20261016105717_bakong_closed_checkout_accounting.sql raw-sha256=27df0e3aa6625ddab5b2d53075c5338bd500275b2aeed395c77a4e00260e4a11 lf-sha256=27df0e3aa6625ddab5b2d53075c5338bd500275b2aeed395c77a4e00260e4a11
-- Source db/proposals/20261016111428_bakong_admin_original_plan_resolution.sql raw-sha256=db5ac7bb9db9def9c8c08eb01884cb4073aceac37fcffb453b640b9abbf9b2a6 lf-sha256=db5ac7bb9db9def9c8c08eb01884cb4073aceac37fcffb453b640b9abbf9b2a6
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
do $base$
begin
  if current_user not in ('postgres','supabase_admin') or not public.tenh_payment_application_guards_ready()
    or to_regclass('public.payment_cancellations') is not null
    or to_regclass('tenh_bakong_private.late_application_resolutions') is not null then
    raise exception 'Review the trusted owner and exact unmodified CHAT checkout baseline'; end if;
  if not exists(select 1 from pg_attribute where attrelid='public.team_members'::regclass and attname='permissions' and atttypid='jsonb'::regtype and not attisdropped)
    or not exists(select 1 from pg_attribute a where a.attrelid='public.billing_transactions'::regclass and a.attname='request_time' and a.atttypid='text'::regtype and a.attnotnull
      and not exists(select 1 from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)) then
    raise exception 'Review membership permissions and required billing timestamp columns'; end if;
end $base$;
lock table tenh_bakong_private.request_budgets,public.business_subscriptions,public.billing_transactions,public.bakong_payment_attempts,public.manual_payment_requests,public.manual_payment_uploads,public.tenh_billing_invoices,tenh_bakong_private.provider_calls,tenh_bakong_private.settlements,tenh_bakong_private.events in share row exclusive mode;
create temporary table khqr_bundle_functions on commit drop as
select p.oid,p.proacl,p.proowner,p.prosecdef,p.proconfig,c.signature,c.body_md5,c.may_change,
  md5(replace(p.prosrc,chr(13),'')) original_body_md5
from (values ('public.tenh_apply_bakong_payment(uuid,uuid)','734581860b23f49c831d70163f9ae6a4',false),
('public.tenh_bakong_inquiry_status(uuid,text,integer)','1ecd8c644bd746baa06c7dcfb02649aa',false),
('tenh_bakong_private.apply_subscription(text,numeric,numeric,text,text,integer,text,jsonb,boolean)','84fac054c9e942ada433a889cb242cd1',false),
('tenh_bakong_private.reserved_inquiries(text,uuid)','5100e8ddc036e632e8dce4a29d2657fc',true),
('public.tenh_claim_bakong_check(uuid,text,integer)','a2d6677fbce1d804263509cbf4c06174',false),
('public.tenh_complete_bakong_check(uuid,uuid,jsonb,uuid)','ec932badc13a255a6ba22ade33d9e549',false),
('public.tenh_guard_pending_payment_claim()','c3b036562bcab59da37ef43211dc76d7',true),
('public.tenh_issue_billing_invoice(text,uuid)','a66bcfe08a0ee05dc25390f9aaedd911',false),
('public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer)','49a41bf868233e6409574b347818de19',true)) c(signature,body_md5,may_change)
left join pg_proc p on p.oid=to_regprocedure(c.signature);
do $contracts$
begin
  if exists(select 1 from khqr_bundle_functions where oid is null or original_body_md5<>body_md5) then
    raise exception 'Exact installed checkout function contract mismatch; no partial installation is allowed'; end if;
end $contracts$;
create temporary table khqr_bundle_relations(relation_name text primary key,key_column text) on commit drop;
insert into khqr_bundle_relations values ('tenh_bakong_private.request_budgets','budget_key'),('public.business_subscriptions','id'),('public.billing_transactions','id'),('public.bakong_payment_attempts','id'),('public.manual_payment_requests','id'),('public.manual_payment_uploads','id'),('public.tenh_billing_invoices','id'),('tenh_bakong_private.provider_calls','id'),('tenh_bakong_private.settlements','hash'),('tenh_bakong_private.events','id');
create temporary table khqr_bundle_rows(relation_name text,row_key text,row_digest text,primary key(relation_name,row_key)) on commit drop;
do $snapshot$
declare r record;
begin
  for r in select * from khqr_bundle_relations loop
    execute format('insert into khqr_bundle_rows select %L,t.%I::text,md5(to_jsonb(t)::text) from %s t',r.relation_name,r.key_column,r.relation_name::regclass);
  end loop;
end $snapshot$;

-- BEGIN COMPONENT db/migrations/20261016083154_payment_cancellation_safety.sql
-- FORWARD DRAFT ONLY. Apply separately after billing-writer/trigger review.
-- No provider requests, proof deletion, subscription changes or budget refunds.

create table public.payment_cancellations (
  kind text not null check (kind in ('payway','bakong','manual')),
  payment_id text not null,
  business_id uuid not null,
  actor_user_id uuid not null,
  member_id uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  -- checkout_closed: a KHQR checkout closed by the customer. Settlement is still unknown.
  outcome text not null check (outcome in ('processing','reconciliation_required','cancelled','checkout_closed','withdrawn','paid')),
  reason text not null check (reason in ('customer_cancelled','proof_withdrawn')),
  completed_at timestamptz,
  provider_result jsonb,
  primary key(kind,payment_id)
);
alter table public.payment_cancellations enable row level security;
revoke all on public.payment_cancellations from public,anon,authenticated,service_role;
grant select on public.payment_cancellations to service_role;

-- Service-only RPC: the actor comes from server-verified authentication, never a browser field.
create function public.tenh_request_payment_cancellation(
  p_kind text,p_payment_id text,p_business uuid,p_actor uuid,p_member uuid,p_withdraw boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.team_members%rowtype; b public.billing_transactions%rowtype;
  a public.bakong_payment_attempts%rowtype; u public.manual_payment_uploads%rowtype;
  r public.manual_payment_requests%rowtype; c public.payment_cancellations%rowtype; result text;
begin
  perform 1 from public.business_subscriptions where business_id=p_business for update;
  if not found then raise exception 'Subscription missing'; end if;
  select * into m from public.team_members where id=p_member and user_id=p_actor and business_id=p_business and is_active for share;
  if not found or not (coalesce(m.role,'')='owner' or coalesce(m.permissions->>'billing','view')='manage') then
    raise exception 'Billing management permission required' using errcode='42501';
  end if;
  select * into c from public.payment_cancellations where kind=p_kind and payment_id=p_payment_id;
  if found then
    if c.business_id<>p_business then raise exception 'Payment missing'; end if;
    return to_jsonb(c)||jsonb_build_object('claimed',false);
  end if;
  if p_kind in ('payway','bakong') then
    select * into b from public.billing_transactions where business_id=p_business and provider=p_kind
      and case when p_kind='payway' then provider_transaction_id=p_payment_id else id::text=p_payment_id end for update;
    if not found then raise exception 'Payment missing'; end if;
    if b.status<>'pending' then raise exception 'Payment is no longer awaiting payment; refresh its status'; end if;
    if p_kind='bakong' then
      select * into a from public.bakong_payment_attempts where id=b.id for update;
      if not found or a.state<>'pending' or a.verified_hash is not null then
        raise exception 'Payment is verified or requires review; it cannot be cancelled';
      end if;
      -- An expired checkout is already closed; nothing to record.
      if a.expires_at<=clock_timestamp() then
        return jsonb_build_object('kind',p_kind,'payment_id',p_payment_id,'outcome','expired','claimed',false);
      end if;
      -- An issued KHQR cannot be revoked. Close the checkout only: the billing row stays pending,
      -- inquiries and evidence are kept, and a late settlement goes to review (trigger below).
      result:='checkout_closed';
    else
      result:=case when b.metadata->>'checkout_contract_version'='2' then 'processing' else 'reconciliation_required' end;
    end if;
  elsif p_kind='manual' then
    -- Same subscription -> upload -> request order as manual finalization.
    select * into u from public.manual_payment_uploads where id::text=p_payment_id and business_id=p_business for update;
    select * into r from public.manual_payment_requests where id::text=p_payment_id and business_id=p_business for update;
    if found then
      if r.status::text<>'submitted' or p_withdraw is distinct from true then
        raise exception 'Submitted proof requires explicit withdrawal; paid or reviewed payments cannot be cancelled';
      end if;
      update public.manual_payment_requests set status='cancelled' where id=r.id;
      -- Withdrawal stops review, but does not establish that no transfer occurred.
      result:='withdrawn';
    else
      if u.id is null or u.state<>'prepared' then raise exception 'Payment is no longer awaiting payment'; end if;
      if p_withdraw is true then raise exception 'There is no submitted proof to withdraw'; end if;
      update public.manual_payment_uploads set state='aborted' where id=u.id;
      result:='cancelled';
    end if;
  else raise exception 'Unsupported payment method'; end if;
  insert into public.payment_cancellations(kind,payment_id,business_id,actor_user_id,member_id,outcome,reason,completed_at)
    values(p_kind,p_payment_id,p_business,p_actor,p_member,result,case when result='withdrawn' then 'proof_withdrawn' else 'customer_cancelled' end,
      case when result='processing' then null else clock_timestamp() end)
    returning * into c;
  return to_jsonb(c)||jsonb_build_object('claimed',result='processing');
end $$;

-- Close evidence is provided only by the server's PayWay client, never by the caller.
create function public.tenh_finish_payway_cancellation(p_payment_id text,p_closed boolean,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.payment_cancellations%rowtype; b public.billing_transactions%rowtype; bid uuid;
begin
  select business_id into bid from public.payment_cancellations where kind='payway' and payment_id=p_payment_id;
  perform 1 from public.business_subscriptions where business_id=bid for update;
  select * into b from public.billing_transactions where provider='payway' and provider_transaction_id=p_payment_id for update;
  select * into c from public.payment_cancellations where kind='payway' and payment_id=p_payment_id for update;
  if not found then raise exception 'Cancellation was not requested'; end if;
  if c.outcome<>'processing' then return to_jsonb(c); end if;
  if b.status='approved' then
    update public.payment_cancellations set outcome='paid',completed_at=clock_timestamp(),provider_result=p_result
      where kind='payway' and payment_id=p_payment_id returning * into c;
  elsif p_closed and b.status in ('pending','cancelled','declined','failed') then
    update public.billing_transactions set status='cancelled',provider_status='CUSTOMER_CANCELLED',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('customer_cancelled',true,
        'customer_cancelled_at',clock_timestamp(),'customer_cancelled_by',c.actor_user_id,'payway_close',p_result)
      where id=b.id;
    update public.payment_cancellations set outcome='cancelled',completed_at=clock_timestamp(),provider_result=p_result
      where kind='payway' and payment_id=p_payment_id returning * into c;
  else
    update public.payment_cancellations set outcome='reconciliation_required',completed_at=clock_timestamp(),provider_result=p_result
      where kind='payway' and payment_id=p_payment_id returning * into c;
  end if;
  return to_jsonb(c);
end $$;

-- New claims cannot bypass a withdrawn/uncertain attempt by switching providers.
create function public.tenh_guard_cancellation_checkout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='billing_transactions' then
    if new.provider not in ('payway','bakong') or new.status<>'pending' then return new; end if;
  elsif tg_table_name='manual_payment_requests' then
    if new.status::text not in ('draft','pending','submitted') then return new; end if;
  else
    if new.state<>'prepared' then return new; end if;
  end if;
  perform 1 from public.business_subscriptions where business_id=new.business_id for update;
  if exists(select 1 from public.payment_cancellations where business_id=new.business_id
    and outcome in ('processing','reconciliation_required','withdrawn')) then
    raise exception 'Payment reconciliation is required before another checkout'
      using errcode='23505',detail='TENH_BILLING_CANCELLATION_REVIEW';
  end if;
  return new;
end $$;
create trigger tenh_00_cancellation_checkout before insert on public.billing_transactions
  for each row execute function public.tenh_guard_cancellation_checkout();
create trigger tenh_00_cancellation_checkout before insert on public.manual_payment_uploads
  for each row execute function public.tenh_guard_cancellation_checkout();
create trigger tenh_00_cancellation_checkout before insert on public.manual_payment_requests
  for each row execute function public.tenh_guard_cancellation_checkout();

-- Keep late KHQR evidence, but never auto-apply it after a cancellation request.
create function public.tenh_guard_cancelled_bakong_settlement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.state='verified' and exists(select 1 from public.payment_cancellations
    where kind='bakong' and payment_id=new.id::text) then
    new.state:='review'; new.reason:='CANCELLATION_PAYMENT_REVIEW';
  end if;
  return new;
end $$;
create trigger tenh_cancelled_bakong_settlement before update on public.bakong_payment_attempts
  for each row execute function public.tenh_guard_cancelled_bakong_settlement();

-- Existing finalizers preserve late approval as recovery evidence instead of applying it.
create function public.tenh_reconcile_cancelled_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.kind='recovery_required' then
    update public.payment_cancellations c set outcome='reconciliation_required'
      from public.billing_transactions b where b.id=new.source_payment_id and b.provider='payway'
        and c.kind='payway' and c.payment_id=b.provider_transaction_id and c.outcome='cancelled';
  end if;
  return new;
end $$;
create trigger tenh_reconcile_cancelled_payment after insert on tenh_billing_private.reconciliation_events
  for each row execute function public.tenh_reconcile_cancelled_payment();

-- A callback can finish after the cancelling HTTP worker has disappeared.
create function public.tenh_note_cancellation_payment_confirmation() returns trigger
language plpgsql security definer set search_path='' as $$
declare payment_kind text; payment_key text;
begin
  if new.status::text<>'approved' then return new; end if;
  if tg_table_name='billing_transactions' then
    payment_kind:=new.provider;
    payment_key:=case when new.provider='payway' then new.provider_transaction_id else new.id::text end;
  else payment_kind:='manual'; payment_key:=new.id::text; end if;
  update public.payment_cancellations set outcome='paid',completed_at=coalesce(completed_at,clock_timestamp())
    where kind=payment_kind and payment_id=payment_key and business_id=new.business_id
      and outcome in ('processing','reconciliation_required','withdrawn');
  return new;
end $$;
create trigger tenh_cancellation_payment_confirmation after update of status on public.billing_transactions
  for each row execute function public.tenh_note_cancellation_payment_confirmation();
create trigger tenh_cancellation_payment_confirmation after update of status on public.manual_payment_requests
  for each row execute function public.tenh_note_cancellation_payment_confirmation();

revoke all on function public.tenh_request_payment_cancellation(text,text,uuid,uuid,uuid,boolean),
  public.tenh_finish_payway_cancellation(text,boolean,jsonb),public.tenh_guard_cancellation_checkout(),
  public.tenh_guard_cancelled_bakong_settlement(),public.tenh_reconcile_cancelled_payment(),
  public.tenh_note_cancellation_payment_confirmation() from public,anon,authenticated,service_role;
grant execute on function public.tenh_request_payment_cancellation(text,text,uuid,uuid,uuid,boolean),
  public.tenh_finish_payway_cancellation(text,boolean,jsonb) to service_role;

-- END COMPONENT db/migrations/20261016083154_payment_cancellation_safety.sql

-- BEGIN COMPONENT db/migrations/20261016093000_bakong_checkout_lifecycle.sql
-- LOCAL REVIEW DRAFT. No hosted execution, payment rewrites, provider calls or budget resets.
-- Separates the KHQR checkout lifecycle (open / expired / closed by the customer) from payment
-- settlement. A closed checkout stops blocking new purchases. Its billing row stays 'pending'
-- (settlement unknown), and all evidence, inquiries and late-confirmation review are retained.
-- Requires 20261016083154_payment_cancellation_safety.sql and the reviewed Bakong migrations.
-- Existing stale attempts need no backfill: expiry is derived from the server-set expires_at.
-- Rollback: stop Bakong checkout, then restore the two patched function bodies and the prior
-- reserved_inquiries body. Keep the cancellation ledger (append-only evidence).

set local lock_timeout='2s';
set local statement_timeout='60s';

do $preflight$
begin
  if current_user not in ('postgres','supabase_admin') or not public.tenh_payment_application_guards_ready() then
    raise exception 'Trusted owner and installed payment guards are required'; end if;
  if to_regprocedure('tenh_bakong_private.reserved_inquiries(text,uuid)') is null
    or to_regclass('public.payment_cancellations') is null then
    raise exception 'Install the reviewed Bakong authorization and payment-cancellation migrations first'; end if;
end $preflight$;

-- The only KHQR attempt that blocks a workspace: a checkout that can still be paid and applied
-- automatically, or one with received/disputed funds awaiting application or review.
-- Expired or customer-closed unpaid QRs never block.
create function public.tenh_bakong_blocking_attempt(p_business uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select a.id from public.bakong_payment_attempts a join public.billing_transactions b on b.id=a.id
  where a.business_id=p_business and b.status='pending'
    and (a.state in ('verified','review')
      or (a.state='pending' and a.verified_hash is null and a.expires_at>clock_timestamp()
        and not exists(select 1 from public.payment_cancellations c where c.kind='bakong' and c.payment_id=a.id::text)))
  order by a.created_at limit 1
$$;

-- Unused inquiry reservations are held through the QR lifetime plus one hour for late bank
-- confirmation, then released. Used requests stay counted (provider_calls is never reset), and
-- the three-request lifetime cap per attempt is unchanged.
create or replace function tenh_bakong_private.reserved_inquiries(p_environment text,p_exclude uuid default null) returns integer
language sql stable security definer set search_path='' as $$
  select coalesce(sum(greatest(0,3-(select count(*) from tenh_bakong_private.provider_calls c where c.attempt_id=a.id))),0)::integer
  from public.bakong_payment_attempts a where a.environment=p_environment and a.state in ('pending','review')
    and a.verified_hash is null and (p_exclude is null or a.id<>p_exclude)
    and a.expires_at>clock_timestamp()-interval '1 hour'
$$;

-- Patch only the reviewed clauses; keep OIDs, ACLs, lock order and financial guards.
do $contracts$
declare s text; original text; target regprocedure; acl_before aclitem[];
begin
  target:='public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer)'::regprocedure;
  select proacl into acl_before from pg_proc where oid=target;
  s:=replace(pg_get_functiondef(target),chr(13),'');
  -- Never replay a closed checkout for a reused purchase intent.
  original:=$old$    if a.selection is distinct from p_selection then raise exception 'Purchase intent is immutable' using errcode='22023'; end if;
    return to_jsonb(a);$old$;
  if strpos(s,original)=0 then raise exception 'Review the installed Bakong intent replay clause'; end if;
  s:=replace(s,original,$new$    if a.selection is distinct from p_selection then raise exception 'Purchase intent is immutable' using errcode='22023'; end if;
    if a.state='pending' and a.verified_hash is null and (a.expires_at<=clock_timestamp()
      or exists(select 1 from public.payment_cancellations c where c.kind='bakong' and c.payment_id=a.id::text)) then
      raise exception 'Checkout closed' using errcode='55000',detail='TENH_BAKONG_CHECKOUT_CLOSED'; end if;
    return to_jsonb(a);$new$);
  -- Resume only a still-open checkout (or received funds); never an expired or closed one.
  original:=$old$    where a0.business_id=bid and b.status='pending' order by a0.created_at limit 1;$old$;
  if strpos(s,original)=0 then raise exception 'Review the installed Bakong resume clause'; end if;
  s:=replace(s,original,$new$    where a0.id=public.tenh_bakong_blocking_attempt(bid) and b.status='pending';$new$);
  execute s;
  if (select proacl from pg_proc where oid=target) is distinct from acl_before then
    raise exception 'Bakong preparation permissions changed'; end if;

  target:='public.tenh_guard_pending_payment_claim()'::regprocedure;
  s:=replace(pg_get_functiondef(target),chr(13),'');
  original:=$old$provider in ('payway','bakong') and status = 'pending')$old$;
  if strpos(s,original)=0 then raise exception 'Review the installed pending-claim contract'; end if;
  execute replace(s,original,$new$provider = 'payway' and status = 'pending')
    or public.tenh_bakong_blocking_attempt(new.business_id) is not null$new$);
end $contracts$;

revoke all on function public.tenh_bakong_blocking_attempt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.tenh_bakong_blocking_attempt(uuid) to service_role;

-- END COMPONENT db/migrations/20261016093000_bakong_checkout_lifecycle.sql

-- BEGIN COMPONENT db/proposals/20261016105717_bakong_closed_checkout_accounting.sql
-- LOCAL PROPOSAL ONLY. Filename generated with the existing Supabase CLI migration new.
-- Deliberately outside db/migrations. No hosted execution or feature enablement.
-- Requires the reviewed 083154 cancellation + 093000 lifecycle drafts in an isolated fixture.
-- A production candidate must consolidate those dependencies and this correction atomically.
-- No per-user/workspace QR count cap. No provider calls, refunds, transfers or plan changes.

set local lock_timeout='2s';
set local statement_timeout='60s';

create temporary table khqr_accounting_contracts on commit drop as
select p.oid,p.proacl,p.proowner,p.prosecdef,p.proconfig,p.proname,
  md5(replace(p.prosrc,chr(13),'')) body_md5
from pg_proc p where p.oid in (
  'tenh_bakong_private.reserved_inquiries(text,uuid)'::regprocedure,
  'public.tenh_request_payment_cancellation(text,text,uuid,uuid,uuid,boolean)'::regprocedure,
  'public.tenh_guard_cancelled_bakong_settlement()'::regprocedure
);
do $preflight$
begin
  if current_user not in ('postgres','supabase_admin') or not public.tenh_payment_application_guards_ready()
    or (select count(*) from khqr_accounting_contracts)<>3
    or exists(select 1 from khqr_accounting_contracts where body_md5 is distinct from
      case proname when 'reserved_inquiries' then 'a4eb46bac7671ac59040d2982847e398'
        when 'tenh_request_payment_cancellation' then 'e34f8a84afac49d75aea1ae970bfee5d'
        when 'tenh_guard_cancelled_bakong_settlement' then '44383776e840663ce321b4ca69e1a469' end) then
    raise exception 'Review the exact installed KHQR accounting/cancellation contracts';
  end if;
end $preflight$;

-- Escrow only future inquiries for a checkout that is still open. Closing/expiry releases
-- unused promises, NOT provider_calls. Claimed/in-flight/failed/lost calls remain counted.
-- Old closed QRs retain evidence and at most three lifetime checks, using spare global capacity.
create or replace function tenh_bakong_private.reserved_inquiries(p_environment text,p_exclude uuid default null) returns integer
language sql volatile security definer set search_path='' as $$
  select coalesce(sum(greatest(0,3-(select count(*) from tenh_bakong_private.provider_calls c where c.attempt_id=a.id))),0)::integer
  from public.bakong_payment_attempts a
  where a.environment=p_environment and a.state in ('pending','review') and a.verified_hash is null
    and a.expires_at>clock_timestamp() and (p_exclude is null or a.id<>p_exclude)
    and not exists(select 1 from public.payment_cancellations c where c.kind='bakong' and c.payment_id=a.id::text)
$$;
-- Authoritative decisions after a lock wait must not reuse a calling-query snapshot.
alter function public.tenh_bakong_blocking_attempt(uuid) volatile;

-- Serialize cancellation's reservation release with fresh issuance and inquiry claiming.
-- Preserve the RPC OID/ACL and the PayWay/manual branches. Never clear or replace a live lease.
do $cancellation$
declare s text;
begin
  s:=pg_get_functiondef('public.tenh_request_payment_cancellation(text,text,uuid,uuid,uuid,boolean)'::regprocedure);
  s:=replace(replace(s,chr(13),''),'c public.payment_cancellations%rowtype; result text;',
    'c public.payment_cancellations%rowtype; result text; checkout_environment text;');
  s:=replace(s,$old$begin
  perform 1 from public.business_subscriptions where business_id=p_business for update;$old$,
    $new$begin
  if p_kind='bakong' then
    select environment into checkout_environment from public.bakong_payment_attempts
      where id::text=p_payment_id and business_id=p_business;
    if not found then raise exception 'Payment missing'; end if;
    perform 1 from tenh_bakong_private.request_budgets q
      where q.budget_key='khqr:'||checkout_environment for update;
    if not found then raise exception 'Saved inquiry budget missing'; end if;
  end if;
  perform 1 from public.business_subscriptions where business_id=p_business for update;$new$);
  if strpos(s,'Saved inquiry budget missing')=0 or strpos(s,'checkout_environment text')=0 then
    raise exception 'Cancellation budget lock patch failed'; end if;
  execute s;
end $cancellation$;

-- Never auto-apply after customer closure, or while related confirmed money is in review.
create or replace function public.tenh_guard_cancelled_bakong_settlement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.state='verified' then
    if exists(select 1 from public.payment_cancellations where kind='bakong' and payment_id=new.id::text) then
      new.state:='review'; new.reason:='CANCELLATION_PAYMENT_REVIEW';
    elsif exists(select 1 from public.bakong_payment_attempts a where a.business_id=new.business_id
      and a.id<>new.id and a.state='review' and a.verified_hash is not null) then
      new.state:='review'; new.reason:='WORKSPACE_LATE_PAYMENT_REVIEW';
    end if;
  end if;
  return new;
end $$;

-- Completion already holds global budget -> subscription -> attempt locks. Keep a replacement
-- from looking payable when late funds are now known. Already applied purchases are untouched.
-- A saved QR is not revoked: further confirmed money is retained as another review case.
create function tenh_bakong_private.hold_related_checkouts() returns trigger
language plpgsql security definer set search_path='' as $$
declare held uuid;
begin
  if new.state<>'review' or new.verified_hash is null
    or new.reason not in ('CANCELLATION_PAYMENT_REVIEW','LATE_PAYMENT_REVIEW','WORKSPACE_LATE_PAYMENT_REVIEW')
    or (old.state='review' and old.verified_hash is not distinct from new.verified_hash and old.reason is not distinct from new.reason) then
    return new;
  end if;
  for held in update public.bakong_payment_attempts a
    set state='review',reason='WORKSPACE_LATE_PAYMENT_REVIEW',updated_at=clock_timestamp()
    where a.business_id=new.business_id and a.id<>new.id and a.state in ('pending','verified')
    returning a.id
  loop
    insert into tenh_bakong_private.events(attempt_id,event,reason)
      values(held,'review','Related confirmed payment requires operator review: '||new.id::text);
  end loop;
  return new;
end $$;
create trigger bakong_hold_related_checkouts after update of state,verified_hash on public.bakong_payment_attempts
  for each row execute function tenh_bakong_private.hold_related_checkouts();
revoke all on function tenh_bakong_private.hold_related_checkouts() from public,anon,authenticated,service_role;

do $preservation$
begin
  if exists(select 1 from khqr_accounting_contracts b left join pg_proc p on p.oid=b.oid
    where p.oid is null or row(p.proacl,p.proowner,p.prosecdef,p.proconfig)
      is distinct from row(b.proacl,b.proowner,b.prosecdef,b.proconfig)) then
    raise exception 'KHQR accounting RPC identity or permissions changed'; end if;
end $preservation$;

-- END COMPONENT db/proposals/20261016105717_bakong_closed_checkout_accounting.sql

-- BEGIN COMPONENT db/proposals/20261016111428_bakong_admin_original_plan_resolution.sql
-- LOCAL COMPONENT PROPOSAL. User selected explicit admin application of the original purchase.
-- No automatic application, refund, transfer, provider inquiry, or feature enablement.
-- Service RPC caller must be the server's canonical freshly verified TENH billing admin;
-- p_actor is taken from that authentication result, never from the browser's request body.

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

-- END COMPONENT db/proposals/20261016111428_bakong_admin_original_plan_resolution.sql

-- Read-only deployment capability probe; it never enables the application code gate.
create function public.tenh_khqr_checkout_capabilities() returns jsonb language sql immutable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'accounting','open-checkout-reservations','originalPlanResolution','explicit-admin','qrCountCap',false)
$$;
revoke all on function public.tenh_khqr_checkout_capabilities() from public,anon,authenticated,service_role;
grant execute on function public.tenh_khqr_checkout_capabilities() to service_role;
do $preserve$
declare r record; changed boolean;
begin
  if exists(select 1 from khqr_bundle_functions b left join pg_proc p on p.oid=b.oid where p.oid is null
    or row(p.proacl,p.proowner,p.prosecdef,p.proconfig) is distinct from row(b.proacl,b.proowner,b.prosecdef,b.proconfig)
    or (not b.may_change and md5(replace(p.prosrc,chr(13),''))<>b.original_body_md5)) then
    raise exception 'Existing billing algorithm, RPC identity or privileges changed unexpectedly'; end if;
  for r in select * from khqr_bundle_relations loop
    execute format('select exists((select t.%I::text,md5(to_jsonb(t)::text) from %s t except select row_key,row_digest from khqr_bundle_rows where relation_name=%L) union all (select row_key,row_digest from khqr_bundle_rows where relation_name=%L except select t.%I::text,md5(to_jsonb(t)::text) from %s t))',r.key_column,r.relation_name::regclass,r.relation_name,r.relation_name,r.key_column,r.relation_name::regclass) into changed;
    if changed then raise exception 'Existing rows changed during checkout DDL: %',r.relation_name; end if;
  end loop;
  if exists(select 1 from pg_proc p where p.oid in (
    'public.tenh_request_payment_cancellation(text,text,uuid,uuid,uuid,boolean)'::regprocedure,
    'public.tenh_bakong_original_plan_preview(uuid[])'::regprocedure,
    'public.tenh_apply_reviewed_bakong_original_plan(uuid,uuid,uuid,text,text)'::regprocedure,
    'public.tenh_khqr_checkout_capabilities()'::regprocedure)
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then
    raise exception 'An untrusted client can execute a checkout administration RPC'; end if;
  if not (select relrowsecurity from pg_class where oid='public.payment_cancellations'::regclass)
    or not (select relrowsecurity from pg_class where oid='tenh_bakong_private.late_application_resolutions'::regclass)
    or has_table_privilege('service_role','public.payment_cancellations','INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role','tenh_bakong_private.late_application_resolutions','INSERT,UPDATE,DELETE') then
    raise exception 'Checkout audit storage protection changed'; end if;
  if exists(select 1 from pg_proc where oid in (
    'tenh_bakong_private.reserved_inquiries(text,uuid)'::regprocedure,
    'public.tenh_bakong_blocking_attempt(uuid)'::regprocedure,
    'tenh_bakong_private.original_plan_conflict(uuid)'::regprocedure,
    'public.tenh_bakong_original_plan_preview(uuid[])'::regprocedure) and provolatile<>'v') then
    raise exception 'Authoritative checkout checks must use fresh snapshots after lock waits'; end if;
end $preserve$;
commit;
