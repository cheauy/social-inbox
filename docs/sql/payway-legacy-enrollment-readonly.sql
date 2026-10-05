-- READ ONLY. Run only through authorized read-only access.
-- Capture these identity/baseline objects privately; never publish them as logs.
-- No merchant credential is requested. Historical merchant equality must be
-- confirmed separately as a boolean; absence/not-found cannot prove it.
with target as (
 select b.*,to_jsonb(b) as row_json from public.billing_transactions b
 where b.provider='payway' and b.provider_transaction_id in (
 '178798123601437','178798124683199','178740541334731',
 '178740542390545','178740902940328','178793067865680')
), identities as (
 select t.id,t.business_id,t.provider_transaction_id,t.status,t.verified_at,
 t.callback_received_at,t.metadata->>'environment' as environment,
 t.metadata->>'live_enabled' as live_enabled,
 (select jsonb_object_agg(key,value) from jsonb_each(t.row_json)
 where key=any(array['id','business_id','provider','provider_transaction_id',
 'plan_code','billing_cycle','amount','currency','target_member_limit','target_channel_limit',
 'renew_same','pricing_version','pricing_snapshot','requested_by_member_id','request_time','created_at']))
 as payment_identity,
 to_jsonb(s)-array['id','created_at','updated_at'] as subscription_identity
 from target t left join public.business_subscriptions s on s.business_id=t.business_id
)
select *,md5(payment_identity::text) as payment_fingerprint,
 md5(subscription_identity::text) as subscription_fingerprint
from identities order by business_id,provider_transaction_id;

-- Extra unknown pending payments must also be reviewed; they are never excluded
-- from the new guard or silently ignored to make an installer pass.
select provider,provider_transaction_id,business_id,status,created_at
from public.billing_transactions where provider='payway' and status='pending'
order by business_id,created_at;
select id,business_id,status,created_at,pricing_snapshot->>'purchase_type' as purchase_type
from public.manual_payment_requests where status in ('draft','pending','submitted')
order by business_id,created_at;
select current_setting('TimeZone') as current_session_timezone,
 current_setting('default_transaction_isolation') as default_transaction_isolation;
select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid in ('public.billing_transactions'::regclass,'public.manual_payment_requests'::regclass)
order by conrelid,conname;
