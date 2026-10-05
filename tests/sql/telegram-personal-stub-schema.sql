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
  platform text not null, platform_account_id text, account_name text, is_active boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now());
grant select, insert, update, delete on all tables in schema public to service_role;
