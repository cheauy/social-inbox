-- TENH CHAT V3.11.31.8 — RETIRE SCHEDULED DOWNGRADES
--
-- New billing model:
--   * Active subscription + higher plan -> immediate prepaid upgrade after approved payment.
--   * Active subscription + smaller plan -> buy a NEW independent subscription ID.
--   * Expired subscription -> Owner may reactivate that same subscription or buy a new one.
--   * No scheduled downgrade exists anymore.
--
-- This migration does NOT delete subscription/workspace/customer/message/channel/team data.
-- It only clears obsolete pending-downgrade intent and prevents old clients from writing it back.

begin;

update public.business_subscriptions
set
  pending_plan_code = null,
  pending_billing_cycle = null,
  pending_plan_change_type = null,
  pending_plan_requested_at = null,
  pending_plan_effective_at = null,
  pending_plan_requested_by_member_id = null,
  updated_at = now()
where pending_plan_code is not null
   or pending_billing_cycle is not null
   or pending_plan_change_type is not null
   or pending_plan_requested_at is not null
   or pending_plan_effective_at is not null
   or pending_plan_requested_by_member_id is not null;

create or replace function public.tenh_block_legacy_scheduled_downgrade()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.pending_plan_code is not null
     or new.pending_billing_cycle is not null
     or new.pending_plan_change_type is not null
     or new.pending_plan_requested_at is not null
     or new.pending_plan_effective_at is not null
     or new.pending_plan_requested_by_member_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'TENH no longer schedules subscription downgrades. Buy a smaller package as a new subscription.',
      detail = 'TENH_SCHEDULED_DOWNGRADE_RETIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists tenh_block_legacy_scheduled_downgrade
  on public.business_subscriptions;

create trigger tenh_block_legacy_scheduled_downgrade
before insert or update of
  pending_plan_code,
  pending_billing_cycle,
  pending_plan_change_type,
  pending_plan_requested_at,
  pending_plan_effective_at,
  pending_plan_requested_by_member_id
on public.business_subscriptions
for each row
execute function public.tenh_block_legacy_scheduled_downgrade();

commit;
