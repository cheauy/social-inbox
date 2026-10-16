-- FORWARD DRAFT ONLY. Apply separately after billing-writer/trigger review.
-- No provider requests, proof deletion, subscription changes or budget refunds.
begin;
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
commit;
