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
  cap:=public.tenh_bakong_capacity(p_fingerprint,a.environment,a.recipient,p_budget);
  if cap->>'eligible' is distinct from 'true' or b.invalid_credentials=p_fingerprint then return jsonb_build_object('claimed',false,'reason','unavailable'); end if;
  if b.blocked_until>clock_timestamp() or a.next_check_at>clock_timestamp() or a.lease_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','cooldown','nextCheckAt',greatest(b.blocked_until,a.next_check_at,a.lease_until)); end if;
  select count(*),min(counted_at) into n,oldest from tenh_bakong_private.provider_calls where environment=a.environment and counted_at>clock_timestamp()-interval '24 hours';
  select coalesce(sum(greatest(0,3-check_count)),0) into reserved from public.bakong_payment_attempts
    where environment=a.environment and state in ('pending','review') and verified_hash is null and id<>p_attempt;
  if n+reserved+1>(cap->>'budget')::integer then return jsonb_build_object('claimed',false,'reason','budget','nextCheckAt',coalesce(oldest+interval '24 hours',clock_timestamp()+interval '1 hour')); end if;
  cid:=gen_random_uuid();
  insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) values(cid,p_fingerprint,a.environment,p_attempt);
  update tenh_bakong_private.request_budgets set blocked_until=clock_timestamp()+interval '60 seconds' where budget_key=quota_key;
  update public.bakong_payment_attempts set lease_id=cid,lease_until=clock_timestamp()+interval '90 seconds',
    next_check_at=clock_timestamp()+interval '5 minutes',check_count=check_count+1 where id=p_attempt;
  return jsonb_build_object('claimed',true,'claimId',cid,'nextCheckAt',clock_timestamp()+interval '5 minutes');
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
  bid uuid:=(p_record->>'business_id')::uuid; pid uuid:=(p_record->>'id')::uuid; cap jsonb; used integer; reserved integer;
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
  if cap->>'eligible' is distinct from 'true' then raise exception 'Bakong capacity is unverified' using errcode='55000'; end if;
  if cap->>'canVerify' is distinct from 'true' then raise exception 'Bakong verification is temporarily unavailable' using errcode='55000'; end if;
  select count(*) into used from tenh_bakong_private.provider_calls where environment=p_environment and counted_at>clock_timestamp()-interval '24 hours';
  select coalesce(sum(greatest(0,3-check_count)),0) into reserved from public.bakong_payment_attempts
    where environment=p_environment and state in ('pending','review') and verified_hash is null;
  if used+reserved+3>(cap->>'budget')::integer then raise exception 'Bakong request capacity is reserved for existing purchases' using errcode='55000'; end if;
  if public.tenh_compat_subscription_identity(to_jsonb(s)) is distinct from public.tenh_compat_subscription_identity(p_record->'_expected_subscription') then raise exception 'Quote changed' using errcode='40001'; end if;
  if p_environment not in ('sandbox','production') or p_record->>'currency'<>'USD' or (p_record->>'amount')::numeric<=0
    or p_md5 !~ '^[a-f0-9]{32}$' or md5(p_qr)<>p_md5 or length(p_reference)>25 or length(p_reference)=0
    or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '16 minutes' then raise exception 'Invalid KHQR preparation' using errcode='22023'; end if;
  insert into public.billing_transactions(id,business_id,requested_by_member_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,
    target_member_limit,target_channel_limit,pricing_version,renew_same,pricing_snapshot,metadata)
    values(pid,bid,p_member,'bakong',p_reference,p_record->>'plan_code',p_record->>'billing_cycle',(p_record->>'amount')::numeric,'USD','pending',
    (p_record->>'target_member_limit')::integer,(p_record->>'target_channel_limit')::integer,p_record->>'pricing_version',
    (p_record->>'renew_same')::boolean,p_record->'pricing_snapshot',jsonb_build_object('environment',p_environment,'live_enabled',p_environment='production','_expected_subscription',to_jsonb(s)));
  insert into public.bakong_payment_attempts(id,business_id,user_id,member_id,intent_id,selection,environment,credential_fingerprint,
    recipient,amount,currency,reference,qr,md5,expires_at,baseline)
    values(pid,bid,p_actor,p_member,p_intent,p_selection,p_environment,p_fingerprint,p_recipient,(p_record->>'amount')::numeric,'USD',p_reference,p_qr,p_md5,p_expires_at,public.tenh_compat_subscription_identity(to_jsonb(s))) returning * into a;
  insert into tenh_bakong_private.events(attempt_id,actor_user_id,event) values(pid,p_actor,'prepared');
  return to_jsonb(a);
end $function$
;
