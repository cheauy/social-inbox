-- FORWARD DRAFT ONLY. Do not apply automatically.
-- Fence/drain billing writers, review installed trigger/RPC compatibility, apply,
-- verify service-only ACLs and local concurrency checks, then deploy all callers.
-- Retain this additive schema and the safe API on rollback. No file cleanup.
begin;

create table public.manual_payment_uploads (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- Retain the initiating identity after membership removal; actions recheck it.
  member_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  selection jsonb not null check (jsonb_typeof(selection) = 'object'),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  state text not null default 'prepared' check (state in ('prepared','submitted','aborted')),
  created_at timestamptz not null default clock_timestamp(),
  check (storage_path like business_id::text || '/' || id::text || '/%')
);
alter table public.manual_payment_uploads enable row level security;
revoke all on public.manual_payment_uploads from public, anon, authenticated;
grant select, insert, update on public.manual_payment_uploads to service_role;
create unique index manual_payment_uploads_one_prepared_per_business
  on public.manual_payment_uploads (business_id) where state = 'prepared';
create index manual_payment_requests_submitted_business
  on public.manual_payment_requests (business_id, created_at desc, id desc) where status = 'submitted';

-- All new pending claims serialize on the same existing subscription row.
-- Ordinary status updates never acquire it while holding a payment row lock.
create function public.tenh_guard_pending_payment_claim() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare own_manual_id uuid;
begin
  if tg_table_name = 'billing_transactions' then
    if new.provider <> 'payway' or new.status <> 'pending' then return new; end if;
    if tg_op = 'UPDATE' and old.status = 'pending' and old.provider = 'payway' then
      if new.business_id is distinct from old.business_id then raise exception 'Payment workspace is immutable'; end if;
      return new;
    end if;
  elsif tg_table_name = 'manual_payment_requests' then
    if new.status::text not in ('draft','pending','submitted') then return new; end if;
    if tg_op = 'UPDATE' and old.status::text in ('draft','pending','submitted') then
      if new.business_id is distinct from old.business_id then raise exception 'Payment workspace is immutable'; end if;
      return new;
    end if;
    own_manual_id := new.id;
  else
    if new.state <> 'prepared' then return new; end if;
    if exists (select 1 from public.manual_payment_requests where id = new.id) then
      raise exception 'Payment attempt identifier is unavailable' using errcode = '23505';
    end if;
    if not exists (select 1 from public.team_members where id = new.member_id and business_id = new.business_id and is_active) then
      raise exception 'Membership was revoked' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then raise exception 'A terminal payment cannot be reopened'; end if;
  if current_setting('transaction_isolation') <> 'read committed' then raise exception 'Payment claims require READ COMMITTED'; end if;
  perform 1 from public.business_subscriptions where business_id = new.business_id for update;
  if not found then raise exception 'Subscription row was not found'; end if;
  if exists (select 1 from public.billing_transactions where business_id = new.business_id and provider = 'payway' and status = 'pending')
    or exists (select 1 from public.manual_payment_requests where business_id = new.business_id and status::text in ('draft','pending','submitted') and id is distinct from own_manual_id)
    or exists (select 1 from public.manual_payment_uploads where business_id = new.business_id and state = 'prepared' and id is distinct from own_manual_id) then
    raise exception 'An unresolved payment attempt must be reconciled first'
      using errcode = '23505', detail = 'TENH_BILLING_PURCHASE_PENDING';
  end if;
  return new;
end;
$$;
revoke all on function public.tenh_guard_pending_payment_claim() from public, anon, authenticated;
grant execute on function public.tenh_guard_pending_payment_claim() to service_role;
create trigger tenh_00_pending_payment_claim before insert or update on public.billing_transactions
  for each row execute function public.tenh_guard_pending_payment_claim();
create trigger tenh_00_pending_payment_claim before insert or update on public.manual_payment_requests
  for each row execute function public.tenh_guard_pending_payment_claim();
create trigger tenh_00_pending_payment_claim before insert on public.manual_payment_uploads
  for each row execute function public.tenh_guard_pending_payment_claim();

create function public.tenh_finalize_manual_payment_upload(
  p_request_id uuid, p_business_id uuid, p_member_id uuid, p_customer_note text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare attempt public.manual_payment_uploads%rowtype; saved public.manual_payment_requests%rowtype;
begin
  perform 1 from public.business_subscriptions where business_id = p_business_id for update;
  select * into attempt from public.manual_payment_uploads where id = p_request_id
    and business_id = p_business_id and member_id = p_member_id for update;
  if not found then raise exception 'Prepared payment upload was not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.team_members where id = p_member_id and business_id = p_business_id and is_active) then
    raise exception 'Membership was revoked' using errcode = '42501';
  end if;
  select * into saved from public.manual_payment_requests where id = attempt.id;
  if found then
    if saved.business_id is distinct from attempt.business_id or saved.requested_by_member_id is distinct from attempt.member_id
      or saved.proof_path is distinct from attempt.storage_path then raise exception 'Payment identity mismatch' using errcode = '42501'; end if;
    update public.manual_payment_uploads set state = 'submitted' where id = attempt.id;
    return to_jsonb(saved);
  end if;
  if attempt.state <> 'prepared' then raise exception 'This payment attempt is no longer open' using errcode = '22023'; end if;
  insert into public.manual_payment_requests (
    id,business_id,requested_by_member_id,plan_code,billing_cycle,target_member_limit,target_channel_limit,
    pricing_version,renew_same,pricing_snapshot,amount,currency,status,transfer_reference,customer_note,
    proof_bucket,proof_path,proof_file_name,proof_mime_type,proof_size_bytes
  ) values (
    attempt.id,attempt.business_id,attempt.member_id,attempt.request_payload->>'plan_code',attempt.request_payload->>'billing_cycle',
    (attempt.request_payload->>'target_member_limit')::integer,(attempt.request_payload->>'target_channel_limit')::integer,
    attempt.request_payload->>'pricing_version',(attempt.request_payload->>'renew_same')::boolean,attempt.request_payload->'pricing_snapshot',
    (attempt.request_payload->>'amount')::numeric,'USD','submitted',null,nullif(left(p_customer_note,1000),''),
    'tenh-manual-payment-proofs',attempt.storage_path,attempt.file_name,attempt.mime_type,attempt.size_bytes
  ) returning * into saved;
  update public.manual_payment_uploads set state = 'submitted' where id = attempt.id;
  return to_jsonb(saved);
end;
$$;
-- Application lifecycle transitions use these service-only, transactional RPCs.
revoke all on function public.tenh_finalize_manual_payment_upload(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.tenh_finalize_manual_payment_upload(uuid,uuid,uuid,text) to service_role;

create function public.tenh_abort_manual_payment_upload(p_request_id uuid,p_business_id uuid,p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare attempt public.manual_payment_uploads%rowtype;
begin
  perform 1 from public.business_subscriptions where business_id = p_business_id for update;
  select * into attempt from public.manual_payment_uploads where id = p_request_id
    and business_id = p_business_id and member_id = p_member_id for update;
  if not found then raise exception 'Prepared payment upload was not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.team_members where id = p_member_id and business_id = p_business_id and is_active) then
    raise exception 'Membership was revoked' using errcode = '42501';
  end if;
  if exists (select 1 from public.manual_payment_requests where id = attempt.id) or attempt.state = 'submitted' then
    raise exception 'A submitted payment cannot be aborted' using errcode = '22023';
  end if;
  update public.manual_payment_uploads set state = 'aborted' where id = attempt.id;
  return jsonb_build_object('id',attempt.id,'business_id',attempt.business_id,'state','aborted');
end;
$$;
revoke all on function public.tenh_abort_manual_payment_upload(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.tenh_abort_manual_payment_upload(uuid,uuid,uuid) to service_role;

create function public.tenh_get_manual_payment_upload(p_request_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',id,'business_id',business_id,'requested_by_member_id',member_id,
    'plan_code',request_payload->>'plan_code','billing_cycle',request_payload->>'billing_cycle',
    'amount',(request_payload->>'amount')::numeric,'currency','USD','created_at',created_at,
    'file_name',file_name,'mime_type',mime_type,'size_bytes',size_bytes,
    'status',case state when 'prepared' then 'prepared' when 'aborted' then 'cancelled' else 'recovery_required' end)
  from public.manual_payment_uploads where id = p_request_id;
$$;
revoke all on function public.tenh_get_manual_payment_upload(uuid) from public, anon, authenticated;
grant execute on function public.tenh_get_manual_payment_upload(uuid) to service_role;
commit;
