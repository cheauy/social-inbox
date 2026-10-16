-- LOCAL PROPOSAL ONLY. Filename generated with the existing Supabase CLI migration new.
-- Deliberately outside db/migrations. No hosted execution or feature enablement.
-- Requires the reviewed 083154 cancellation + 093000 lifecycle drafts in an isolated fixture.
-- A production candidate must consolidate those dependencies and this correction atomically.
-- No per-user/workspace QR count cap. No provider calls, refunds, transfers or plan changes.
begin;
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
commit;
