-- REVIEW DRAFT ONLY. Do not apply automatically or backfill old payment baselines.
-- Requires reviewed coexistence guards and 20261015104508_manual_payment_upload_lifecycle.sql.
-- Fence/drain billing writers; install both drafts before deploying their callers.
begin;

do $prerequisites$
begin
  if to_regprocedure('public.tenh_compat_subscription_identity(jsonb)') is null
    or to_regprocedure('public.tenh_legacy_approval_authorized(uuid)') is null
    or to_regclass('public.manual_payment_uploads') is null then
    raise exception 'Reviewed billing coexistence and manual upload lifecycle are required.';
  end if;
end
$prerequisites$;

create table tenh_billing_private.payment_application_baselines (
  source_type text not null check (source_type in ('payway','manual')),
  source_payment_id uuid not null,
  business_id uuid not null,
  subscription_identity jsonb not null check (jsonb_typeof(subscription_identity)='object'),
  captured_at timestamptz not null default clock_timestamp(),
  primary key (source_type,source_payment_id)
);
revoke all on tenh_billing_private.payment_application_baselines from public,anon,authenticated,service_role;
create trigger tenh_deny_application_baseline_mutation
before update or delete on tenh_billing_private.payment_application_baselines
for each row execute function tenh_billing_private.deny_audit_mutation();

create function tenh_billing_private.capture_application_baseline(
  p_source_type text,p_payment_id uuid,p_business_id uuid)
returns void language plpgsql security invoker set search_path=public as $function$
declare v_subscription public.business_subscriptions%rowtype; v_business uuid;
begin
  if p_source_type is null or p_source_type not in ('payway','manual') or p_payment_id is null or p_business_id is null then
    raise exception 'A saved payment identity is required.';
  end if;
  select * into v_subscription from public.business_subscriptions s where s.business_id=p_business_id for update;
  if not found then raise exception 'Payment subscription was not found.'; end if;
  insert into tenh_billing_private.payment_application_baselines(source_type,source_payment_id,business_id,subscription_identity)
    values(p_source_type,p_payment_id,p_business_id,public.tenh_compat_subscription_identity(to_jsonb(v_subscription)))
    on conflict(source_type,source_payment_id) do nothing;
  select b.business_id into v_business from tenh_billing_private.payment_application_baselines b
    where b.source_type=p_source_type and b.source_payment_id=p_payment_id;
  if v_business is distinct from p_business_id then raise exception 'Saved payment baseline identity changed.'; end if;
end
$function$;

create function tenh_billing_private.capture_new_payment_baseline()
returns trigger language plpgsql security definer set search_path=public as $function$
declare v_type text; v_expected jsonb; v_subscription public.business_subscriptions%rowtype;
begin
  v_type:=case when tg_table_name='billing_transactions' then 'payway' else 'manual' end;
  select * into v_subscription from public.business_subscriptions s where s.business_id=new.business_id for update;
  if not found then raise exception 'Payment subscription was not found.'; end if;
  if tg_table_name='manual_payment_uploads' then
    v_expected:=new.request_payload->'_expected_subscription';
  elsif tg_table_name='billing_transactions' then
    v_expected:=new.metadata->'_expected_subscription';
  elsif exists(select 1 from public.manual_payment_uploads u where u.id=new.id) then
    if not exists(select 1 from tenh_billing_private.payment_application_baselines b
      where b.source_type='manual' and b.source_payment_id=new.id and b.business_id=new.business_id) then
      raise exception 'Prepared payment has no original application baseline; billing review is required.';
    end if;
  end if;
  if tg_table_name in ('billing_transactions','manual_payment_uploads') and (
    jsonb_typeof(v_expected) is distinct from 'object' or
    public.tenh_compat_subscription_identity(v_expected) is distinct from public.tenh_compat_subscription_identity(to_jsonb(v_subscription))) then
    raise exception using errcode='P0001',message='The subscription changed before payment preparation.',detail='TENH_PAYMENT_BASELINE_CHANGED';
  end if;
  perform tenh_billing_private.capture_application_baseline(v_type,new.id,new.business_id);
  if tg_table_name='billing_transactions' then new.metadata:=new.metadata-'_expected_subscription'; end if;
  return new;
end
$function$;

create trigger tenh_01_capture_application_baseline before insert on public.billing_transactions
for each row when (new.provider='payway') execute function tenh_billing_private.capture_new_payment_baseline();
create trigger tenh_01_capture_application_baseline before insert on public.manual_payment_requests
for each row execute function tenh_billing_private.capture_new_payment_baseline();
create trigger tenh_01_capture_application_baseline before insert on public.manual_payment_uploads
for each row execute function tenh_billing_private.capture_new_payment_baseline();

create function tenh_billing_private.guard_payment_application_baseline()
returns trigger language plpgsql security definer set search_path=public as $function$
declare v_type text; v_saved tenh_billing_private.payment_application_baselines%rowtype;
  v_subscription public.business_subscriptions%rowtype;
begin
  if new.status<>'approved' or old.status='approved' then return new; end if;
  v_type:=case when tg_table_name='billing_transactions' then 'payway' else 'manual' end;
  if v_type='payway' and to_jsonb(new)->>'provider' is distinct from 'payway' then return new; end if;
  if (v_type='payway' and old.status::text<>'pending') or (v_type='manual' and old.status::text<>'submitted') then
    raise exception 'A terminal or unsubmitted payment requires billing review before application.';
  end if;
  select * into v_subscription from public.business_subscriptions s where s.business_id=new.business_id for update;
  if not found then raise exception 'Payment subscription was not found.'; end if;
  if v_type='payway' and public.tenh_legacy_approval_authorized(new.id) then return new; end if;
  select * into v_saved from tenh_billing_private.payment_application_baselines b
    where b.source_type=v_type and b.source_payment_id=new.id and b.business_id=new.business_id;
  if not found then raise exception 'Original payment application baseline is missing; billing review is required.'; end if;
  if v_saved.subscription_identity is distinct from public.tenh_compat_subscription_identity(to_jsonb(v_subscription)) then
    raise exception 'The saved payment cannot replace a changed subscription; billing review is required.';
  end if;
  return new;
end
$function$;

create trigger tenh_02_guard_application_baseline before update of status on public.billing_transactions
for each row execute function tenh_billing_private.guard_payment_application_baseline();
create trigger tenh_02_guard_application_baseline before update of status on public.manual_payment_requests
for each row execute function tenh_billing_private.guard_payment_application_baseline();

create function public.tenh_payment_application_guards_ready()
returns boolean language sql stable security invoker set search_path=public as $function$
select count(*)=5 and coalesce(bool_and(t.tgenabled in ('O','A')),false)
from pg_catalog.pg_trigger t
where not t.tgisinternal and (t.tgrelid,t.tgname) in (
  ('public.billing_transactions'::regclass,'tenh_01_capture_application_baseline'),
  ('public.manual_payment_requests'::regclass,'tenh_01_capture_application_baseline'),
  ('public.manual_payment_uploads'::regclass,'tenh_01_capture_application_baseline'),
  ('public.billing_transactions'::regclass,'tenh_02_guard_application_baseline'),
  ('public.manual_payment_requests'::regclass,'tenh_02_guard_application_baseline'))
$function$;
revoke all on function public.tenh_payment_application_guards_ready() from public,anon,authenticated;
grant execute on function public.tenh_payment_application_guards_ready() to service_role;

revoke all on function tenh_billing_private.capture_application_baseline(text,uuid,uuid),
  tenh_billing_private.capture_new_payment_baseline(),tenh_billing_private.guard_payment_application_baseline()
  from public,anon,authenticated,service_role;
commit;
