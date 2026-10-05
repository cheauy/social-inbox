-- TENH Telegram Personal — PROPOSED SCHEMA. DRAFT, UNTESTED, DO NOT APPLY.
-- Phase A proposal only. Finalise after docs/sql/telegram-personal-preflight-readonly.sql
-- results are reviewed. Requires owner approval before any environment runs it.
-- No secrets or session material are ever stored in plaintext here.

begin;

-- If preflight shows a CHECK constraint on social_accounts.platform / contacts.platform,
-- it must be extended to include 'telegram_personal' (exact statement depends on the
-- current constraint definition; intentionally not guessed here).

-- 1. One live Personal connection per Telegram user across all workspaces.
create unique index if not exists telegram_personal_live_account_unique
  on public.social_accounts (platform_account_id)
  where platform = 'telegram_personal' and is_active;

-- 2. Session ownership & encrypted key material (worker/service-role only).
create table if not exists public.telegram_personal_sessions (
  social_account_id uuid primary key references public.social_accounts(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  connected_by_user_id uuid not null,
  status text not null default 'connecting' check (status in (
    'connecting','waiting_qr','waiting_code','waiting_password','connected',
    'reconnecting','expired','revoked','paused','disconnect_pending','disconnected','error')),
  telegram_user_id text,                     -- set only after authorizationStateReady
  display_name text,
  username text,
  phone_masked text,                         -- e.g. '+855 •• ••• 123'; never full number
  db_key_wrapped text,                       -- TDLib database_encryption_key, wrapped by worker KEK
  db_key_version smallint not null default 1,
  lease_owner text,
  lease_epoch bigint not null default 0,
  lease_expires_at timestamptz,
  last_shutdown text check (last_shutdown in ('clean','unclean')),
  last_error_code text,                      -- redacted code only, no message text
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 3. Login attempts (QR link / sealed inputs). Short-lived.
create table if not exists public.telegram_personal_login_attempts (
  id uuid primary key default gen_random_uuid(),
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  business_id uuid not null,
  initiated_by_user_id uuid not null,
  method text not null check (method in ('qr','phone')),
  state text not null default 'pending' check (state in (
    'pending','waiting_qr','waiting_code','waiting_password','succeeded','cancelled','expired','failed')),
  qr_link_sealed text,                       -- sealed for API read-back; cleared on finish
  input_sealed text,                         -- code/password sealed to worker pubkey; deleted after use
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists telegram_personal_one_open_login
  on public.telegram_personal_login_attempts (social_account_id)
  where state in ('pending','waiting_qr','waiting_code','waiting_password');

-- 4. Command queue (web -> worker). Idempotent by client_request_id.
create table if not exists public.telegram_personal_commands (
  id uuid primary key default gen_random_uuid(),
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  business_id uuid not null,
  requested_by_member_id uuid,
  kind text not null check (kind in (
    'login_start','login_input','login_cancel','list_chats','share_chat','unshare_chat',
    'send_text','pause','resume','logout','remove_data')),
  client_request_id uuid not null,
  conversation_id uuid,
  payload jsonb not null default '{}'::jsonb,  -- never secrets in clear
  status text not null default 'queued' check (status in (
    'queued','claimed','sending','accepted_local','sent','failed','uncertain','done','cancelled')),
  tdlib_temp_message_id text,
  claimed_epoch bigint,
  attempts int not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (social_account_id, client_request_id)
);
create index if not exists telegram_personal_commands_queue
  on public.telegram_personal_commands (social_account_id, created_at)
  where status in ('queued','claimed','sending','accepted_local');

-- 5. Owner-selected chats. Only these are ingested.
create table if not exists public.telegram_personal_chat_shares (
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  business_id uuid not null,
  chat_id text not null,
  chat_kind text not null default 'private' check (chat_kind in ('private')),
  history_import text not null default 'none' check (history_import in ('none','last_50')),
  shared_by_user_id uuid not null,
  shared_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (social_account_id, chat_id)
);

-- 6. RLS: no client access. Worker uses service_role; API routes enforce permissions.
alter table public.telegram_personal_sessions enable row level security;
alter table public.telegram_personal_login_attempts enable row level security;
alter table public.telegram_personal_commands enable row level security;
alter table public.telegram_personal_chat_shares enable row level security;
revoke all on public.telegram_personal_sessions, public.telegram_personal_login_attempts,
  public.telegram_personal_commands, public.telegram_personal_chat_shares
  from anon, authenticated;

-- 7. Lease + fencing RPCs, command claim, fenced ingest with atomic unread:
--    tgp_claim_lease(p_account uuid, p_owner text, p_ttl_seconds int) returns bigint epoch
--    tgp_renew_lease(p_account uuid, p_owner text, p_epoch bigint) returns boolean
--    tgp_claim_command(p_account uuid, p_epoch bigint) returns setof telegram_personal_commands
--      (FOR UPDATE SKIP LOCKED)
--    tgp_ingest_message(p_account uuid, p_epoch bigint, ...) inserts message on conflict
--      do nothing and increments conversations.unread_count only when inserted.
--  Bodies deliberately omitted until preflight confirms messages/conversations constraints.

-- 8. Decision pending: extend tenh_guard_trial_channel_reuse / check_tenh_trial_channel_access
--    to 'telegram_personal'.

rollback; -- draft guard: replace with commit only after review
