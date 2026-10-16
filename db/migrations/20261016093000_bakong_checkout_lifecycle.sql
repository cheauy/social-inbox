-- LOCAL REVIEW DRAFT. No hosted execution, payment rewrites, provider calls or budget resets.
-- Separates the KHQR checkout lifecycle (open / expired / closed by the customer) from payment
-- settlement. A closed checkout stops blocking new purchases. Its billing row stays 'pending'
-- (settlement unknown), and all evidence, inquiries and late-confirmation review are retained.
-- Requires 20261016083154_payment_cancellation_safety.sql and the reviewed Bakong migrations.
-- Existing stale attempts need no backfill: expiry is derived from the server-set expires_at.
-- Rollback: stop Bakong checkout, then restore the two patched function bodies and the prior
-- reserved_inquiries body. Keep the cancellation ledger (append-only evidence).
begin;
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
commit;
