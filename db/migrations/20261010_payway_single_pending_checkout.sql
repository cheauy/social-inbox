-- DRAFT ONLY: review and deploy separately after confirming the preflight
-- returns no rows. This file has not been run against any database.

do $$
begin
  if exists (
    select 1
    from public.billing_transactions
    where provider = 'payway'
      and status = 'pending'
    group by business_id
    having count(*) > 1
  ) then
    raise exception
      'Cannot install PayWay pending-checkout guard: duplicate pending rows exist';
  end if;
end
$$;

create unique index if not exists
  billing_transactions_one_pending_payway_per_business_idx
on public.billing_transactions (business_id)
where provider = 'payway'
  and status = 'pending';

-- Rollback, if explicitly required:
-- drop index if exists public.billing_transactions_one_pending_payway_per_business_idx;
