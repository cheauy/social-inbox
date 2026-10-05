-- SYNTHETIC disposable-database fixture. No captured production functions/data.
-- Native tests cover the exact compatibility core's concurrency boundaries.
-- Private activation bodies below are explicitly labelled fixture models.
do $$begin
 if current_database() !~ '^tenh_native_test_[a-z0-9_]+$' then
   raise exception 'Only an explicitly named disposable native-test database is allowed.';
 end if;
 if current_user<>'postgres' then raise exception 'Synthetic fixture requires isolated postgres role.'; end if;
 if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind='r') then
   raise exception 'Fixture database must be empty.';
 end if;
end$$;
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create table public.business_subscriptions(
 id uuid default gen_random_uuid(),business_id uuid primary key,plan_code text,status text,billing_cycle text,
 member_limit integer,channel_limit integer,current_period_start timestamptz,current_period_end timestamptz,
 last_paid_amount numeric,last_paid_currency text,pricing_version text,pricing_snapshot jsonb default '{}',
 payment_provider text,provider_customer_id text,provider_subscription_id text,
 cancel_at_period_end boolean default false,cancellation_requested_at timestamptz,cancellation_effective_at timestamptz,
 cancellation_requested_by_member_id uuid,cancellation_reason text,pending_plan_code text,pending_billing_cycle text,
 pending_plan_change_type text,pending_plan_requested_at timestamptz,pending_plan_effective_at timestamptz,
 pending_plan_requested_by_member_id uuid,suspended_at timestamptz,updated_at timestamptz,
 constraint business_subscriptions_custom_capacity_check check(plan_code<>'custom' or
 (channel_limit between 3 and 30 and member_limit between 1 and 100))
);
create table public.billing_transactions(
 id uuid primary key default gen_random_uuid(),business_id uuid,provider text,provider_transaction_id text unique,
 plan_code text,billing_cycle text,amount numeric,currency text,status text,target_member_limit integer,
 target_channel_limit integer,renew_same boolean default false,pricing_version text,pricing_snapshot jsonb default '{}',
 metadata jsonb default '{}',requested_by_member_id uuid,created_at timestamptz default now(),
 callback_received_at timestamptz,verified_at timestamptz,provider_status_code text,provider_status text,
 provider_approval_code text,provider_original_amount numeric,provider_payment_amount numeric,provider_payment_currency text
);
create table public.manual_payment_requests(
 id uuid primary key default gen_random_uuid(),business_id uuid,plan_code text,billing_cycle text,amount numeric,
 currency text,status text,target_member_limit integer,target_channel_limit integer,renew_same boolean default false,
 pricing_version text,pricing_snapshot jsonb default '{}',requested_by_member_id uuid,reviewed_by_user_id uuid,
 reviewed_by_email text,reviewed_at timestamptz,review_note text,approved_at timestamptz,created_at timestamptz default now()
);
create table public.tenh_billing_invoices(
 id uuid primary key default gen_random_uuid(),invoice_number text,business_id uuid,source_type text,source_payment_id uuid,
 source_transaction_id text,workspace_name text,customer_name text,billing_email text,
 plan_code text,plan_name text,billing_cycle text,billing_cycle_label text,amount numeric,currency text,
 payment_method text,provider text,provider_approval_code text,status text,paid_at timestamptz,
 period_start timestamptz,period_end timestamptz,issued_at timestamptz,snapshot jsonb default '{}',unique(source_type,source_payment_id)
);
create table public.team_members(id uuid,user_id uuid,business_id uuid,full_name text,email text,role text,is_active boolean);
create table public.businesses(id uuid,name text);
create table public.social_accounts(business_id uuid,is_active boolean);
create function public.tenh_plan_member_limit(text) returns integer language sql immutable as
 $$select case $1 when 'mini' then 1 when 'standard' then 3 when 'pro' then 8 end$$;
create function public.tenh_plan_channel_limit(text) returns integer language sql immutable as
 $$select case $1 when 'mini' then 3 when 'standard' then 5 when 'pro' then 12 end$$;
create function public.tenh_invoice_period_end(timestamptz,text) returns timestamptz language sql as
 $$select $1+make_interval(months=>case $2 when 'monthly' then 1 when '3-months' then 3 when '6-months' then 6 when '12-months' then 12 end)$$;
create function public.tenh_next_billing_invoice_number(timestamptz) returns text language sql as
 $$select gen_random_uuid()::text$$;
create schema native_fixture;
create function native_fixture.fail_invoice() returns trigger language plpgsql as $$begin
 if current_setting('tenh_native.fail_invoice',true)='on' then raise exception 'Synthetic invoice failure'; end if;
 return new;
end$$;
create trigger native_fixture_fail_invoice before insert on public.tenh_billing_invoices
for each row execute function native_fixture.fail_invoice();
