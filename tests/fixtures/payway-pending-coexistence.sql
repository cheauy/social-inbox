-- TEST-ONLY ARCHITECTURE PROTOTYPE. NOT A PRODUCTION MIGRATION/INSTALLER.
-- Does not replace or relax the reviewed installer's preflight/fingerprints.
-- Preserves existing duplicates and blocks new pending work against ANY pending
-- PayWay row, regardless of age, version, provider inquiry result or amount.
-- Requires native PostgreSQL multi-session validation before architecture approval.
create or replace function public.tenh_guard_new_payway_checkout()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if new.provider is distinct from 'payway' or new.status is distinct from 'pending' then
    return new;
  end if;
  if tg_op='UPDATE' then
    if old.provider='payway' and old.status='pending'
      and old.business_id is not distinct from new.business_id then
      return new;
    end if;
  end if;
  -- A waiting lock followed by a new command snapshot requires READ COMMITTED.
  -- Unsupported transaction isolation fails closed instead of racing an old snapshot.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='P0001', detail='TENH_CHECKOUT_ISOLATION_REQUIRED',
      message='Checkout creation requires READ COMMITTED transaction isolation.';
  end if;
  perform 1 from public.business_subscriptions
    where business_id=new.business_id for update;
  if not found then raise exception 'Checkout subscription record is missing.'; end if;
  if exists(select 1 from public.billing_transactions
    where business_id=new.business_id and provider='payway' and status='pending'
      and id is distinct from new.id) then
    raise exception using errcode='23505', detail='TENH_PAYWAY_CHECKOUT_PENDING',
      message='An existing PayWay checkout must be resolved before another is created.';
  end if;
  return new;
end;
$function$;
-- Sort before purchase validation so the subscription lock covers its snapshot too.
create trigger tenh_00_guard_new_payway_checkout
before insert or update of status,business_id,provider on public.billing_transactions
for each row execute function public.tenh_guard_new_payway_checkout();
revoke all on function public.tenh_guard_new_payway_checkout() from public,anon,authenticated;
grant execute on function public.tenh_guard_new_payway_checkout() to service_role;
