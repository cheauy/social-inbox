-- tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean)
CREATE OR REPLACE FUNCTION public.tenh_activate_verified_payway_payment(p_provider_transaction_id text, p_original_amount numeric, p_payment_amount numeric DEFAULT NULL::numeric, p_payment_currency text DEFAULT NULL::text, p_payment_status text DEFAULT NULL::text, p_payment_status_code integer DEFAULT NULL::integer, p_approval_code text DEFAULT NULL::text, p_provider_payload jsonb DEFAULT '{}'::jsonb, p_callback_received boolean DEFAULT false)
 RETURNS TABLE(business_id uuid, plan_code text, subscription_status text, current_period_end timestamp with time zone, member_limit integer, channel_limit integer, already_approved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_tx public.billing_transactions%rowtype;v_sub public.business_subscriptions%rowtype;
 v_enrollment tenh_billing_private.legacy_payway_enrollments%rowtype;
 v_business uuid;v_reason text;v_observation jsonb;v_original_timezone text;
 v_legacy boolean;v_months integer;v_result record;
begin
 select b.business_id into v_business from public.billing_transactions b
 where b.provider='payway' and b.provider_transaction_id=p_provider_transaction_id;
 if not found then raise exception 'TENH billing transaction was not found.'; end if;
 select * into v_sub from public.business_subscriptions s where s.business_id=v_business for update;
 if not found then raise exception 'TENH subscription row was not found.'; end if;
 select * into v_tx from public.billing_transactions b
 where b.provider='payway' and b.provider_transaction_id=p_provider_transaction_id for update;
 if not found or v_tx.business_id is distinct from v_business then
   raise exception 'Payment identity changed while its subscription was locked.';
 end if;
 select * into v_enrollment from tenh_billing_private.legacy_payway_enrollments e
 where e.source_payment_id=v_tx.id;
 v_legacy:=found;
 v_observation:=jsonb_build_object(
 'provider_transaction_id',p_provider_transaction_id,'original_amount',p_original_amount,
 'payment_amount',p_payment_amount,'payment_currency',p_payment_currency,
 'payment_status',p_payment_status,'payment_status_code',p_payment_status_code,
 'approval_code',p_approval_code,'provider',p_provider_payload);
 if v_tx.status='approved' then
   return query select v_sub.business_id,v_sub.plan_code,v_sub.status,v_sub.current_period_end,
     v_sub.member_limit,v_sub.channel_limit,true;return;
 end if;
 if coalesce(p_payment_status_code,-1)<>0 or upper(coalesce(p_payment_status,''))<>'APPROVED'
 or p_provider_payload->'status'->>'code' is distinct from '00'
 or p_provider_payload->'status'->>'tran_id' is distinct from p_provider_transaction_id then
   v_reason:='PROVIDER_APPROVAL_NOT_VERIFIED';
 elsif p_original_amount is null or p_original_amount is distinct from v_tx.amount
 or p_original_amount*100<>trunc(p_original_amount*100)
 or upper(v_tx.currency)<>'USD' then v_reason:='PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH';
 elsif v_tx.status<>'pending' then v_reason:='PAYMENT_STATUS_REQUIRES_RECOVERY';
 elsif tenh_billing_private.has_other_unresolved(v_business,'payway',v_tx.id) then
   v_reason:='CONFLICTING_UNRESOLVED_PAYMENT';
 elsif v_legacy then
   if public.tenh_compat_payment_identity(to_jsonb(v_tx)) is distinct from v_enrollment.payment_identity then
     v_reason:='LEGACY_PAYMENT_IDENTITY_CHANGED';
   elsif not v_enrollment.merchant_binding_verified then v_reason:='LEGACY_MERCHANT_BINDING_UNVERIFIED';
   elsif v_enrollment.activation_policy<>'captured-v1' then v_reason:='LEGACY_RECOVERY_REVIEW_REQUIRED';
   elsif public.tenh_compat_subscription_identity(to_jsonb(v_sub))
     is distinct from v_enrollment.subscription_identity then v_reason:='LEGACY_SUBSCRIPTION_BASELINE_CHANGED';
   elsif coalesce(v_sub.cancel_at_period_end,false) or v_sub.pending_plan_change_type is not null then
     v_reason:='LEGACY_SCHEDULED_CHANGE_REQUIRES_REVIEW';
   elsif v_tx.pricing_snapshot->>'purchase_type'='custom-upgrade' then
     if v_sub.status<>'active' or v_sub.current_period_end is null or v_sub.current_period_end<=now()
       or v_tx.pricing_snapshot->>'current_period_end' is null
       or (v_tx.pricing_snapshot->>'current_period_end')::timestamptz is distinct from v_sub.current_period_end
       or v_tx.pricing_snapshot->>'current_billing_cycle' is distinct from v_sub.billing_cycle
       or coalesce(v_tx.pricing_snapshot->>'extension_months','') !~ '^[0-9]+$'
     then v_reason:='LEGACY_QUOTE_BASELINE_UNPROVEN';
     else
       v_months:=(v_tx.pricing_snapshot->>'extension_months')::integer;
       v_original_timezone:=current_setting('TimeZone');
       perform set_config('TimeZone',v_enrollment.activation_timezone,true);
       if v_tx.pricing_snapshot->>'new_period_end' is null
         or (v_tx.pricing_snapshot->>'new_period_end')::timestamptz
           is distinct from v_sub.current_period_end+make_interval(months=>v_months)
       then v_reason:='LEGACY_EXTENSION_SEMANTICS_UNPROVEN'; end if;
       perform set_config('TimeZone',v_original_timezone,true);
     end if;
   end if;
 end if;
 if v_reason is null then
   begin
     if v_legacy then
       insert into tenh_billing_private.approval_attempts values(
         v_tx.id,txid_current(),v_enrollment.payment_identity,v_enrollment.subscription_identity);
       v_original_timezone:=current_setting('TimeZone');
       perform set_config('TimeZone',v_enrollment.activation_timezone,true);
       select * into v_result from tenh_billing_private.activate_payway_v1(
         p_provider_transaction_id,p_original_amount,p_payment_amount,p_payment_currency,
         p_payment_status,p_payment_status_code,p_approval_code,p_provider_payload,p_callback_received);
       perform set_config('TimeZone',v_original_timezone,true);
       delete from tenh_billing_private.approval_attempts a
         where a.source_payment_id=v_tx.id and a.xact_id=txid_current();
     else
       select * into v_result from tenh_billing_private.activate_payway_v2(
         p_provider_transaction_id,p_original_amount,p_payment_amount,p_payment_currency,
         p_payment_status,p_payment_status_code,p_approval_code,p_provider_payload,p_callback_received);
     end if;
     perform tenh_billing_private.record_event('payway',v_tx.id,v_business,'applied',null,
       jsonb_build_object('contract',case when v_legacy then 'captured-v1' else 'v2' end,
         'payment_identity',public.tenh_compat_payment_identity(to_jsonb(v_tx)),
         'before_subscription',public.tenh_compat_subscription_identity(to_jsonb(v_sub)),
         'result',to_jsonb(v_result)));
     return query select v_result.business_id,v_result.plan_code,v_result.subscription_status,
       v_result.current_period_end,v_result.member_limit,v_result.channel_limit,v_result.already_approved;
     return;
   exception when others then
     -- The subtransaction rolls back activation, invoice, attempt and GUC changes.
     -- Evidence is written outside it, so a rejected late payment remains reviewable.
     v_reason:='ACTIVATION_REJECTED:'||sqlstate||':'||sqlerrm;
   end;
 end if;
 perform tenh_billing_private.record_event('payway',v_tx.id,v_business,'recovery_required',v_reason,v_observation);
 return query select v_tx.business_id,v_tx.plan_code,'recovery_required'::text,
   v_sub.current_period_end,v_sub.member_limit,v_sub.channel_limit,false;
end
$function$
;

-- tenh_apply_bakong_payment(uuid,uuid)
CREATE OR REPLACE FUNCTION public.tenh_apply_bakong_payment(p_attempt uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.bakong_payment_attempts%rowtype; s public.business_subscriptions%rowtype; bid uuid; r record; why text; detail text;
begin
  select business_id into bid from public.bakong_payment_attempts where id=p_attempt;
  select * into s from public.business_subscriptions where business_id=bid for update;
  select * into a from public.bakong_payment_attempts where id=p_attempt for update;
  if not found then raise exception 'Payment missing'; end if;
  if a.state<>'verified' then return to_jsonb(a); end if;
  if a.environment<>'production' or a.evidence is null or a.verified_hash is null then why:='PAYMENT_EVIDENCE_MISSING';
  elsif a.verified_at>a.expires_at then why:='LATE_PAYMENT_REVIEW';
  elsif public.tenh_compat_subscription_identity(to_jsonb(s)) is distinct from a.baseline then why:='SUBSCRIPTION_CHANGED';
  elsif not exists(select 1 from public.team_members where id=a.member_id and user_id=a.user_id and business_id=bid and is_active) then why:='PURCHASER_MEMBERSHIP_REMOVED'; end if;
  if why is not null then
    update public.bakong_payment_attempts set state='review',reason=why,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    update public.billing_transactions set metadata=metadata||jsonb_build_object('bakong_state','review') where id=p_attempt;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'review',why);
    return to_jsonb(a);
  end if;
  begin
    select * into r from tenh_bakong_private.apply_subscription(a.reference,a.amount,a.amount,a.currency,'APPROVED',0,a.verified_hash,a.evidence,false);
    if r.business_id is distinct from a.business_id or r.subscription_status<>'active' then raise exception 'Activation result mismatch'; end if;
    update public.bakong_payment_attempts set state='applied',reason=null,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    update public.billing_transactions set metadata=metadata||jsonb_build_object('bakong_state','applied') where id=p_attempt;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event) values(p_attempt,p_actor,'applied');
  exception when others then
    -- Keep verified evidence committed while rolling back this activation/invoice attempt.
    get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
    update public.bakong_payment_attempts set state=case when detail like 'TENH_%' then 'review' else 'verified' end,
      reason=case when detail like 'TENH_%' then 'APPLICATION_REVIEW_REQUIRED' else 'ACTIVATION_PENDING' end,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    update public.billing_transactions set metadata=metadata||jsonb_build_object('bakong_state',a.state) where id=p_attempt;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'activation_pending',sqlstate);
  end;
  return to_jsonb(a);
end $function$
;

-- tenh_approve_manual_payment(uuid,uuid,text,text)
CREATE OR REPLACE FUNCTION public.tenh_approve_manual_payment(p_request_id uuid, p_reviewed_by_user_id uuid DEFAULT NULL::uuid, p_reviewed_by_email text DEFAULT NULL::text, p_review_note text DEFAULT NULL::text)
 RETURNS TABLE(request_id uuid, business_id uuid, plan_code text, subscription_status text, current_period_end timestamp with time zone, member_limit integer, channel_limit integer, already_approved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_request public.manual_payment_requests%rowtype;v_sub public.business_subscriptions%rowtype;
 v_business uuid;v_reason text;v_result record;
begin
 select m.business_id into v_business from public.manual_payment_requests m where m.id=p_request_id;
 if not found then raise exception 'Manual payment request was not found.'; end if;
 select * into v_sub from public.business_subscriptions s where s.business_id=v_business for update;
 if not found then raise exception 'TENH subscription row was not found.'; end if;
 select * into v_request from public.manual_payment_requests m where m.id=p_request_id for update;
 if not found or v_request.business_id is distinct from v_business then
   raise exception 'Manual payment identity changed while its subscription was locked.';
 end if;
 if v_request.status='approved' then
   return query select v_request.id,v_sub.business_id,v_sub.plan_code,v_sub.status,v_sub.current_period_end,
     v_sub.member_limit,v_sub.channel_limit,true;return;
 end if;
 if tenh_billing_private.has_other_unresolved(v_business,'manual',v_request.id) then
   v_reason:='CONFLICTING_UNRESOLVED_PAYMENT';
 else
   begin
     select * into v_result from tenh_billing_private.approve_manual_v2(
       p_request_id,p_reviewed_by_user_id,p_reviewed_by_email,p_review_note);
     return query select v_result.request_id,v_result.business_id,v_result.plan_code,
       v_result.subscription_status,v_result.current_period_end,v_result.member_limit,
       v_result.channel_limit,v_result.already_approved;return;
   exception when others then v_reason:='MANUAL_APPROVAL_REJECTED:'||sqlstate||':'||sqlerrm; end;
 end if;
 perform tenh_billing_private.record_event('manual',v_request.id,v_business,'recovery_required',v_reason,
   jsonb_build_object('reviewed_by_user_id',p_reviewed_by_user_id));
 return query select v_request.id,v_request.business_id,v_request.plan_code,'recovery_required'::text,
   v_sub.current_period_end,v_sub.member_limit,v_sub.channel_limit,false;
end
$function$
;

-- tenh_bakong_capacity(text,text,text,integer)
CREATE OR REPLACE FUNCTION public.tenh_bakong_capacity(p_fingerprint text, p_environment text, p_recipient text, p_budget integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r tenh_bakong_private.capacity_reviews%rowtype; g tenh_bakong_private.general_authorizations%rowtype;
  n integer; used integer; reserved integer; can_verify boolean; basis text:='sandbox';
begin
  if p_budget is null or p_budget not between 1 and 10000 then return jsonb_build_object('eligible',false,'budget',0); end if;
  if p_environment='sandbox' then n:=least(90,p_budget);
  elsif p_environment='production' then
    select * into r from tenh_bakong_private.capacity_reviews where credential_fingerprint=p_fingerprint and recipient=p_recipient and production_eligible;
    if found then
      n:=least(90,p_budget,r.allocated_daily_limit-10,r.verified_daily_limit-10); basis:='provider-reviewed';
      if n<r.required_daily_requests then return jsonb_build_object('eligible',false,'budget',0); end if;
    else
      select * into g from tenh_bakong_private.general_authorizations where credential_fingerprint=p_fingerprint and recipient=p_recipient
        and environment=p_environment and revoked_at is null and authorized_at<=clock_timestamp();
      if not found then return jsonb_build_object('eligible',false,'budget',0); end if;
      n:=least(90,p_budget,g.allocated_daily_budget,g.reported_daily_limit-10); basis:='operator-attested';
    end if;
  else return jsonb_build_object('eligible',false,'budget',0); end if;
  select count(*) into used from tenh_bakong_private.provider_calls where environment=p_environment and counted_at>clock_timestamp()-interval '24 hours';
  reserved:=tenh_bakong_private.reserved_inquiries(p_environment);
  can_verify:=not exists(select 1 from tenh_bakong_private.request_budgets where budget_key='khqr:'||p_environment
    and (invalid_credentials=p_fingerprint or blocked_until>clock_timestamp()+interval '5 minutes'));
  return jsonb_build_object('eligible',true,'budget',n,'approvalBasis',basis,
    'providerEligibility',case when basis='operator-attested' then 'not-independently-verified' when basis='provider-reviewed' then 'reviewed' else 'sandbox' end,
    'canVerify',can_verify,'canIssue',can_verify and used+reserved+3<=n);
end $function$
;

-- tenh_claim_bakong_check(uuid,text,integer)
CREATE OR REPLACE FUNCTION public.tenh_claim_bakong_check(p_attempt uuid, p_fingerprint text, p_budget integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.bakong_payment_attempts%rowtype; b tenh_bakong_private.request_budgets%rowtype; cap jsonb; n integer; cid uuid; oldest timestamptz; quota_key text; reserved integer;
begin
  select 'khqr:'||environment into quota_key from public.bakong_payment_attempts where id=p_attempt;
  if not found then return jsonb_build_object('claimed',false,'reason','missing'); end if;
  insert into tenh_bakong_private.request_budgets(budget_key) values(quota_key) on conflict do nothing;
  select * into b from tenh_bakong_private.request_budgets where budget_key=quota_key for update;
  select * into a from public.bakong_payment_attempts where id=p_attempt for update;
  if not found then return jsonb_build_object('claimed',false,'reason','missing'); end if;
  if a.state in ('verified','applied','test_paid') or a.verified_hash is not null then return jsonb_build_object('claimed',false,'reason','settled'); end if;
  select count(*) into n from tenh_bakong_private.provider_calls where attempt_id=p_attempt;
  if n>=3 then return jsonb_build_object('claimed',false,'reason','INQUIRY_LIMIT_REVIEW'); end if;
  cap:=tenh_bakong_private.pilot_check_capacity(p_attempt,p_fingerprint,p_budget);
  if cap is null then cap:=public.tenh_bakong_capacity(p_fingerprint,a.environment,a.recipient,p_budget); end if;
  if cap->>'eligible' is distinct from 'true' or b.invalid_credentials=p_fingerprint then return jsonb_build_object('claimed',false,'reason','unavailable'); end if;
  if b.blocked_until>clock_timestamp() or a.next_check_at>clock_timestamp() or a.lease_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','cooldown','nextCheckAt',greatest(b.blocked_until,a.next_check_at,a.lease_until)); end if;
  select count(*),min(counted_at) into n,oldest from tenh_bakong_private.provider_calls where environment=a.environment and counted_at>clock_timestamp()-interval '24 hours';
  reserved:=tenh_bakong_private.reserved_inquiries(a.environment,p_attempt);
  if n+reserved+1>(cap->>'budget')::integer then return jsonb_build_object('claimed',false,'reason','budget','nextCheckAt',coalesce(oldest+interval '24 hours',clock_timestamp()+interval '1 hour')); end if;
  cid:=gen_random_uuid();
  insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) values(cid,p_fingerprint,a.environment,p_attempt);
  update tenh_bakong_private.request_budgets set blocked_until=clock_timestamp()+interval '60 seconds' where budget_key=quota_key;
  update public.bakong_payment_attempts set lease_id=cid,lease_until=clock_timestamp()+interval '90 seconds',
    next_check_at=clock_timestamp()+interval '5 minutes',check_count=check_count+1 where id=p_attempt;
  return jsonb_build_object('claimed',true,'claimId',cid,'nextCheckAt',clock_timestamp()+interval '5 minutes');
end $function$
;

-- tenh_complete_bakong_check(uuid,uuid,jsonb,uuid)
CREATE OR REPLACE FUNCTION public.tenh_complete_bakong_check(p_attempt uuid, p_claim uuid, p_observation jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.bakong_payment_attempts%rowtype; call tenh_bakong_private.provider_calls%rowtype;
  e jsonb:=p_observation->'settlement'; observed_state text:=p_observation->>'state'; bid uuid; delay integer; consumed_by uuid;
begin
  select * into call from tenh_bakong_private.provider_calls where id=p_claim and attempt_id=p_attempt;
  if not found then raise exception 'Verification lease missing'; end if;
  perform 1 from tenh_bakong_private.request_budgets where budget_key='khqr:'||call.environment for update;
  select business_id into bid from public.bakong_payment_attempts where id=p_attempt;
  perform 1 from public.business_subscriptions where business_id=bid for update;
  select * into a from public.bakong_payment_attempts where id=p_attempt for update;
  if call.completed_at is not null then return to_jsonb(a); end if;
  update tenh_bakong_private.provider_calls set completed_at=clock_timestamp(),outcome=observed_state where id=p_claim;
  if observed_state='paid' then
    if e->>'md5' is distinct from a.md5 or e->>'recipient' is distinct from a.recipient
      or e->>'currency' is distinct from a.currency or e->>'environment' is distinct from a.environment
      or coalesce(e->>'hash','') !~ '^[a-f0-9]{64}$' or coalesce(e->>'amount','') !~ '^\d+(\.\d+)?$'
      or (e->>'amount')::numeric is distinct from a.amount then raise exception 'Settlement evidence does not match saved KHQR'; end if;
    insert into tenh_bakong_private.settlements(hash,attempt_id,evidence) values(e->>'hash',p_attempt,e) on conflict do nothing;
    select attempt_id into consumed_by from tenh_bakong_private.settlements where hash=e->>'hash';
    if consumed_by is distinct from p_attempt or (a.verified_hash is not null and a.verified_hash<>e->>'hash') then
      update public.bakong_payment_attempts set state='review',reason=case when consumed_by is distinct from p_attempt then 'TRANSACTION_ALREADY_CONSUMED' else 'DUPLICATE_PAYMENT_REVIEW' end,
        lease_until=null,updated_at=clock_timestamp() where id=p_attempt returning * into a;
      insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'review',a.reason||':'||(e->>'hash'));
      return to_jsonb(a);
    end if;
    if a.verified_hash is not null then return to_jsonb(a); end if;
    begin
      update public.bakong_payment_attempts set verified_hash=e->>'hash',evidence=e,verified_at=clock_timestamp(),
        state=case when environment='sandbox' then 'test_paid' when clock_timestamp()>expires_at then 'review' else 'verified' end,
        reason=case when environment='production' and clock_timestamp()>expires_at then 'LATE_PAYMENT_REVIEW' else null end,
        lease_until=null,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    exception when unique_violation then
      update public.bakong_payment_attempts set state='review',reason='TRANSACTION_ALREADY_CONSUMED',lease_until=null,updated_at=clock_timestamp()
        where id=p_attempt returning * into a;
      insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'review','TRANSACTION_ALREADY_CONSUMED:'||(e->>'hash'));
      return to_jsonb(a);
    end;
    update public.billing_transactions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('bakong_verification',e,'bakong_state',a.state),
      status=case when a.environment='sandbox' then 'cancelled' else status end,
      provider_status=case when a.environment='sandbox' then 'TEST_CONFIRMED' else 'VERIFIED' end,
      provider_approval_code=a.verified_hash,verified_at=a.verified_at where id=p_attempt;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,a.state,a.reason);
  elsif a.lease_id=p_claim and a.verified_hash is null then
    if observed_state='credential_error' then update tenh_bakong_private.request_budgets set invalid_credentials=call.fingerprint where budget_key='khqr:'||call.environment; end if;
    delay:=greatest(300,coalesce((p_observation->>'retryAfterSeconds')::integer,0));
    if p_observation ? 'retryAfterSeconds' then update tenh_bakong_private.request_budgets set blocked_until=greatest(blocked_until,clock_timestamp()+make_interval(secs=>delay)) where budget_key='khqr:'||call.environment; end if;
    update public.bakong_payment_attempts set state=case when observed_state='mismatch' then 'review' else a.state end,
      reason=case when observed_state='mismatch' then 'PAYMENT_DETAILS_MISMATCH' when observed_state='pending' then null else 'CHECK_UNRESOLVED' end,
      failure_count=case when observed_state='pending' then 0 else failure_count+1 end,
      next_check_at=greatest(next_check_at,clock_timestamp()+make_interval(secs=>greatest(delay,least(3600,300*power(2,least(failure_count,4))::integer)))),
      lease_until=null,updated_at=clock_timestamp() where id=p_attempt returning * into a;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event,reason) values(p_attempt,p_actor,'checked',a.reason);
  end if;
  return to_jsonb(a);
end $function$
;

-- tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamp with time zone,integer)
CREATE OR REPLACE FUNCTION public.tenh_prepare_bakong_payment(p_record jsonb, p_actor uuid, p_member uuid, p_intent uuid, p_selection jsonb, p_environment text, p_fingerprint text, p_recipient text, p_qr text, p_md5 text, p_reference text, p_expires_at timestamp with time zone, p_budget integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.bakong_payment_attempts%rowtype; s public.business_subscriptions%rowtype;
  bid uuid:=(p_record->>'business_id')::uuid; pid uuid:=(p_record->>'id')::uuid; cap jsonb; used integer; reserved integer; pilot uuid;
begin
  -- Same global-budget -> subscription -> attempt lock order as verification.
  insert into tenh_bakong_private.request_budgets(budget_key) values('khqr:'||p_environment) on conflict do nothing;
  perform 1 from tenh_bakong_private.request_budgets where budget_key='khqr:'||p_environment for update;
  select * into s from public.business_subscriptions where business_id=bid for update;
  if not found then raise exception 'Subscription missing'; end if;
  if not exists(select 1 from public.team_members where id=p_member and business_id=bid and user_id=p_actor and is_active) then raise exception 'Membership revoked' using errcode='42501'; end if;
  select * into a from public.bakong_payment_attempts where business_id=bid and user_id=p_actor and intent_id=p_intent;
  if found then
    if a.selection is distinct from p_selection then raise exception 'Purchase intent is immutable' using errcode='22023'; end if;
    return to_jsonb(a);
  end if;
  select a0.* into a from public.bakong_payment_attempts a0 join public.billing_transactions b on b.id=a0.id
    where a0.business_id=bid and b.status='pending' order by a0.created_at limit 1;
  if found then return to_jsonb(a); end if;
  cap:=public.tenh_bakong_capacity(p_fingerprint,p_environment,p_recipient,p_budget);
  if cap->>'eligible' is distinct from 'true' then
    pilot:=tenh_bakong_private.authorize_pilot(p_record,p_actor,p_member,p_selection,p_environment,p_fingerprint,p_recipient,p_expires_at);
  end if;
  if pilot is not null then
    if p_budget is null or p_budget not between 1 and 10000 then raise exception 'Invalid pilot request budget'; end if;
    cap:=jsonb_build_object('eligible',true,'budget',least(p_budget,90),'canVerify',not exists(
      select 1 from tenh_bakong_private.request_budgets where budget_key='khqr:production'
      and (invalid_credentials=p_fingerprint or blocked_until>clock_timestamp()+interval '5 minutes')));
  end if;
  if cap->>'eligible' is distinct from 'true' then raise exception 'Bakong capacity is unverified' using errcode='55000'; end if;
  if cap->>'canVerify' is distinct from 'true' then raise exception 'Bakong verification is temporarily unavailable' using errcode='55000'; end if;
  select count(*) into used from tenh_bakong_private.provider_calls where environment=p_environment and counted_at>clock_timestamp()-interval '24 hours';
  reserved:=tenh_bakong_private.reserved_inquiries(p_environment);
  if used+reserved+3>(cap->>'budget')::integer then raise exception 'Bakong request capacity is reserved for existing purchases' using errcode='55000'; end if;
  if public.tenh_compat_subscription_identity(to_jsonb(s)) is distinct from public.tenh_compat_subscription_identity(p_record->'_expected_subscription') then raise exception 'Quote changed' using errcode='40001'; end if;
  if p_environment not in ('sandbox','production') or p_record->>'currency'<>'USD' or (p_record->>'amount')::numeric<=0
    or p_md5 !~ '^[a-f0-9]{32}$' or md5(p_qr)<>p_md5 or length(p_reference)>25 or length(p_reference)=0
    or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '16 minutes' then raise exception 'Invalid KHQR preparation' using errcode='22023'; end if;
  insert into public.billing_transactions(id,business_id,requested_by_member_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,
    target_member_limit,target_channel_limit,pricing_version,renew_same,pricing_snapshot,request_time,metadata)
    values(pid,bid,p_member,'bakong',p_reference,p_record->>'plan_code',p_record->>'billing_cycle',(p_record->>'amount')::numeric,'USD','pending',
    (p_record->>'target_member_limit')::integer,(p_record->>'target_channel_limit')::integer,p_record->>'pricing_version',
    (p_record->>'renew_same')::boolean,p_record->'pricing_snapshot',to_char(clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MISS'),jsonb_build_object('environment',p_environment,'live_enabled',p_environment='production','_expected_subscription',to_jsonb(s)));
  insert into public.bakong_payment_attempts(id,business_id,user_id,member_id,intent_id,selection,environment,credential_fingerprint,
    recipient,amount,currency,reference,qr,md5,expires_at,baseline,pilot_authorization_id)
    values(pid,bid,p_actor,p_member,p_intent,p_selection,p_environment,p_fingerprint,p_recipient,(p_record->>'amount')::numeric,'USD',p_reference,p_qr,p_md5,p_expires_at,public.tenh_compat_subscription_identity(to_jsonb(s)),pilot) returning * into a;
  if pilot is not null then
      update tenh_bakong_private.pilot_authorizations set attempt_id=pid,issued_quote=p_record where id=pilot;
    end if;
    insert into tenh_bakong_private.events(attempt_id,actor_user_id,event) values(pid,p_actor,'prepared');
  return to_jsonb(a);
end $function$
;
