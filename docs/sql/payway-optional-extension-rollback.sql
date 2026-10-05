-- REVIEW DRAFT ONLY. Stop new Custom Upgrade checkouts before rollback.
-- Does not alter payments, invoices, or subscription data.
-- Quiesce ALL billing activation/approval/recovery/lifecycle writes and wait
-- for in-flight transactions to finish before taking these DDL locks.
begin;
lock table public.billing_transactions, public.manual_payment_requests,
  public.business_subscriptions in share row exclusive mode;
do $rollback_preflight$
begin
  if exists(select 1 from public.billing_transactions where status='pending'
      and pricing_snapshot->>'custom_upgrade_version'='2')
    or exists(select 1 from public.manual_payment_requests where status in ('submitted','pending','draft')
      and pricing_snapshot->>'custom_upgrade_version'='2') then
    raise exception 'Drain version 2 payments under version 2 rules before rollback.';
  end if;
  if exists(select 1 from public.business_subscriptions where status='active'
    and current_period_end>now()
    and pricing_snapshot->>'paid_term_basis_version'='1'
    and jsonb_typeof(pricing_snapshot->'paid_term_segments')='array'
    and jsonb_array_length(pricing_snapshot->'paid_term_segments')>1) then
    raise exception 'Active mixed paid terms cannot be represented by the old pricing model; keep the segment-aware release.';
  end if;
  if exists(select 1 from public.business_subscriptions where plan_code='custom'
    and (channel_limit not between 1 and 30 or member_limit not between 3 and 100)) then
    raise exception 'Old constraint cannot represent current subscriptions; keep the aligned constraint and review rollback.';
  end if;
end;
$rollback_preflight$;
drop trigger if exists tenh_validate_payway_custom_upgrade on public.billing_transactions;
drop trigger if exists tenh_validate_manual_custom_upgrade on public.manual_payment_requests;
drop trigger if exists tenh_validate_payway_plan_purchase on public.billing_transactions;
drop trigger if exists tenh_validate_manual_plan_purchase on public.manual_payment_requests;
create trigger tenh_validate_payway_plan_purchase before insert on public.billing_transactions
for each row execute function public.tenh_validate_plan_purchase();
create trigger tenh_validate_manual_plan_purchase before insert on public.manual_payment_requests
for each row execute function public.tenh_validate_plan_purchase();
drop trigger if exists tenh_guard_payway_custom_upgrade_approval on public.billing_transactions;
drop trigger if exists tenh_guard_manual_custom_upgrade_approval on public.manual_payment_requests;
drop trigger if exists tenh_set_custom_upgrade_invoice_period on public.tenh_billing_invoices;
drop function if exists public.tenh_validate_custom_upgrade_purchase();
drop function if exists public.tenh_guard_custom_upgrade_approval();
drop function if exists public.tenh_set_custom_upgrade_invoice_period();
alter table public.business_subscriptions drop constraint if exists business_subscriptions_custom_capacity_check;
alter table public.business_subscriptions add constraint business_subscriptions_custom_capacity_check
check (plan_code <> 'custom' or (channel_limit between 1 and 30 and member_limit between 3 and 100));
commit;
