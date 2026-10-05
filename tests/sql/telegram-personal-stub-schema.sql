-- Stand-in base tables for testing the Telegram Personal draft on a scratch
-- database ONLY. Never run against a TENH environment.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.businesses (id uuid primary key default gen_random_uuid(), name text);
create table public.team_members (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
  user_id uuid not null, role text not null, is_active boolean not null default true, created_at timestamptz default now());
create table public.business_subscriptions (
  business_id uuid primary key references public.businesses(id), plan_code text, status text not null,
  member_limit int, channel_limit int, current_period_end timestamptz, trial_ends_at timestamptz);
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
  platform text not null, platform_account_id text not null, account_name text, is_active boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint social_accounts_platform_check check (platform in ('facebook','telegram')),
  unique (business_id, platform, platform_account_id));
-- Stand-in for the live tenh_enforce_channel_entitlement trigger (body not in
-- the repo): refuses activation beyond the subscription's channel_limit.
create function public.tenh_check_channel_entitlement() returns trigger language plpgsql as $$
declare v_limit int; v_active int;
begin
  if not coalesce(new.is_active, false) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.is_active, false) and old.business_id = new.business_id then return new; end if;
  select channel_limit into v_limit from public.business_subscriptions where business_id = new.business_id;
  if v_limit is null then return new; end if;
  select count(*) into v_active from public.social_accounts where business_id = new.business_id and is_active and id <> new.id;
  if v_active >= v_limit then raise exception 'Channel limit reached for this subscription'; end if;
  return new;
end $$;
create trigger tenh_enforce_channel_entitlement before insert or update of business_id, is_active
  on public.social_accounts for each row execute function public.tenh_check_channel_entitlement();
grant select, insert, update, delete on all tables in schema public to service_role;
