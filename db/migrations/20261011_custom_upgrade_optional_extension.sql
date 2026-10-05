-- REVIEW DRAFT ONLY. Do not apply without explicit production SQL approval.
-- Makes Custom Upgrade duration independent from the remaining paid term while
-- preserving the existing validator for every other purchase type.
-- INSTALL PREREQUISITE: ALL billing writes and in-flight activation/approval/
-- lifecycle/recovery transactions must be quiesced. See the rollout procedure
-- in docs/sql/payway-billing-preflight.sql. These table locks are NOT sufficient
-- to avoid deadlocks against in-flight RPC transactions during ALTER TABLE.

begin;
set local timezone = 'UTC';

-- Apply only during the coordinated billing maintenance window. Legacy
-- pending payments must be resolved through existing verification/review;
-- never synthesize a historical baseline or rewrite a payment to pass.
lock table public.billing_transactions, public.manual_payment_requests,
  public.business_subscriptions in share row exclusive mode;
do $preflight$
begin
  if current_user <> 'postgres' then
    raise exception 'Reviewed migration must run as postgres.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('tenh_validate_plan_purchase',
      'tenh_activate_verified_payway_payment','tenh_approve_manual_payment','tenh_issue_billing_invoice')
      and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')) <> 4 then
    raise exception 'Billing function ownership or privileges differ from the reviewed production snapshot.';
  end if;
  if exists (select 1 from public.billing_transactions where status='pending'
      and pricing_snapshot->>'purchase_type'='custom-upgrade'
      and (coalesce(pricing_snapshot->>'custom_upgrade_version','') <> '2'
        or coalesce(pricing_snapshot->>'paid_term_basis_version','') <> '1'))
     or exists (select 1 from public.manual_payment_requests where status in ('submitted','pending','draft')
      and pricing_snapshot->>'purchase_type'='custom-upgrade'
      and (coalesce(pricing_snapshot->>'custom_upgrade_version','') <> '2'
        or coalesce(pricing_snapshot->>'paid_term_basis_version','') <> '1')) then
    raise exception 'Drain unresolved legacy Custom Upgrade payments before migration.';
  end if;
  if exists (select 1 from public.business_subscriptions where plan_code='custom'
    and (channel_limit is null or member_limit is null or channel_limit not between 3 and 30 or member_limit not between 1 and 100)) then
    raise exception 'Existing Custom capacities require review before constraint alignment.';
  end if;
end;
$preflight$;

create or replace function public.tenh_validate_custom_upgrade_purchase()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subscription public.business_subscriptions%rowtype;
  v_target_members integer;
  v_target_channels integer;
  v_current_months integer;
  v_current_discount_bps integer;
  v_extension_cycle text;
  v_extension_months integer;
  v_extension_discount_bps integer;
  v_current_monthly integer;
  v_target_monthly integer;
  v_added_monthly integer;
  v_current_cycle_capacity_cents integer;
  v_period_seconds numeric;
  v_remaining_seconds numeric;
  v_period_fraction numeric;
  v_proration integer;
  v_extension integer;
  v_renewal_months integer;
  v_renewal_discount_bps integer;
  v_renewal_cents integer;
  v_expected_cents integer;
  v_received_cents integer;
  v_new_period_end timestamptz;
  v_quoted_at timestamptz;
  v_segments jsonb;
  v_original_segments jsonb;
  v_segment jsonb;
  v_segment_start timestamptz;
  v_segment_end timestamptz;
  v_previous_end timestamptz;
  v_segment_months integer;
  v_segment_discount integer;
begin
  if new.currency is distinct from 'USD' then
    raise exception using errcode='P0001', message='Custom Upgrade billing currency must be USD.', detail='TENH_CUSTOM_UPGRADE_CURRENCY_INVALID';
  end if;
  if new.amount is null or new.amount <= 0 or new.amount <> round(new.amount::numeric,2) then
    raise exception using errcode='P0001', message='Custom Upgrade amount must be positive with at most two decimals.', detail='TENH_CUSTOM_UPGRADE_AMOUNT_INVALID';
  end if;
  if coalesce(new.pricing_snapshot->>'custom_upgrade_version','') <> '2' then
    raise exception using errcode='P0001', message='Refresh checkout to use the current Custom Upgrade rules.', detail='TENH_CUSTOM_UPGRADE_VERSION_REQUIRED';
  end if;
  v_quoted_at := (new.pricing_snapshot->>'quoted_at')::timestamptz;
  if v_quoted_at is null or v_quoted_at < clock_timestamp()-interval '60 seconds'
     or v_quoted_at > clock_timestamp()+interval '5 seconds' then
    raise exception using errcode='P0001', message='Custom Upgrade quote has expired. Retry checkout.', detail='TENH_CUSTOM_UPGRADE_QUOTE_EXPIRED';
  end if;
  select bs.* into v_subscription
  from public.business_subscriptions bs
  where bs.business_id = new.business_id
  for share;

  if not found then
    raise exception using errcode='P0001', message='This workspace does not have a managed TENH subscription.', detail='TENH_MANAGED_SUBSCRIPTION_REQUIRED';
  end if;
  if coalesce(v_subscription.cancel_at_period_end,false)
     or v_subscription.pending_plan_change_type is not null then
    raise exception 'Resolve the scheduled subscription change before Custom Upgrade.';
  end if;
  if coalesce(v_subscription.pricing_snapshot->>'paid_term_basis_version','') <> '1'
     and v_subscription.pricing_snapshot->>'purchase_type'='custom-upgrade' then
    raise exception 'Mixed paid terms require authoritative segment pricing before another upgrade.';
  end if;

  if v_subscription.status <> 'active'
     or v_subscription.current_period_end is null
     or v_subscription.current_period_end <= now()
     or lower(coalesce(new.plan_code, '')) <> 'custom' then
    raise exception using errcode='P0001', message='Custom Upgrade requires an active subscription.', detail='TENH_CUSTOM_UPGRADE_REQUIRES_ACTIVE';
  end if;

  v_target_members := new.target_member_limit;
  v_target_channels := new.target_channel_limit;
  if v_target_members is null or v_target_channels is null
     or v_target_members < v_subscription.member_limit or v_target_members > 100
     or v_target_channels < v_subscription.channel_limit or v_target_channels > 30 then
    raise exception using errcode='P0001', message='Custom Upgrade capacity is invalid.', detail='TENH_INVALID_CUSTOM_CAPACITY';
  end if;

  v_current_months := case v_subscription.billing_cycle
    when 'monthly' then 1 when '3-months' then 3 when '6-months' then 6 when '12-months' then 12 else null end;
  v_current_discount_bps := case v_subscription.billing_cycle
    when 'monthly' then 0 when '3-months' then 500 when '6-months' then 1000 when '12-months' then 2000 else null end;

  v_extension_cycle := lower(coalesce(nullif(new.pricing_snapshot->>'extension_billing_cycle',''), 'none'));
  v_extension_months := case v_extension_cycle
    when '' then 0 when 'none' then 0 when 'monthly' then 1 when '3-months' then 3 when '6-months' then 6 when '12-months' then 12 else null end;
  v_extension_discount_bps := case v_extension_cycle
    when '' then 0 when 'none' then 0 when 'monthly' then 0 when '3-months' then 500 when '6-months' then 1000 when '12-months' then 2000 else null end;

  if v_current_months is null or v_extension_months is null then
    raise exception using errcode='P0001', message='Custom Upgrade duration is invalid.', detail='TENH_CUSTOM_UPGRADE_DURATION_INVALID';
  end if;

  if lower(coalesce(new.billing_cycle, '')) <> (case
      when v_extension_months = 0 then lower(v_subscription.billing_cycle)
      else v_extension_cycle
    end) then
    raise exception using errcode='P0001', message='Custom Upgrade renewal duration does not match the selected extension.', detail='TENH_CUSTOM_UPGRADE_CYCLE_MISMATCH';
  end if;

  v_renewal_months := case new.billing_cycle
    when 'monthly' then 1 when '3-months' then 3 when '6-months' then 6 when '12-months' then 12 else null end;
  v_renewal_discount_bps := case new.billing_cycle
    when 'monthly' then 0 when '3-months' then 500 when '6-months' then 1000 when '12-months' then 2000 else null end;

  if lower(v_subscription.plan_code) = 'custom' then
    v_current_monthly := public.tenh_custom_monthly_cents(v_subscription.channel_limit, v_subscription.member_limit);
  else
    v_current_monthly := public.tenh_plan_monthly_cents(v_subscription.plan_code);
  end if;
  v_target_monthly := public.tenh_custom_monthly_cents(v_target_channels, v_target_members);

  if v_current_monthly is null or v_current_monthly <= 0
     or v_target_monthly is null or v_target_monthly <= 0 then
    raise exception using errcode='P0001', message='TENH could not determine the Custom Upgrade monthly value.', detail='TENH_CUSTOM_UPGRADE_PRICE_BASE_MISSING';
  end if;

  v_added_monthly := greatest(0, v_target_monthly - v_current_monthly);
  v_remaining_seconds := greatest(0.001, extract(epoch from (v_subscription.current_period_end - v_quoted_at)));
  v_original_segments := v_subscription.pricing_snapshot->'paid_term_segments';
  if v_subscription.current_period_start is null
     or v_subscription.current_period_start >= v_subscription.current_period_end then
    raise exception 'Original paid period requires verified recovery before upgrade.';
  end if;
  if v_subscription.pricing_snapshot->>'paid_term_basis_version'='1' then
    v_segments := v_original_segments;
    if v_segments is null or jsonb_typeof(v_segments) <> 'array' then
      raise exception 'Paid-term pricing basis is invalid.';
    end if;
    if jsonb_array_length(v_segments)=0 then raise exception 'Paid-term pricing basis is empty.'; end if;
  else
    -- Reconstruct only the authoritative single recorded subscription period.
    -- No mixed legacy history, payment ID, or historical price is invented.
    v_segments := jsonb_build_array(jsonb_build_object(
      'start_at',v_subscription.current_period_start,
      'end_at',v_subscription.current_period_end,
      'months',v_current_months,'discount_basis_points',v_current_discount_bps,
      'source_type','subscription-period','source_payment_id',null
    ));
  end if;
  v_previous_end := v_subscription.current_period_start;
  v_proration := 0;
  for v_segment in select value from jsonb_array_elements(v_segments) loop
    v_segment_start := (v_segment->>'start_at')::timestamptz;
    v_segment_end := (v_segment->>'end_at')::timestamptz;
    v_segment_months := (v_segment->>'months')::integer;
    v_segment_discount := (v_segment->>'discount_basis_points')::integer;
    if v_segment_start is null or v_segment_end is null or v_segment_start >= v_segment_end
       or v_segment_start is distinct from v_previous_end
       or v_segment_months is null or v_segment_months not in (1,3,6,12)
       or v_segment_discount is distinct from (case v_segment_months when 1 then 0 when 3 then 500 when 6 then 1000 when 12 then 2000 end)
       or nullif(v_segment->>'source_type','') is null then
      raise exception 'Paid-term pricing basis is invalid.';
    end if;
    v_period_seconds := extract(epoch from (v_segment_end-v_segment_start));
    v_remaining_seconds := greatest(0,extract(epoch from (v_segment_end-greatest(v_quoted_at,v_segment_start))));
    v_period_fraction := v_remaining_seconds/v_period_seconds;
    v_current_cycle_capacity_cents := round(v_added_monthly::numeric*v_segment_months*(10000-v_segment_discount)/10000.0)::integer;
    v_proration := v_proration + round(v_current_cycle_capacity_cents::numeric*v_period_fraction)::integer;
    v_previous_end := v_segment_end;
  end loop;
  if v_previous_end is distinct from v_subscription.current_period_end then
    raise exception 'Paid-term pricing basis does not cover the authoritative subscription period.';
  end if;
  v_extension := round(v_target_monthly::numeric * v_extension_months * (10000-v_extension_discount_bps) / 10000.0)::integer;
  v_expected_cents := v_proration + v_extension;
  v_renewal_cents := round(v_target_monthly::numeric * v_renewal_months * (10000-v_renewal_discount_bps) / 10000.0)::integer;
  v_received_cents := round(new.amount::numeric * 100)::integer;

  if v_expected_cents <= 0 then
    raise exception using errcode='P0001', message='Increase capacity or duration to create an upgrade.', detail='TENH_CUSTOM_UPGRADE_NO_CHANGE';
  end if;
  if v_received_cents <> v_expected_cents then
    raise exception using errcode='P0001', message=format('TENH Custom Upgrade amount mismatch. Expected $%s, received $%s.',v_expected_cents/100.0,new.amount), detail='TENH_TRUSTED_PRICE_MISMATCH';
  end if;

  v_new_period_end := ((v_subscription.current_period_end at time zone 'UTC') + make_interval(months => v_extension_months)) at time zone 'UTC';
  if v_extension_months > 0 then
    v_segments := v_segments || jsonb_build_array(jsonb_build_object(
      'start_at',v_subscription.current_period_end,'end_at',v_new_period_end,
      'months',v_extension_months,'discount_basis_points',v_extension_discount_bps,
      'source_type',tg_table_name,'source_payment_id',new.id
    ));
  end if;
  new.target_member_limit := v_target_members;
  new.target_channel_limit := v_target_channels;
  new.renew_same := false;
  new.pricing_snapshot := coalesce(new.pricing_snapshot, '{}'::jsonb) || jsonb_build_object(
    'purchase_type', 'custom-upgrade',
    'custom_upgrade_version', 2,
    'quoted_at', v_quoted_at,
    'paid_term_basis_version',1,
    'paid_term_segments',v_segments,
    'current_paid_term_segments',v_original_segments,
    'current_plan_code', v_subscription.plan_code,
    'current_billing_cycle', v_subscription.billing_cycle,
    'current_member_limit', v_subscription.member_limit,
    'current_channel_limit', v_subscription.channel_limit,
    'current_period_start', v_subscription.current_period_start,
    'current_period_end', v_subscription.current_period_end,
    'target_billing_cycle', new.billing_cycle,
    'extension_billing_cycle', nullif(v_extension_cycle, ''),
    'extension_months', v_extension_months,
    'capacity_proration_cents', v_proration,
    'duration_extension_cents', v_extension,
    'total_cents', v_expected_cents,
    'renewal_total_cents', v_renewal_cents,
    'new_period_end', v_new_period_end
  );
  return new;
end;
$function$;

-- Route Custom Upgrade inserts through the dedicated validator and preserve
-- the current production validator byte-for-byte for every other purchase.
drop trigger if exists tenh_validate_payway_plan_purchase on public.billing_transactions;
drop trigger if exists tenh_validate_manual_plan_purchase on public.manual_payment_requests;
drop trigger if exists tenh_validate_payway_custom_upgrade on public.billing_transactions;
drop trigger if exists tenh_validate_manual_custom_upgrade on public.manual_payment_requests;

create trigger tenh_validate_payway_custom_upgrade
before insert on public.billing_transactions
for each row when (lower(coalesce(new.pricing_snapshot->>'purchase_type','')) = 'custom-upgrade')
execute function public.tenh_validate_custom_upgrade_purchase();

create trigger tenh_validate_payway_plan_purchase
before insert on public.billing_transactions
for each row when (lower(coalesce(new.pricing_snapshot->>'purchase_type','')) <> 'custom-upgrade')
execute function public.tenh_validate_plan_purchase();

create trigger tenh_validate_manual_custom_upgrade
before insert on public.manual_payment_requests
for each row when (lower(coalesce(new.pricing_snapshot->>'purchase_type','')) = 'custom-upgrade')
execute function public.tenh_validate_custom_upgrade_purchase();

create trigger tenh_validate_manual_plan_purchase
before insert on public.manual_payment_requests
for each row when (lower(coalesce(new.pricing_snapshot->>'purchase_type','')) <> 'custom-upgrade')
execute function public.tenh_validate_plan_purchase();

create or replace function public.tenh_guard_custom_upgrade_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subscription public.business_subscriptions%rowtype;
  v_snapshot jsonb := coalesce(new.pricing_snapshot, '{}'::jsonb);
  v_extension_months integer;
begin
  if new.status <> 'approved'
     or old.status = 'approved'
     or lower(coalesce(v_snapshot->>'purchase_type','')) <> 'custom-upgrade' then
    return new;
  end if;

  if coalesce(v_snapshot->>'custom_upgrade_version','') <> '2' then
    raise exception using errcode='P0001', message='Legacy Custom Upgrade requires payment recovery review.', detail='TENH_CUSTOM_UPGRADE_LEGACY_RECOVERY_REQUIRED';
  end if;
  if coalesce(v_snapshot->>'paid_term_basis_version','') <> '1'
     or jsonb_typeof(v_snapshot->'paid_term_segments') is distinct from 'array' then
    raise exception 'Custom Upgrade paid-term basis requires recovery review.';
  end if;

  select bs.* into v_subscription
  from public.business_subscriptions bs
  where bs.business_id = new.business_id
  for share;

  if not found or v_subscription.status <> 'active'
     or coalesce(v_subscription.cancel_at_period_end,false)
     or v_subscription.pending_plan_change_type is not null
     or coalesce(v_subscription.pricing_snapshot->'paid_term_segments','null'::jsonb) is distinct from coalesce(v_snapshot->'current_paid_term_segments','null'::jsonb)
     or v_subscription.current_period_end is null
     or v_subscription.current_period_end <= now()
     or v_subscription.plan_code is distinct from v_snapshot->>'current_plan_code'
     or v_subscription.billing_cycle is distinct from v_snapshot->>'current_billing_cycle'
     or v_subscription.member_limit is distinct from (v_snapshot->>'current_member_limit')::integer
     or v_subscription.channel_limit is distinct from (v_snapshot->>'current_channel_limit')::integer
     or v_subscription.current_period_start is distinct from (v_snapshot->>'current_period_start')::timestamptz
     or v_subscription.current_period_end is distinct from (v_snapshot->>'current_period_end')::timestamptz then
    raise exception using errcode='P0001', message='The subscription changed after this Custom Upgrade was quoted. Review or refund the payment instead of applying a stale entitlement.', detail='TENH_CUSTOM_UPGRADE_BASELINE_CHANGED';
  end if;

  if coalesce(v_snapshot->>'extension_months','') !~ '^(0|1|3|6|12)$' then
    raise exception using errcode='P0001', message='Custom Upgrade extension metadata is invalid.', detail='TENH_CUSTOM_UPGRADE_EXTENSION_INVALID';
  end if;
  v_extension_months := (v_snapshot->>'extension_months')::integer;
  if (v_snapshot->>'new_period_end')::timestamptz is distinct from
     ((v_subscription.current_period_end at time zone 'UTC') + make_interval(months => v_extension_months)) at time zone 'UTC' then
    raise exception using errcode='P0001', message='Custom Upgrade entitlement end does not match the trusted baseline.', detail='TENH_CUSTOM_UPGRADE_PERIOD_MISMATCH';
  end if;
  return new;
end;
$function$;

-- Preserve each reviewed activation body, changing only its Custom extension
-- expression. Runtime session timezone must not change UTC calendar arithmetic.
do $utc_activation$
declare
  v_signature text;
  v_definition text;
  v_original text;
  v_utc text := '((v_subscription.current_period_end at time zone ''UTC'') + make_interval(months=>v_extension_months)) at time zone ''UTC''';
begin
  foreach v_signature in array array[
    'public.tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean)',
    'public.tenh_approve_manual_payment(uuid,uuid,text,text)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    v_original := case when v_signature like '%tenh_activate_verified_payway_payment%'
      then 'v_subscription.current_period_end + make_interval(months=>v_extension_months)'
      else 'v_subscription.current_period_end+make_interval(months=>v_extension_months)' end;
    if strpos(v_definition,v_original)>0 then
      execute replace(v_definition,v_original,v_utc);
    elsif strpos(v_definition,v_utc)=0 then
      raise exception 'Custom Upgrade activation body differs from the reviewed UTC patch: %',v_signature;
    end if;
  end loop;
end;
$utc_activation$;

drop trigger if exists tenh_guard_payway_custom_upgrade_approval on public.billing_transactions;
create trigger tenh_guard_payway_custom_upgrade_approval
before update of status on public.billing_transactions
for each row execute function public.tenh_guard_custom_upgrade_approval();

drop trigger if exists tenh_guard_manual_custom_upgrade_approval on public.manual_payment_requests;
create trigger tenh_guard_manual_custom_upgrade_approval
before update of status on public.manual_payment_requests
for each row execute function public.tenh_guard_custom_upgrade_approval();

create or replace function public.tenh_set_custom_upgrade_invoice_period()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pricing jsonb;
begin
  if new.source_type = 'payway' then
    select bt.pricing_snapshot into v_pricing from public.billing_transactions bt where bt.id = new.source_payment_id;
  elsif new.source_type = 'manual' then
    select mpr.pricing_snapshot into v_pricing from public.manual_payment_requests mpr where mpr.id = new.source_payment_id;
  end if;

  if lower(coalesce(v_pricing->>'purchase_type','')) = 'custom-upgrade'
     and v_pricing->>'custom_upgrade_version' = '2' then
    new.period_start := new.paid_at;
    new.period_end := (v_pricing->>'new_period_end')::timestamptz;
    new.snapshot := coalesce(new.snapshot, '{}'::jsonb) || jsonb_build_object('custom_upgrade_pricing', v_pricing);
  end if;
  return new;
end;
$function$;

drop trigger if exists tenh_set_custom_upgrade_invoice_period on public.tenh_billing_invoices;
create trigger tenh_set_custom_upgrade_invoice_period
before insert on public.tenh_billing_invoices
for each row execute function public.tenh_set_custom_upgrade_invoice_period();

-- Align the database with the already-published Custom limits: 3-30
-- connections and 1-100 users. This does not raise the product minimum.
alter table public.business_subscriptions
  drop constraint if exists business_subscriptions_custom_capacity_check;
alter table public.business_subscriptions
  add constraint business_subscriptions_custom_capacity_check
  check (
    plan_code <> 'custom'
    or (channel_limit between 3 and 30 and member_limit between 1 and 100)
  );

alter function public.tenh_validate_custom_upgrade_purchase() owner to postgres;
alter function public.tenh_guard_custom_upgrade_approval() owner to postgres;
alter function public.tenh_set_custom_upgrade_invoice_period() owner to postgres;
revoke all on function public.tenh_validate_custom_upgrade_purchase() from public, anon, authenticated;
revoke all on function public.tenh_guard_custom_upgrade_approval() from public, anon, authenticated;
revoke all on function public.tenh_set_custom_upgrade_invoice_period() from public, anon, authenticated;
grant execute on function public.tenh_validate_custom_upgrade_purchase() to service_role;
grant execute on function public.tenh_guard_custom_upgrade_approval() to service_role;
grant execute on function public.tenh_set_custom_upgrade_invoice_period() to service_role;

commit;
