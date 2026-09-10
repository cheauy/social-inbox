-- TENH Companion — browser devices, the Pages they are allowed to watch, and
-- what they reported.
--
-- The extension is an optional layer. Nothing in TENH reads these tables to
-- decide whether a message can be sent, a conversation can be opened, or a
-- webhook can be trusted: they exist so a workspace can see which browsers are
-- paired, revoke one, and read back what a browser observed.
--
-- Safe to run twice.

create table if not exists public.extension_devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  member_id uuid not null references public.team_members (id) on delete cascade,
  user_id uuid not null,

  device_name text not null default 'Chrome browser',
  -- Minted by the extension on first run. Lets one browser re-pair without
  -- leaving a second row behind it.
  browser_installation_id text not null,
  extension_version text,

  -- Only the hash is stored. The token itself is shown to the extension once,
  -- at pairing, and never again -- the same rule the rest of TENH follows for
  -- anything that behaves like a password.
  token_hash text not null,

  status text not null default 'active',

  -- The last thing this browser said about itself. Nothing here is
  -- authoritative; it is what the extension observed, for a human to read.
  facebook_connected boolean not null default false,
  current_page_id text,
  current_page_name text,
  current_url text,
  composer_state text,

  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint extension_devices_status_check
    check (status in ('active', 'revoked'))
);

create unique index if not exists extension_devices_token_hash_key
  on public.extension_devices (token_hash);

create unique index if not exists extension_devices_installation_key
  on public.extension_devices (business_id, member_id, browser_installation_id);

create index if not exists extension_devices_business_idx
  on public.extension_devices (business_id, status);

-- One-time pairing codes. Short-lived, single use, and stored hashed for the
-- same reason the device token is.
create table if not exists public.extension_pair_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  member_id uuid not null references public.team_members (id) on delete cascade,
  user_id uuid not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists extension_pair_codes_hash_key
  on public.extension_pair_codes (code_hash);

create index if not exists extension_pair_codes_expiry_idx
  on public.extension_pair_codes (expires_at);

-- Which Pages a device may report on. Absent rows mean "every Page this
-- workspace has connected", which is the useful default for a shop with one.
create table if not exists public.extension_device_pages (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.extension_devices (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  social_account_id uuid references public.social_accounts (id) on delete cascade,
  page_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists extension_device_pages_key
  on public.extension_device_pages (device_id, page_id);

-- What a browser reported, kept for a workspace to read and for support to
-- reconstruct a session. Never used as a source of messages.
create table if not exists public.extension_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  device_id uuid references public.extension_devices (id) on delete set null,
  member_id uuid references public.team_members (id) on delete set null,
  user_id uuid,
  social_account_id uuid references public.social_accounts (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  event_type text not null,
  status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists extension_events_business_idx
  on public.extension_events (business_id, created_at desc);

create index if not exists extension_events_device_idx
  on public.extension_events (device_id, created_at desc);

alter table public.extension_devices enable row level security;
alter table public.extension_pair_codes enable row level security;
alter table public.extension_device_pages enable row level security;
alter table public.extension_events enable row level security;

-- Reading is scoped to a workspace somebody is actually an active member of --
-- the same rule every other TENH table applies. Writing is the server's job:
-- these routes run with the service role after checking membership, so no
-- insert or update policy is granted to anybody else.
drop policy if exists "Tenh members read their extension devices"
  on public.extension_devices;

create policy "Tenh members read their extension devices"
  on public.extension_devices
  for select
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.business_id = extension_devices.business_id
        and tm.user_id = (select auth.uid())
        and tm.is_active = true
    )
  );

drop policy if exists "Tenh members read their extension device pages"
  on public.extension_device_pages;

create policy "Tenh members read their extension device pages"
  on public.extension_device_pages
  for select
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.business_id = extension_device_pages.business_id
        and tm.user_id = (select auth.uid())
        and tm.is_active = true
    )
  );

drop policy if exists "Tenh members read their extension events"
  on public.extension_events;

create policy "Tenh members read their extension events"
  on public.extension_events
  for select
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.business_id = extension_events.business_id
        and tm.user_id = (select auth.uid())
        and tm.is_active = true
    )
  );

-- Pairing codes are never read by a browser client: only the server, with the
-- service role, ever touches them. No policy is granted on purpose.
