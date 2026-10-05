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
  member_limit int, channel_limit int, current_period_end timestamptz, trial_ends_at timestamptz, created_at timestamptz default now());
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
  platform text not null, platform_account_id text not null, account_name text, is_active boolean not null default false,
  telegram_token_status text, facebook_token_status text,
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
  if v_active >= v_limit then
    raise exception using errcode = 'P0001', message = 'Channel limit reached. Upgrade your plan.', detail = 'TENH_CHANNEL_LIMIT_REACHED';
  end if;
  return new;
end $$;
create trigger tenh_enforce_channel_entitlement before insert or update of business_id, is_active
  on public.social_accounts for each row execute function public.tenh_check_channel_entitlement();
grant select, insert, update, delete on all tables in schema public to service_role;
-- Stand-in for Supabase auth.uid(): reads the request user set by tests.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Inbox tables shaped like the live columns/constraints used by TENH code
-- (2026-10-05 preflight). Only what the Telegram Personal SQL touches.
create table public.contacts (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  platform text not null, platform_user_id text not null, full_name text, phone text, email text,
  last_contact_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint contacts_platform_check check ((platform = ANY (ARRAY['facebook'::text, 'instagram'::text, 'telegram'::text]))),
  constraint contacts_business_id_platform_platform_user_id_key unique (business_id, platform, platform_user_id));
create table public.conversations (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade, platform text not null,
  status text not null default 'open', source_type text, assigned_to uuid, is_pinned boolean default false,
  unread_count integer not null default 0, last_message_text text, last_message_at timestamptz,
  status_updated_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint conversations_platform_check check ((platform = ANY (ARRAY['facebook'::text, 'instagram'::text, 'telegram'::text]))),
  constraint conversations_status_check check ((status = ANY (ARRAY['open'::text, 'pending'::text, 'resolved'::text, 'closed'::text, 'spam'::text]))),
  constraint conversations_unread_count_check check ((unread_count >= 0)),
  constraint conversations_social_account_id_contact_id_key unique (social_account_id, contact_id));
create table public.messages (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  platform_message_id text not null, sender_platform_id text, recipient_platform_id text,
  direction text not null, message_type text not null default 'text', message_text text, attachment_url text,
  is_echo boolean default false, raw_payload jsonb, platform_created_at timestamptz, sent_by_member_id uuid,
  delivery_status text, delivered_at timestamptz, seen_at timestamptz, created_at timestamptz default now(),
  constraint messages_direction_check check ((direction = ANY (ARRAY['incoming'::text, 'outgoing'::text]))),
  constraint messages_message_type_check check ((message_type = ANY (ARRAY['text'::text, 'image'::text, 'video'::text, 'audio'::text, 'file'::text, 'sticker'::text, 'unknown'::text]))),
  constraint messages_delivery_status_check check (((delivery_status IS NULL) OR (delivery_status = ANY (ARRAY['sent'::text, 'delivered'::text, 'seen'::text])))),
  constraint messages_business_id_platform_message_id_key unique (business_id, platform_message_id));
create table public.conversation_activity (id uuid primary key default gen_random_uuid(), business_id uuid not null, conversation_id uuid references public.conversations(id) on delete cascade, created_at timestamptz default now());
create table public.conversation_reminders (id uuid primary key default gen_random_uuid(), business_id uuid not null, conversation_id uuid references public.conversations(id) on delete cascade, contact_id uuid);
create table public.customer_files (id uuid primary key default gen_random_uuid(), business_id uuid not null, contact_id uuid references public.contacts(id) on delete cascade);
create table public.tags (id uuid primary key default gen_random_uuid(), business_id uuid not null, name text not null);
create table public.contact_tags (contact_id uuid references public.contacts(id) on delete cascade, tag_id uuid references public.tags(id) on delete cascade);
grant select, insert, update, delete on all tables in schema public to service_role;

-- Stand-ins for the live workspace membership rule and its permissive policies.
create function public.can_access_tenh_business(p_business uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members where business_id = p_business and user_id = auth.uid() and is_active)
$$;
grant execute on function public.can_access_tenh_business(uuid) to authenticated;
do $$ declare t text; begin
  foreach t in array array['contacts','conversations','messages','conversation_activity','conversation_reminders','customer_files','contact_tags'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['conversations','messages','conversation_activity','conversation_reminders','customer_files'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "Tenh members can read %s" on public.%I for select to authenticated using (public.can_access_tenh_business(business_id))', t, t);
  end loop;
end $$;
