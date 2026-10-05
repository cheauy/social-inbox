-- READ ONLY. Metadata capture for reviewed Billing retention/account deletion.
-- Do not execute installers or mutate settings/rows. Supply all result sets
-- privately for review; no merchant credentials or payment/customer values.

-- 1. Actual money column types/typmods; fingerprint scale is not DDL evidence.
select n.nspname as schema_name,c.relname as table_name,a.attname as column_name,
       format_type(a.atttypid,a.atttypmod) as declared_type
from pg_attribute a join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and a.attnum>0 and not a.attisdropped
  and ((c.relname in ('billing_transactions','manual_payment_requests') and a.attname='amount')
    or (c.relname='business_subscriptions' and a.attname='last_paid_amount'))
order by c.relname,a.attname;

-- 2. All FKs touching the account/workspace/payment lifecycle, including both
-- outgoing/incoming auth.users and team_members links and DELETE actions.
select k.conname,k.conrelid::regclass::text as referencing_table,
       k.confrelid::regclass::text as referenced_table,
       pg_get_constraintdef(k.oid,true) as definition,k.convalidated
from pg_constraint k
where k.contype='f' and (
 k.conrelid in (to_regclass('auth.users'),to_regclass('public.team_members'),
  to_regclass('public.businesses'),to_regclass('public.business_subscriptions'),
  to_regclass('public.billing_transactions'),to_regclass('public.manual_payment_requests'))
 or k.confrelid in (to_regclass('auth.users'),to_regclass('public.team_members'),
  to_regclass('public.businesses'),to_regclass('public.business_subscriptions'),
  to_regclass('public.billing_transactions'),to_regclass('public.manual_payment_requests')))
order by referencing_table,k.conname;

-- 3. DELETE triggers, including PostgreSQL's internal FK triggers. Full bodies
-- are returned only for non-internal application functions.
select t.tgrelid::regclass::text as table_name,t.tgname,t.tgenabled,t.tgisinternal,
       pg_get_triggerdef(t.oid,true) as trigger_definition,
       p.oid::regprocedure::text as function_signature,
       pg_get_userbyid(p.proowner) as function_owner,p.prosecdef,p.proacl,
       case when not t.tgisinternal then pg_get_functiondef(p.oid) end as function_definition
from pg_trigger t join pg_proc p on p.oid=t.tgfoid
where (t.tgtype::integer & 8)<>0 and t.tgrelid in (
 to_regclass('auth.users'),to_regclass('public.team_members'),
 to_regclass('public.businesses'),to_regclass('public.business_subscriptions'),
 to_regclass('public.billing_transactions'),to_regclass('public.manual_payment_requests'))
order by table_name,t.tgname;
