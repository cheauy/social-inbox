-- Private read-only production DDL snapshot, captured 2026-10-02. Never execute.
-- tenh_activate_verified_payway_payment; owner=postgres; acl={postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.tenh_activate_verified_payway_payment(p_provider_transaction_id text, p_original_amount numeric, p_payment_amount numeric DEFAULT NULL::numeric, p_payment_currency text DEFAULT NULL::text, p_payment_status text DEFAULT NULL::text, p_payment_status_code integer DEFAULT NULL::integer, p_approval_code text DEFAULT NULL::text, p_provider_payload jsonb DEFAULT '{}'::jsonb, p_callback_received boolean DEFAULT false)
 RETURNS TABLE(business_id uuid, plan_code text, subscription_status text, current_period_end timestamp with time zone, member_limit integer, channel_limit integer, already_approved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx public.billing_transactions%rowtype;
  v_subscription public.business_subscriptions%rowtype;
  v_period_start timestamptz; v_period_end timestamptz;
  v_member_limit integer; v_channel_limit integer; v_already_approved boolean:=false;
  v_purchase_type text; v_extension_months integer:=0;
begin
  if nullif(trim(p_provider_transaction_id),'') is null then raise exception 'PayWay transaction ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('tenh-payway-activate:'||p_provider_transaction_id));
  select * into v_tx from public.billing_transactions bt where bt.provider='payway' and bt.provider_transaction_id=p_provider_transaction_id for update;
  if not found then raise exception 'TENH billing transaction was not found.'; end if;
  select * into v_subscription from public.business_subscriptions bs where bs.business_id=v_tx.business_id for update;
  if not found then raise exception 'TENH subscription row was not found for this business.'; end if;
  if coalesce(p_payment_status_code,-1)<>0 or upper(coalesce(p_payment_status,''))<>'APPROVED' then raise exception 'PayWay transaction is not APPROVED.'; end if;
  if p_original_amount is null or round(p_original_amount::numeric,2)<>round(v_tx.amount::numeric,2) then raise exception 'PayWay amount mismatch.'; end if;

  if coalesce(v_tx.renew_same,false) or v_tx.plan_code='custom' then v_member_limit:=v_tx.target_member_limit; v_channel_limit:=v_tx.target_channel_limit;
  else v_member_limit:=public.tenh_plan_member_limit(v_tx.plan_code); v_channel_limit:=public.tenh_plan_channel_limit(v_tx.plan_code); end if;
  if v_member_limit is null or v_channel_limit is null then raise exception 'TENH target capacity is missing.'; end if;

  if v_tx.status='approved' then
    v_already_approved:=true;
    update public.billing_transactions bt set
      callback_received_at=case when p_callback_received then coalesce(bt.callback_received_at,now()) else bt.callback_received_at end,
      provider_status_code=coalesce(p_payment_status_code::text,bt.provider_status_code),provider_status=coalesce(p_payment_status,bt.provider_status),provider_approval_code=coalesce(p_approval_code,bt.provider_approval_code),provider_original_amount=coalesce(p_original_amount,bt.provider_original_amount),provider_payment_amount=coalesce(p_payment_amount,bt.provider_payment_amount),provider_payment_currency=coalesce(p_payment_currency,bt.provider_payment_currency),metadata=coalesce(bt.metadata,'{}'::jsonb)||jsonb_build_object('payway_verified_payload',coalesce(p_provider_payload,'{}'::jsonb)) where bt.id=v_tx.id;
    return query select v_subscription.business_id,v_subscription.plan_code,v_subscription.status,v_subscription.current_period_end,v_subscription.member_limit,v_subscription.channel_limit,true; return;
  end if;
  if v_tx.status<>'pending' then raise exception 'TENH billing transaction cannot be activated from status %.',v_tx.status; end if;

  v_purchase_type:=lower(coalesce(coalesce(v_tx.pricing_snapshot,'{}'::jsonb)->>'purchase_type', ''));
  if v_purchase_type='custom-upgrade' then
    if v_subscription.status<>'active' or v_subscription.current_period_end is null or v_subscription.current_period_end<=now() then raise exception 'The subscription is no longer active for this Custom Upgrade.'; end if;
    if coalesce(v_tx.pricing_snapshot,'{}'::jsonb)->>'extension_months' ~ '^[0-9]+$' then v_extension_months:=(v_tx.pricing_snapshot->>'extension_months')::integer; else raise exception 'Custom Upgrade extension metadata is invalid.'; end if;
    v_period_start:=v_subscription.current_period_start;
    v_period_end:=v_subscription.current_period_end + make_interval(months=>v_extension_months);

    update public.billing_transactions bt set status='approved',provider_status_code=p_payment_status_code::text,provider_status=p_payment_status,provider_approval_code=p_approval_code,provider_original_amount=p_original_amount,provider_payment_amount=p_payment_amount,provider_payment_currency=upper(nullif(trim(p_payment_currency),'')),callback_received_at=case when p_callback_received then coalesce(bt.callback_received_at,now()) else bt.callback_received_at end,verified_at=now(),metadata=coalesce(bt.metadata,'{}'::jsonb)||jsonb_build_object('payway_verified_payload',coalesce(p_provider_payload,'{}'::jsonb),'activated_at',now()) where bt.id=v_tx.id;

    update public.business_subscriptions bs set
      plan_code='custom',status='active',current_period_start=v_period_start,current_period_end=v_period_end,
      member_limit=v_member_limit,channel_limit=v_channel_limit,billing_cycle=v_tx.billing_cycle,
      last_paid_amount=case when coalesce(v_tx.pricing_snapshot,'{}'::jsonb)->>'renewal_total_cents' ~ '^[0-9]+$' then round(((v_tx.pricing_snapshot->>'renewal_total_cents')::numeric / 100),2) else v_tx.amount end,last_paid_currency=v_tx.currency,pricing_version=coalesce(v_tx.pricing_version,'v3.11.31.17'),pricing_snapshot=coalesce(v_tx.pricing_snapshot,'{}'::jsonb),payment_provider='payway',updated_at=now()
    where bs.business_id=v_tx.business_id returning * into v_subscription;
    return query select v_subscription.business_id,v_subscription.plan_code,v_subscription.status,v_subscription.current_period_end,v_subscription.member_limit,v_subscription.channel_limit,false; return;
  end if;

  v_period_start:=now();
  case v_tx.billing_cycle when 'monthly' then v_period_end:=v_period_start+interval '1 month'; when '3-months' then v_period_end:=v_period_start+interval '3 months'; when '6-months' then v_period_end:=v_period_start+interval '6 months'; when '12-months' then v_period_end:=v_period_start+interval '12 months'; else raise exception 'Unsupported TENH billing cycle: %',v_tx.billing_cycle; end case;
  update public.billing_transactions bt set status='approved',provider_status_code=p_payment_status_code::text,provider_status=p_payment_status,provider_approval_code=p_approval_code,provider_original_amount=p_original_amount,provider_payment_amount=p_payment_amount,provider_payment_currency=upper(nullif(trim(p_payment_currency),'')),callback_received_at=case when p_callback_received then coalesce(bt.callback_received_at,now()) else bt.callback_received_at end,verified_at=now(),metadata=coalesce(bt.metadata,'{}'::jsonb)||jsonb_build_object('payway_verified_payload',coalesce(p_provider_payload,'{}'::jsonb),'activated_at',now()) where bt.id=v_tx.id;
  update public.business_subscriptions bs set plan_code=v_tx.plan_code,status='active',current_period_start=v_period_start,current_period_end=v_period_end,member_limit=v_member_limit,channel_limit=v_channel_limit,billing_cycle=v_tx.billing_cycle,last_paid_amount=v_tx.amount,last_paid_currency=v_tx.currency,pricing_version=coalesce(v_tx.pricing_version,'v3.11.31'),pricing_snapshot=coalesce(v_tx.pricing_snapshot,'{}'::jsonb),payment_provider='payway',cancel_at_period_end=false,cancellation_requested_at=null,cancellation_effective_at=null,cancellation_requested_by_member_id=null,cancellation_reason=null,pending_plan_code=null,pending_billing_cycle=null,pending_plan_change_type=null,pending_plan_requested_at=null,pending_plan_effective_at=null,pending_plan_requested_by_member_id=null,suspended_at=null,updated_at=now() where bs.business_id=v_tx.business_id returning * into v_subscription;
  return query select v_subscription.business_id,v_subscription.plan_code,v_subscription.status,v_subscription.current_period_end,v_subscription.member_limit,v_subscription.channel_limit,v_already_approved;
end;
$function$


-- tenh_approve_manual_payment; owner=postgres; acl={postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.tenh_approve_manual_payment(p_request_id uuid, p_reviewed_by_user_id uuid DEFAULT NULL::uuid, p_reviewed_by_email text DEFAULT NULL::text, p_review_note text DEFAULT NULL::text)
 RETURNS TABLE(request_id uuid, business_id uuid, plan_code text, subscription_status text, current_period_end timestamp with time zone, member_limit integer, channel_limit integer, already_approved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.manual_payment_requests%rowtype; v_subscription public.business_subscriptions%rowtype;
  v_period_start timestamptz; v_period_end timestamptz; v_member_limit integer; v_channel_limit integer; v_extension_months integer:=0; v_purchase_type text;
begin
  if p_request_id is null then raise exception 'Manual payment request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('tenh-manual-payment-approve:'||p_request_id::text));
  select * into v_request from public.manual_payment_requests mpr where mpr.id=p_request_id for update; if not found then raise exception 'Manual payment request was not found.'; end if;
  select * into v_subscription from public.business_subscriptions bs where bs.business_id=v_request.business_id for update; if not found then raise exception 'TENH subscription row was not found for this business.'; end if;
  if v_request.status='approved' then return query select v_request.id,v_subscription.business_id,v_subscription.plan_code,v_subscription.status,v_subscription.current_period_end,v_subscription.member_limit,v_subscription.channel_limit,true; return; end if;
  if v_request.status<>'submitted' then raise exception 'Manual payment request cannot be approved from status %.',v_request.status; end if;
  if coalesce(v_request.renew_same,false) or v_request.plan_code='custom' then v_member_limit:=v_request.target_member_limit; v_channel_limit:=v_request.target_channel_limit; else v_member_limit:=public.tenh_plan_member_limit(v_request.plan_code); v_channel_limit:=public.tenh_plan_channel_limit(v_request.plan_code); end if;
  if v_member_limit is null or v_channel_limit is null then raise exception 'TENH target capacity is missing.'; end if;

  v_purchase_type:=lower(coalesce(coalesce(v_request.pricing_snapshot,'{}'::jsonb)->>'purchase_type', ''));
  if v_purchase_type='custom-upgrade' then
    if v_subscription.status<>'active' or v_subscription.current_period_end is null or v_subscription.current_period_end<=now() then raise exception 'The subscription is no longer active for this Custom Upgrade.'; end if;
    if coalesce(v_request.pricing_snapshot,'{}'::jsonb)->>'extension_months' ~ '^[0-9]+$' then v_extension_months:=(v_request.pricing_snapshot->>'extension_months')::integer; else raise exception 'Custom Upgrade extension metadata is invalid.'; end if;
    v_period_start:=v_subscription.current_period_start; v_period_end:=v_subscription.current_period_end+make_interval(months=>v_extension_months);
  else
    v_period_start:=now(); case v_request.billing_cycle when 'monthly' then v_period_end:=v_period_start+interval '1 month'; when '3-months' then v_period_end:=v_period_start+interval '3 months'; when '6-months' then v_period_end:=v_period_start+interval '6 months'; when '12-months' then v_period_end:=v_period_start+interval '12 months'; else raise exception 'Unsupported TENH billing cycle: %',v_request.billing_cycle; end case;
  end if;

  update public.manual_payment_requests mpr set status='approved',reviewed_by_user_id=p_reviewed_by_user_id,reviewed_by_email=nullif(trim(coalesce(p_reviewed_by_email,'')),''),reviewed_at=now(),review_note=nullif(trim(coalesce(p_review_note,'')),''),approved_at=now() where mpr.id=v_request.id;
  update public.business_subscriptions bs set plan_code=v_request.plan_code,status='active',current_period_start=v_period_start,current_period_end=v_period_end,member_limit=v_member_limit,channel_limit=v_channel_limit,billing_cycle=v_request.billing_cycle,last_paid_amount=case when v_purchase_type='custom-upgrade' and coalesce(v_request.pricing_snapshot,'{}'::jsonb)->>'renewal_total_cents' ~ '^[0-9]+$' then round(((v_request.pricing_snapshot->>'renewal_total_cents')::numeric / 100),2) else v_request.amount end,last_paid_currency=v_request.currency,pricing_version=coalesce(v_request.pricing_version,case when v_purchase_type='custom-upgrade' then 'v3.11.31.17' else 'v3.11.31' end),pricing_snapshot=coalesce(v_request.pricing_snapshot,'{}'::jsonb),payment_provider='manual',provider_customer_id=null,provider_subscription_id=null,cancel_at_period_end=false,cancellation_requested_at=null,cancellation_effective_at=null,cancellation_requested_by_member_id=null,cancellation_reason=null,pending_plan_code=null,pending_billing_cycle=null,pending_plan_change_type=null,pending_plan_requested_at=null,pending_plan_effective_at=null,pending_plan_requested_by_member_id=null,suspended_at=null,updated_at=now() where bs.business_id=v_request.business_id returning * into v_subscription;
  return query select v_request.id,v_subscription.business_id,v_subscription.plan_code,v_subscription.status,v_subscription.current_period_end,v_subscription.member_limit,v_subscription.channel_limit,false;
end;
$function$


-- tenh_issue_billing_invoice; owner=postgres; acl={postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.tenh_issue_billing_invoice(p_source_type text, p_source_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing_id uuid;
  v_business_id uuid;
  v_requested_by_member_id uuid;
  v_workspace_name text;
  v_customer_name text;
  v_billing_email text;
  v_plan_code text;
  v_plan_name text;
  v_billing_cycle text;
  v_billing_cycle_label text;
  v_amount numeric(12,2);
  v_currency text;
  v_payment_method text;
  v_provider text;
  v_provider_approval_code text;
  v_source_transaction_id text;
  v_paid_at timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_issued_at timestamptz;
  v_snapshot jsonb := '{}'::jsonb;
  v_invoice_number text;
  v_invoice_id uuid;
begin
  if p_source_payment_id is null then
    raise exception 'TENH invoice source payment ID is required.';
  end if;

  if p_source_type not in ('payway', 'manual') then
    raise exception 'Unsupported TENH invoice source type: %', p_source_type;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tenh-billing-invoice:' || p_source_type || ':' || p_source_payment_id::text,
      31004
    )
  );

  select bi.id
  into v_existing_id
  from public.tenh_billing_invoices bi
  where bi.source_type = p_source_type
    and bi.source_payment_id = p_source_payment_id
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  if p_source_type = 'payway' then
    select
      bt.business_id,
      bt.requested_by_member_id,
      bt.plan_code,
      bt.billing_cycle,
      bt.amount,
      bt.currency,
      'ABA Pay / KHQR',
      'payway',
      bt.provider_approval_code,
      bt.provider_transaction_id,
      coalesce(bt.verified_at, bt.created_at),
      jsonb_build_object(
        'provider_status', bt.provider_status,
        'provider_status_code', bt.provider_status_code,
        'provider_original_amount', bt.provider_original_amount,
        'provider_payment_amount', bt.provider_payment_amount,
        'provider_payment_currency', bt.provider_payment_currency
      )
    into
      v_business_id,
      v_requested_by_member_id,
      v_plan_code,
      v_billing_cycle,
      v_amount,
      v_currency,
      v_payment_method,
      v_provider,
      v_provider_approval_code,
      v_source_transaction_id,
      v_paid_at,
      v_snapshot
    from public.billing_transactions bt
    where bt.id = p_source_payment_id
      and bt.provider = 'payway'
      and bt.status = 'approved'
    limit 1;

  else
    select
      mpr.business_id,
      mpr.requested_by_member_id,
      mpr.plan_code,
      mpr.billing_cycle,
      mpr.amount,
      mpr.currency,
      'Manual bank transfer',
      'manual',
      null::text,
      'MAN-' || upper(left(mpr.id::text, 8)),
      coalesce(mpr.approved_at, mpr.reviewed_at, mpr.created_at),
      jsonb_build_object(
        'review_note', mpr.review_note,
        'reviewed_by_email', mpr.reviewed_by_email,
        'reviewed_at', mpr.reviewed_at
      )
    into
      v_business_id,
      v_requested_by_member_id,
      v_plan_code,
      v_billing_cycle,
      v_amount,
      v_currency,
      v_payment_method,
      v_provider,
      v_provider_approval_code,
      v_source_transaction_id,
      v_paid_at,
      v_snapshot
    from public.manual_payment_requests mpr
    where mpr.id = p_source_payment_id
      and mpr.status = 'approved'
    limit 1;
  end if;

  if v_business_id is null then
    -- The payment is not approved (or no longer exists). Do not issue a paid receipt.
    return null;
  end if;

  select b.name
  into v_workspace_name
  from public.businesses b
  where b.id = v_business_id
  limit 1;

  if v_requested_by_member_id is not null then
    select tm.full_name, tm.email
    into v_customer_name, v_billing_email
    from public.team_members tm
    where tm.id = v_requested_by_member_id
      and tm.business_id = v_business_id
    limit 1;
  end if;

  if nullif(trim(coalesce(v_billing_email, '')), '') is null then
    select tm.full_name, tm.email
    into v_customer_name, v_billing_email
    from public.team_members tm
    where tm.business_id = v_business_id
      and tm.role = 'owner'
      and tm.is_active = true
    limit 1;
  end if;

  v_workspace_name := coalesce(
    nullif(trim(v_workspace_name), ''),
    'TENH Workspace'
  );

  v_customer_name := nullif(trim(coalesce(v_customer_name, '')), '');
  v_billing_email := nullif(trim(coalesce(v_billing_email, '')), '');

  v_plan_name := case v_plan_code
    when 'mini' then 'Mini'
    when 'standard' then 'Standard'
    when 'pro' then 'Pro'
    else initcap(replace(v_plan_code, '-', ' '))
  end;

  v_billing_cycle_label := case v_billing_cycle
    when 'monthly' then 'Monthly'
    when '3-months' then '3 Months'
    when '6-months' then '6 Months'
    when '12-months' then '1 Year'
    else initcap(replace(v_billing_cycle, '-', ' '))
  end;

  v_paid_at := coalesce(v_paid_at, now());
  v_period_start := v_paid_at;
  v_period_end := public.tenh_invoice_period_end(v_period_start, v_billing_cycle);
  v_issued_at := v_paid_at;
  v_invoice_number := public.tenh_next_billing_invoice_number(v_issued_at);

  insert into public.tenh_billing_invoices (
    invoice_number,
    business_id,
    source_type,
    source_payment_id,
    source_transaction_id,
    workspace_name,
    customer_name,
    billing_email,
    plan_code,
    plan_name,
    billing_cycle,
    billing_cycle_label,
    amount,
    currency,
    payment_method,
    provider,
    provider_approval_code,
    status,
    paid_at,
    period_start,
    period_end,
    issued_at,
    snapshot
  ) values (
    v_invoice_number,
    v_business_id,
    p_source_type,
    p_source_payment_id,
    v_source_transaction_id,
    v_workspace_name,
    v_customer_name,
    v_billing_email,
    v_plan_code,
    v_plan_name,
    v_billing_cycle,
    v_billing_cycle_label,
    v_amount,
    upper(v_currency),
    v_payment_method,
    v_provider,
    v_provider_approval_code,
    'paid',
    v_paid_at,
    v_period_start,
    v_period_end,
    v_issued_at,
    coalesce(v_snapshot, '{}'::jsonb)
  )
  on conflict (source_type, source_payment_id)
  do nothing
  returning id into v_invoice_id;

  if v_invoice_id is null then
    select bi.id
    into v_invoice_id
    from public.tenh_billing_invoices bi
    where bi.source_type = p_source_type
      and bi.source_payment_id = p_source_payment_id
    limit 1;
  end if;

  return v_invoice_id;
end;
$function$


-- tenh_validate_plan_purchase; owner=postgres; acl={postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.tenh_validate_plan_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_subscription public.business_subscriptions%rowtype;
  v_current_rank integer;
  v_target_rank integer;
  v_target_members integer;
  v_target_channels integer;
  v_active_members integer;
  v_active_channels integer;
  v_paid_period_active boolean;
  v_expected_cents integer;
  v_received_cents integer;
  v_current_equivalent_cents integer;
  v_snapshot_renewal_text text;
  v_snapshot_renewal_cents integer;
  v_purchase_type text;
  v_created_unpaid boolean;
  v_placeholder_total_text text;
  v_placeholder_total_cents integer;
  v_current_monthly integer;
  v_target_monthly integer;
  v_added_monthly integer;
  v_remaining_days integer;
  v_current_months integer;
  v_target_months integer;
  v_extension_months integer;
  v_current_discount_bps integer;
  v_target_discount_bps integer;
  v_current_cycle_capacity_cents integer;
  v_period_seconds numeric;
  v_remaining_seconds numeric;
  v_period_fraction numeric;
  v_proration integer;
  v_extension integer;
begin
  select bs.* into v_subscription
  from public.business_subscriptions bs
  where bs.business_id = new.business_id
  for share;

  if not found then
    raise exception using
      errcode='P0001',
      message='This workspace does not have a managed TENH subscription.',
      detail='TENH_MANAGED_SUBSCRIPTION_REQUIRED';
  end if;

  if v_subscription.status = 'suspended' then
    raise exception using
      errcode='P0001',
      message='This workspace is suspended. Contact TENH support before starting a payment.',
      detail='TENH_SUBSCRIPTION_SUSPENDED';
  end if;

  v_current_rank := public.tenh_plan_rank(v_subscription.plan_code);
  v_target_rank := public.tenh_plan_rank(new.plan_code);
  v_received_cents := round(new.amount::numeric * 100)::integer;
  v_purchase_type := lower(
    coalesce(
      coalesce(new.pricing_snapshot, '{}'::jsonb)->>'purchase_type',
      ''
    )
  );
  v_paid_period_active := v_subscription.status='active'
    and v_current_rank>0
    and v_subscription.current_period_end is not null
    and v_subscription.current_period_end > now();

  -- -------------------------------------------------------------------------
  -- V3.11.31.23: FIRST PAYMENT FOR A BUY-NEW PLACEHOLDER
  -- -------------------------------------------------------------------------
  v_created_unpaid := lower(coalesce(
    coalesce(v_subscription.pricing_snapshot,'{}'::jsonb)->>'created_unpaid',
    'false'
  )) = 'true';

  if v_created_unpaid and v_subscription.status in ('expired','past_due') then
    if lower(trim(coalesce(new.plan_code,''))) <> lower(trim(coalesce(v_subscription.plan_code,''))) then
      raise exception using
        errcode='P0001',
        message='The payment plan does not match the new subscription that TENH created.',
        detail='TENH_NEW_SUBSCRIPTION_PLAN_MISMATCH';
    end if;

    if lower(trim(coalesce(new.billing_cycle,''))) <> lower(trim(coalesce(v_subscription.billing_cycle,''))) then
      raise exception using
        errcode='P0001',
        message='The payment duration does not match the new subscription that TENH created.',
        detail='TENH_NEW_SUBSCRIPTION_CYCLE_MISMATCH';
    end if;

    v_target_members := v_subscription.member_limit;
    v_target_channels := v_subscription.channel_limit;

    if new.target_member_limit is not null
       and new.target_member_limit <> v_target_members then
      raise exception using
        errcode='P0001',
        message='The payment user limit does not match the new subscription.',
        detail='TENH_NEW_SUBSCRIPTION_MEMBER_LIMIT_MISMATCH';
    end if;

    if new.target_channel_limit is not null
       and new.target_channel_limit <> v_target_channels then
      raise exception using
        errcode='P0001',
        message='The payment connection limit does not match the new subscription.',
        detail='TENH_NEW_SUBSCRIPTION_CHANNEL_LIMIT_MISMATCH';
    end if;

    v_placeholder_total_text := coalesce(
      v_subscription.pricing_snapshot,
      '{}'::jsonb
    )->>'total_cents';

    if coalesce(v_placeholder_total_text,'') ~ '^[0-9]+$' then
      v_placeholder_total_cents := v_placeholder_total_text::integer;
    else
      v_placeholder_total_cents := public.tenh_expected_subscription_cents(
        v_subscription.plan_code,
        v_subscription.billing_cycle,
        v_subscription.channel_limit,
        v_subscription.member_limit
      );
    end if;

    if v_placeholder_total_cents is null or v_placeholder_total_cents <= 0 then
      raise exception using
        errcode='P0001',
        message='TENH could not determine the trusted new-subscription price.',
        detail='TENH_NEW_SUBSCRIPTION_PRICE_MISSING';
    end if;

    if v_received_cents <> v_placeholder_total_cents then
      raise exception using
        errcode='P0001',
        message=format(
          'TENH new-subscription amount mismatch. Expected $%s, received $%s.',
          v_placeholder_total_cents/100.0,
          new.amount
        ),
        detail='TENH_TRUSTED_PRICE_MISMATCH';
    end if;

    -- The trigger fills trusted fields for older PayWay routes that only wrote
    -- the core transaction columns. Manual-payment routes may already provide
    -- these fields; exact-match checks above keep both paths safe.
    new.target_member_limit := v_target_members;
    new.target_channel_limit := v_target_channels;
    new.pricing_version := coalesce(
      nullif(trim(coalesce(new.pricing_version,'')),''),
      v_subscription.pricing_version,
      'v3.11.31.23'
    );
    new.renew_same := false;
    new.pricing_snapshot := coalesce(new.pricing_snapshot,'{}'::jsonb)
      || jsonb_build_object(
        'purchase_type','new-subscription',
        'created_unpaid',true,
        'monthly_cents',coalesce(
          v_subscription.pricing_snapshot->'monthly_cents',
          'null'::jsonb
        ),
        'total_cents',v_placeholder_total_cents,
        'renewal_total_cents',v_placeholder_total_cents,
        'member_limit',v_target_members,
        'channel_limit',v_target_channels,
        'cycle',v_subscription.billing_cycle
      );

    return new;
  end if;

  -- -------------------------------------------------------------------------
  -- Existing Custom Upgrade behavior from V3.11.31.21 / migration 22.
  -- -------------------------------------------------------------------------
  if v_purchase_type = 'custom-upgrade' then
    if not v_paid_period_active or lower(new.plan_code) <> 'custom' then
      raise exception using errcode='P0001', message='Custom Upgrade requires an active subscription.', detail='TENH_CUSTOM_UPGRADE_REQUIRES_ACTIVE';
    end if;

    v_target_members := new.target_member_limit;
    v_target_channels := new.target_channel_limit;
    if v_target_members < v_subscription.member_limit or v_target_members > 100
       or v_target_channels < v_subscription.channel_limit or v_target_channels > 30 then
      raise exception using errcode='P0001', message='Custom Upgrade capacity is invalid.', detail='TENH_INVALID_CUSTOM_CAPACITY';
    end if;

    v_current_months := case v_subscription.billing_cycle
      when 'monthly' then 1 when '3-months' then 3 when '6-months' then 6 when '12-months' then 12 else null end;
    v_target_months := case new.billing_cycle
      when 'monthly' then 1 when '3-months' then 3 when '6-months' then 6 when '12-months' then 12 else null end;
    v_current_discount_bps := case v_subscription.billing_cycle
      when 'monthly' then 0 when '3-months' then 500 when '6-months' then 1000 when '12-months' then 2000 else null end;
    v_target_discount_bps := case new.billing_cycle
      when 'monthly' then 0 when '3-months' then 500 when '6-months' then 1000 when '12-months' then 2000 else null end;

    if v_current_months is null or v_target_months is null or v_target_months < v_current_months then
      raise exception using errcode='P0001', message='Upgrade duration cannot be shorter than the current duration.', detail='TENH_CUSTOM_UPGRADE_DURATION_DECREASE';
    end if;

    if lower(v_subscription.plan_code)='custom' then
      v_current_monthly := public.tenh_custom_monthly_cents(
        v_subscription.channel_limit,
        v_subscription.member_limit
      );
    else
      v_current_monthly := public.tenh_plan_monthly_cents(v_subscription.plan_code);
    end if;

    v_target_monthly := public.tenh_custom_monthly_cents(
      v_target_channels,
      v_target_members
    );

    if v_current_monthly is null or v_current_monthly <= 0
       or v_target_monthly is null or v_target_monthly <= 0 then
      raise exception using errcode='P0001', message='TENH could not determine the Custom Upgrade monthly value.', detail='TENH_CUSTOM_UPGRADE_PRICE_BASE_MISSING';
    end if;

    v_added_monthly := greatest(0, v_target_monthly - v_current_monthly);
    v_remaining_seconds := greatest(1, extract(epoch from (v_subscription.current_period_end-now())));
    v_remaining_days := greatest(1, ceil(v_remaining_seconds/86400.0)::integer);

    v_current_cycle_capacity_cents := round(
      v_added_monthly::numeric * v_current_months * (10000-v_current_discount_bps) / 10000.0
    )::integer;

    if v_subscription.current_period_start is not null
       and v_subscription.current_period_start < v_subscription.current_period_end then
      v_period_seconds := extract(epoch from (v_subscription.current_period_end-v_subscription.current_period_start));
    else
      v_period_seconds := v_current_months * (365.2425/12.0) * 86400.0;
    end if;

    v_period_fraction := least(1.0, v_remaining_seconds / greatest(1, v_period_seconds));
    v_proration := round(v_current_cycle_capacity_cents::numeric * v_period_fraction)::integer;

    v_extension_months := v_target_months-v_current_months;
    v_extension := round(
      v_target_monthly::numeric * v_extension_months * (10000-v_target_discount_bps) / 10000.0
    )::integer;
    v_expected_cents := v_proration+v_extension;

    if v_expected_cents <= 0 then
      raise exception using errcode='P0001', message='Increase capacity or duration to create an upgrade.', detail='TENH_CUSTOM_UPGRADE_NO_CHANGE';
    end if;
    if v_received_cents <> v_expected_cents then
      raise exception using errcode='P0001', message=format('TENH Custom Upgrade amount mismatch. Expected $%s, received $%s.',v_expected_cents/100.0,new.amount), detail='TENH_TRUSTED_PRICE_MISMATCH';
    end if;

    new.target_member_limit := v_target_members;
    new.target_channel_limit := v_target_channels;
    return new;
  end if;

  -- -------------------------------------------------------------------------
  -- Existing normal/reactivation/fixed-upgrade rules.
  -- -------------------------------------------------------------------------
  if coalesce(new.renew_same,false) then
    if v_subscription.status not in ('expired','past_due','cancelled')
       or lower(trim(new.plan_code))<>lower(trim(v_subscription.plan_code))
       or lower(trim(new.billing_cycle))<>lower(trim(coalesce(v_subscription.billing_cycle,'')))
       or v_subscription.last_paid_amount is null or v_subscription.last_paid_amount<=0 then
      raise exception using errcode='P0001',message='This subscription is not eligible for exact same-subscription reactivation.',detail='TENH_RENEW_SAME_NOT_ELIGIBLE';
    end if;
    v_target_members:=v_subscription.member_limit;
    v_target_channels:=v_subscription.channel_limit;
    v_snapshot_renewal_text:=coalesce(v_subscription.pricing_snapshot,'{}'::jsonb)->>'renewal_total_cents';
    if coalesce(v_snapshot_renewal_text,'') ~ '^[0-9]+$' then
      v_snapshot_renewal_cents:=v_snapshot_renewal_text::integer;
    else
      v_snapshot_renewal_cents:=null;
    end if;
    v_expected_cents:=coalesce(nullif(v_snapshot_renewal_cents,0),round(v_subscription.last_paid_amount::numeric*100)::integer);
    if new.target_member_limit is distinct from v_target_members or new.target_channel_limit is distinct from v_target_channels then
      raise exception using errcode='P0001',message='Same-subscription reactivation must keep the previous user and connection limits.',detail='TENH_RENEW_SAME_CAPACITY_MISMATCH';
    end if;
  else
    if lower(new.plan_code)='custom' then
      v_target_members:=new.target_member_limit;
      v_target_channels:=new.target_channel_limit;
      if v_target_members not between 1 and 100 or v_target_channels not between 3 and 30 then
        raise exception using errcode='P0001',message='Custom TENH plan capacity is invalid.',detail='TENH_INVALID_CUSTOM_CAPACITY';
      end if;
    else
      v_target_members:=public.tenh_plan_member_limit(new.plan_code);
      v_target_channels:=public.tenh_plan_channel_limit(new.plan_code);
    end if;

    if v_target_rank<1 or v_target_members is null or v_target_channels is null then
      raise exception using errcode='P0001',message='Invalid TENH paid plan.',detail='TENH_INVALID_TARGET_PLAN';
    end if;

    v_expected_cents:=public.tenh_expected_subscription_cents(
      new.plan_code,
      new.billing_cycle,
      v_target_channels,
      v_target_members
    );

    if v_paid_period_active and v_target_rank>v_current_rank
       and lower(trim(v_subscription.plan_code))<>'custom'
       and lower(trim(new.plan_code))<>'custom' then
      v_current_equivalent_cents:=public.tenh_expected_subscription_cents(
        v_subscription.plan_code,
        new.billing_cycle,
        v_subscription.channel_limit,
        v_subscription.member_limit
      );
      if v_current_equivalent_cents is null or v_expected_cents is null or v_expected_cents<=v_current_equivalent_cents then
        raise exception using errcode='P0001',message='TENH could not calculate the upgrade price difference.',detail='TENH_INVALID_UPGRADE_DIFFERENCE';
      end if;
      v_expected_cents:=v_expected_cents-v_current_equivalent_cents;
    end if;
  end if;

  if v_expected_cents is null or v_received_cents<>v_expected_cents then
    raise exception using errcode='P0001',message=format('TENH subscription amount mismatch. Expected $%s, received $%s.',v_expected_cents/100.0,new.amount),detail='TENH_TRUSTED_PRICE_MISMATCH';
  end if;

  if v_paid_period_active and coalesce(v_subscription.cancel_at_period_end,false)=true then
    raise exception using errcode='P0001',message='Subscription cancellation is scheduled. Undo the cancellation before starting another plan payment.',detail='TENH_CANCELLATION_UNDO_REQUIRED';
  end if;
  if v_paid_period_active and (new.plan_code='custom' or v_subscription.plan_code='custom') then
    raise exception using errcode='P0001',message='Custom subscription capacity cannot replace an active paid period. Use Custom Upgrade.',detail='TENH_CUSTOM_ACTIVE_PERIOD_BLOCKED';
  end if;
  if v_paid_period_active and v_target_rank=v_current_rank then
    raise exception using errcode='P0001',message='This TENH plan is already active for the current paid period.',detail='TENH_CURRENT_PLAN_PAYMENT_BLOCKED';
  end if;
  if v_paid_period_active and v_target_rank<v_current_rank then
    raise exception using errcode='P0001',message='A lower paid plan cannot replace the current active paid period.',detail='TENH_DOWNGRADE_PAYMENT_BLOCKED';
  end if;

  select count(*)::integer into v_active_members
  from public.team_members tm
  where tm.business_id=new.business_id and tm.is_active=true;

  select count(*)::integer into v_active_channels
  from public.social_accounts sa
  where sa.business_id=new.business_id and sa.is_active=true;

  if v_active_members>v_target_members then
    raise exception using errcode='P0001',message=format('The selected plan allows %s active users, but this subscription currently has %s.',v_target_members,v_active_members),detail='TENH_TARGET_MEMBER_LIMIT_EXCEEDED';
  end if;
  if v_active_channels>v_target_channels then
    raise exception using errcode='P0001',message=format('The selected plan allows %s active connections, but this subscription currently has %s.',v_target_channels,v_active_channels),detail='TENH_TARGET_CHANNEL_LIMIT_EXCEEDED';
  end if;

  new.target_member_limit:=v_target_members;
  new.target_channel_limit:=v_target_channels;
  return new;
end;
$function$

