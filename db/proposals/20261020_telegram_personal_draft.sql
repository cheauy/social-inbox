-- TENH Telegram Personal — PROPOSED SCHEMA (Phase B draft).
-- Status: tested only against a scratch Postgres 16 with stand-in base tables
-- (tests/sql/telegram-personal-*.sql). NOT applied to any TENH environment.
-- Run docs/sql/telegram-personal-preflight-readonly.sql first and review.
-- The owner applies this manually; nothing here activates the feature, which
-- also requires TENH_TELEGRAM_PERSONAL_ENABLED and a running worker.
--
-- Design (docs/telegram-personal-phase-a.md):
--  * Multi-tenant self-service: any workspace Owner connects their OWN account.
--    The TENH user who signs in is the "holder". Sessions are isolated per row
--    (own TDLib directory, own wrapped key, own lease).
--  * One Telegram account can be live in at most one workspace.
--  * A Personal account counts as one channel through social_accounts.is_active.
--  * Every worker write is fenced by (lease_owner, lease_epoch).
--  * No secrets in clear: db key is wrapped by the worker KEK; login inputs are
--    sealed to the worker public key; QR links live only while a login is open.

begin;

-- 0. Refuse to install if an existing CHECK constraint restricts
--    social_accounts.platform without telegram_personal. Extending it is a
--    separate, reviewed change (the current definition is not in the repo).
do $guard$
declare r record;
begin
  for r in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.social_accounts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%platform%'
  loop
    if r.def not ilike '%telegram_personal%' then
      raise exception 'social_accounts constraint % restricts platform (%). Extend it to include telegram_personal before installing.', r.conname, r.def;
    end if;
  end loop;
end
$guard$;

-- 1. Sessions -----------------------------------------------------------------
create table if not exists public.telegram_personal_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  social_account_id uuid unique references public.social_accounts(id) on delete set null,
  holder_user_id uuid not null,
  holder_member_id uuid not null,
  login_method text not null check (login_method in ('qr','phone')),
  status text not null default 'connecting' check (status in (
    'connecting','waiting_phone','waiting_qr','waiting_code','waiting_password',
    'connected','reconnecting','pausing','paused','disconnect_pending',
    'cancelled','expired','failed','revoked','disconnected')),
  team_access text not null default 'holder_only'
    check (team_access in ('holder_only','owners','all_inbox_members','selected_members')),
  telegram_user_id text,
  display_name text,
  username text,
  phone_masked text,
  db_key_wrapped text,
  local_state text not null default 'none' check (local_state in ('none','present','removed')),
  assigned_worker text,
  lease_owner text,
  lease_epoch bigint not null default 0,
  lease_expires_at timestamptz,
  last_shutdown text check (last_shutdown in ('clean','unclean')),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  disclosure_accepted_at timestamptz not null,
  connected_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live owner per Telegram account across all workspaces.
create unique index if not exists telegram_personal_live_account_unique
  on public.telegram_personal_sessions (telegram_user_id)
  where telegram_user_id is not null
    and status in ('connected','reconnecting','pausing','paused','disconnect_pending');

-- One open login per holder per workspace.
create unique index if not exists telegram_personal_one_open_login
  on public.telegram_personal_sessions (business_id, holder_user_id)
  where status in ('connecting','waiting_phone','waiting_qr','waiting_code','waiting_password');

create index if not exists telegram_personal_sessions_business
  on public.telegram_personal_sessions (business_id, created_at desc);

-- 2. Login state (deleted when the login finishes) ------------------------------
create table if not exists public.telegram_personal_logins (
  session_id uuid primary key references public.telegram_personal_sessions(id) on delete cascade,
  qr_link text check (qr_link is null or qr_link like 'tg://login?token=%'),
  password_hint text,
  input_kind text check (input_kind in ('phone','code','password')),
  input_sealed text,
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{1,64}$'),
  deadline_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- 3. Lifecycle commands (web -> worker). Idempotent per client_request_id. -------
create table if not exists public.telegram_personal_commands (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.telegram_personal_sessions(id) on delete cascade,
  business_id uuid not null,
  requested_by_member_id uuid not null,
  kind text not null check (kind in ('pause','logout')),
  client_request_id uuid not null,
  status text not null default 'queued' check (status in ('queued','claimed','done','failed')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, client_request_id)
);
create index if not exists telegram_personal_commands_open
  on public.telegram_personal_commands (session_id, created_at)
  where status in ('queued','claimed');

-- 4. Explicit team access for team_access = 'selected_members' -----------------
create table if not exists public.telegram_personal_member_access (
  session_id uuid not null references public.telegram_personal_sessions(id) on delete cascade,
  member_id uuid not null,
  granted_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (session_id, member_id)
);

-- 5. No client access. API routes and worker use service_role. ------------------
alter table public.telegram_personal_sessions enable row level security;
alter table public.telegram_personal_logins enable row level security;
alter table public.telegram_personal_commands enable row level security;
alter table public.telegram_personal_member_access enable row level security;
revoke all on public.telegram_personal_sessions, public.telegram_personal_logins,
  public.telegram_personal_commands, public.telegram_personal_member_access
  from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_personal_sessions,
  public.telegram_personal_logins, public.telegram_personal_commands,
  public.telegram_personal_member_access to service_role;

-- 6. Helpers ---------------------------------------------------------------------
create or replace function public.tgp_open_login_statuses() returns text[]
language sql immutable set search_path = '' as $$
  select array['connecting','waiting_phone','waiting_qr','waiting_code','waiting_password']
$$;

create or replace function public.tgp_terminal_statuses() returns text[]
language sql immutable set search_path = '' as $$
  select array['cancelled','expired','failed','revoked','disconnected']
$$;

-- Channel capacity, mirroring getBusinessEntitlements + the Bot route:
-- unmanaged (no subscription row) is allowed; locked/expired is refused.
create or replace function public.tgp_channel_capacity_error(p_business uuid, p_extra_slots int)
returns text language plpgsql stable set search_path = '' as $$
declare v_sub record; v_active int; v_end timestamptz;
begin
  select status, channel_limit, current_period_end, trial_ends_at
    into v_sub from public.business_subscriptions where business_id = p_business;
  if not found then return null; end if;
  if v_sub.status not in ('active','trialing') then return 'SUBSCRIPTION_LOCKED'; end if;
  v_end := case when v_sub.status = 'trialing'
                then coalesce(v_sub.trial_ends_at, v_sub.current_period_end)
                else v_sub.current_period_end end;
  if v_end is not null and v_end <= now() then return 'SUBSCRIPTION_LOCKED'; end if;
  select count(*) into v_active from public.social_accounts
    where business_id = p_business and is_active;
  if v_active + p_extra_slots > coalesce(v_sub.channel_limit, 0) then return 'CHANNEL_LIMIT_REACHED'; end if;
  return null;
end $$;

create or replace function public.tgp_is_active_owner(p_business uuid, p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.team_members
    where business_id = p_business and user_id = p_user and is_active and role = 'owner')
$$;

create or replace function public.tgp_wake(p_session uuid) returns void
language sql set search_path = '' as $$
  select pg_notify('telegram_personal', p_session::text)
$$;

-- 7. API-side RPCs (service_role; the API has already authenticated the user) ------
create or replace function public.tgp_begin_login(
  p_business uuid, p_user uuid, p_member uuid, p_method text,
  p_login_ttl_seconds int default 300, p_max_open_per_business int default 3)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid; v_err text;
begin
  if p_method not in ('qr','phone') then raise exception 'TGP_BAD_METHOD' using errcode = '22023'; end if;
  if p_login_ttl_seconds not between 60 and 900 then raise exception 'TGP_BAD_TTL' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('tgp:business:' || p_business::text, 0));
  if not public.tgp_is_active_owner(p_business, p_user) then
    raise exception 'TGP_NOT_OWNER' using errcode = '42501';
  end if;
  if exists (select 1 from public.telegram_personal_sessions
             where business_id = p_business and holder_user_id = p_user
               and status = any(public.tgp_open_login_statuses())) then
    raise exception 'TGP_LOGIN_ALREADY_OPEN' using errcode = '23505';
  end if;
  if (select count(*) from public.telegram_personal_sessions
      where business_id = p_business and status = any(public.tgp_open_login_statuses()))
     >= p_max_open_per_business then
    raise exception 'TGP_TOO_MANY_LOGINS' using errcode = '53400';
  end if;
  v_err := public.tgp_channel_capacity_error(p_business, 1);
  if v_err is not null then raise exception 'TGP_%', v_err using errcode = '53400'; end if;

  insert into public.telegram_personal_sessions
    (business_id, holder_user_id, holder_member_id, login_method, disclosure_accepted_at)
  values (p_business, p_user, p_member, p_method, now())
  returning id into v_id;
  insert into public.telegram_personal_logins (session_id, deadline_at)
  values (v_id, now() + make_interval(secs => p_login_ttl_seconds));
  perform public.tgp_wake(v_id);
  return v_id;
end $$;

create or replace function public.tgp_submit_login_input(
  p_session uuid, p_business uuid, p_user uuid, p_kind text, p_sealed text)
returns boolean language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.telegram_personal_sessions
   where id = p_session and business_id = p_business and holder_user_id = p_user
   for update;
  if not found or v_status <> 'waiting_' || p_kind then return false; end if;
  if p_sealed is null or length(p_sealed) > 4096 then return false; end if;
  update public.telegram_personal_logins
     set input_kind = p_kind, input_sealed = p_sealed, error_code = null, updated_at = now()
   where session_id = p_session and deadline_at > now();
  if not found then return false; end if;
  perform public.tgp_wake(p_session);
  return true;
end $$;

-- Cancellation takes effect immediately; late worker updates are fenced by status.
create or replace function public.tgp_cancel_login(p_session uuid, p_business uuid, p_user uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.telegram_personal_sessions
     set status = 'cancelled', ended_at = now(), updated_at = now()
   where id = p_session and business_id = p_business and holder_user_id = p_user
     and status = any(public.tgp_open_login_statuses());
  if not found then return false; end if;
  delete from public.telegram_personal_logins where session_id = p_session;
  perform public.tgp_wake(p_session);
  return true;
end $$;

-- pause: holder or any active owner; logout (sign out + revoke): holder or any
-- active owner; resume: holder only (re-exposes the holder's account).
create or replace function public.tgp_request_action(
  p_session uuid, p_business uuid, p_user uuid, p_member uuid, p_kind text, p_client_request_id uuid)
returns text language plpgsql set search_path = '' as $$
declare s public.telegram_personal_sessions; v_err text;
begin
  perform pg_advisory_xact_lock(hashtextextended('tgp:business:' || p_business::text, 0));
  select * into s from public.telegram_personal_sessions
   where id = p_session and business_id = p_business for update;
  if not found then return 'NOT_FOUND'; end if;
  if s.holder_user_id <> p_user and not (p_kind <> 'resume' and public.tgp_is_active_owner(p_business, p_user)) then
    return 'FORBIDDEN';
  end if;
  if exists (select 1 from public.telegram_personal_commands
             where session_id = p_session and client_request_id = p_client_request_id) then
    return 'DUPLICATE';
  end if;

  if p_kind = 'pause' then
    if s.status not in ('connected','reconnecting') then return 'INVALID_STATE'; end if;
    update public.telegram_personal_sessions set status = 'pausing', updated_at = now() where id = p_session;
  elsif p_kind = 'logout' then
    if s.status in ('cancelled','expired','failed','revoked','disconnected','disconnect_pending')
       or s.status = any(public.tgp_open_login_statuses()) then return 'INVALID_STATE'; end if;
    update public.telegram_personal_sessions set status = 'disconnect_pending', updated_at = now() where id = p_session;
  elsif p_kind = 'resume' then
    if s.status <> 'paused' then return 'INVALID_STATE'; end if;
    v_err := public.tgp_channel_capacity_error(p_business, 1);
    if v_err is not null then return v_err; end if;
    update public.telegram_personal_sessions set status = 'reconnecting', updated_at = now() where id = p_session;
    update public.social_accounts set is_active = true, updated_at = now() where id = s.social_account_id;
    perform public.tgp_wake(p_session);
    return 'OK';
  else
    return 'INVALID_KIND';
  end if;

  -- Stop counting/ingesting at once; the worker finishes the Telegram side.
  update public.social_accounts set is_active = false, updated_at = now() where id = s.social_account_id;
  insert into public.telegram_personal_commands (session_id, business_id, requested_by_member_id, kind, client_request_id)
  values (p_session, p_business, p_member, p_kind, p_client_request_id);
  perform public.tgp_wake(p_session);
  return 'OK';
end $$;

create or replace function public.tgp_set_team_access(
  p_session uuid, p_business uuid, p_user uuid, p_mode text, p_member_ids uuid[])
returns text language plpgsql set search_path = '' as $$
declare v_valid int;
begin
  if p_mode not in ('holder_only','owners','all_inbox_members','selected_members') then return 'INVALID_MODE'; end if;
  perform 1 from public.telegram_personal_sessions
   where id = p_session and business_id = p_business and holder_user_id = p_user for update;
  if not found then return 'FORBIDDEN'; end if;
  if p_mode = 'selected_members' then
    select count(*) into v_valid from public.team_members
     where business_id = p_business and is_active and id = any(coalesce(p_member_ids, '{}'));
    if v_valid <> coalesce(cardinality(p_member_ids), 0) then return 'INVALID_MEMBER'; end if;
  end if;
  delete from public.telegram_personal_member_access where session_id = p_session;
  if p_mode = 'selected_members' then
    insert into public.telegram_personal_member_access (session_id, member_id, granted_by_user_id)
    select p_session, m, p_user from unnest(p_member_ids) as m;
  end if;
  update public.telegram_personal_sessions set team_access = p_mode, updated_at = now() where id = p_session;
  return 'OK';
end $$;

-- 8. Worker-side RPCs (fenced) ---------------------------------------------------
create or replace function public.tgp_holds_lease(p_session uuid, p_worker text, p_epoch bigint)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.telegram_personal_sessions
    where id = p_session and lease_owner = p_worker and lease_epoch = p_epoch and lease_expires_at > now())
$$;

-- Claims sessions that need a client: open logins, live sessions, pending
-- lifecycle work, or terminal sessions whose local data still has to be removed.
create or replace function public.tgp_claim_sessions(p_worker text, p_ttl_seconds int, p_limit int)
returns table (id uuid, business_id uuid, status text, login_method text, lease_epoch bigint,
               db_key_wrapped text, local_state text)
language plpgsql set search_path = '' as $$
begin
  return query
  with candidates as (
    select s.id from public.telegram_personal_sessions s
    where (s.assigned_worker is null or s.assigned_worker = p_worker)
      and (s.lease_expires_at is null or s.lease_expires_at <= now())
      and (s.status in ('connecting','waiting_phone','waiting_qr','waiting_code','waiting_password',
                        'connected','reconnecting','pausing','disconnect_pending')
           or (s.status = any(public.tgp_terminal_statuses()) and s.local_state = 'present'))
    order by s.updated_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.telegram_personal_sessions s
     set lease_owner = p_worker,
         lease_epoch = s.lease_epoch + 1,
         lease_expires_at = now() + make_interval(secs => p_ttl_seconds),
         assigned_worker = coalesce(s.assigned_worker, p_worker),
         updated_at = now()
    from candidates c
   where s.id = c.id
  returning s.id, s.business_id, s.status, s.login_method, s.lease_epoch, s.db_key_wrapped, s.local_state;
end $$;

create or replace function public.tgp_renew_lease(p_session uuid, p_worker text, p_epoch bigint, p_ttl_seconds int)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.telegram_personal_sessions
     set lease_expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = p_session and lease_owner = p_worker and lease_epoch = p_epoch and lease_expires_at > now();
  return found;
end $$;

create or replace function public.tgp_release_lease(p_session uuid, p_worker text, p_epoch bigint, p_shutdown text)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.telegram_personal_sessions
     set lease_owner = null, lease_expires_at = null,
         last_shutdown = coalesce(p_shutdown, last_shutdown), updated_at = now()
   where id = p_session and lease_owner = p_worker and lease_epoch = p_epoch;
  return found;
end $$;

-- Generic fenced update. Terminal and lifecycle transitions also deactivate the
-- channel; a terminal status can never be left again.
create or replace function public.tgp_worker_update(p_session uuid, p_worker text, p_epoch bigint, p_patch jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare s public.telegram_personal_sessions; v_status text;
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return false; end if;
  select * into s from public.telegram_personal_sessions where id = p_session for update;
  v_status := coalesce(p_patch->>'status', s.status);
  if v_status <> s.status then
    if s.status = any(public.tgp_terminal_statuses()) then return false; end if;
    -- A cancelled/paused/disconnecting session must not be revived by a late update.
    if s.status in ('pausing','disconnect_pending')
       and v_status not in ('paused','disconnected','revoked','failed') then return false; end if;
    if s.status = 'paused' and v_status not in ('revoked','disconnected') then return false; end if;
    if v_status in ('connected','reconnecting')
       and s.status not in ('connected','reconnecting') then return false; end if; -- use tgp_activate
  end if;
  if p_patch ? 'db_key_wrapped' and p_patch->>'db_key_wrapped' is not null and s.db_key_wrapped is not null then
    return false; -- keys are set once per session
  end if;

  update public.telegram_personal_sessions set
    status = v_status,
    last_error_code = case when p_patch ? 'last_error_code' then p_patch->>'last_error_code' else last_error_code end,
    local_state = coalesce(p_patch->>'local_state', local_state),
    db_key_wrapped = case when p_patch ? 'db_key_wrapped' then p_patch->>'db_key_wrapped' else db_key_wrapped end,
    ended_at = case when v_status = any(public.tgp_terminal_statuses()) then coalesce(ended_at, now()) else ended_at end,
    updated_at = now()
  where id = p_session;

  if v_status = any(public.tgp_terminal_statuses()) or v_status in ('paused','pausing','disconnect_pending') then
    update public.social_accounts set is_active = false, updated_at = now() where id = s.social_account_id and is_active;
    if v_status = any(public.tgp_terminal_statuses()) then
      delete from public.telegram_personal_logins where session_id = p_session;
    end if;
  end if;
  return true;
end $$;

-- Login progress. Ignored unless the login is still open (delayed QR updates
-- after cancel/expiry are dropped here).
create or replace function public.tgp_worker_login_update(
  p_session uuid, p_worker text, p_epoch bigint, p_status text,
  p_qr_link text, p_password_hint text, p_error_code text)
returns boolean language plpgsql set search_path = '' as $$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return false; end if;
  if p_status is not null and not (p_status = any(public.tgp_open_login_statuses())) then return false; end if;
  update public.telegram_personal_sessions
     set status = coalesce(p_status, status), last_error_code = p_error_code, updated_at = now()
   where id = p_session and status = any(public.tgp_open_login_statuses());
  if not found then return false; end if;
  update public.telegram_personal_logins
     set qr_link = case when coalesce(p_status, '') = 'waiting_qr' then p_qr_link else null end,
         password_hint = case when coalesce(p_status, '') = 'waiting_password' then left(p_password_hint, 128) else null end,
         error_code = p_error_code,
         updated_at = now()
   where session_id = p_session;
  return true;
end $$;

create or replace function public.tgp_take_login_input(p_session uuid, p_worker text, p_epoch bigint)
returns table (input_kind text, input_sealed text, deadline_at timestamptz)
language plpgsql set search_path = '' as $$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return; end if;
  return query
  with taken as (
    select l.session_id, l.input_kind, l.input_sealed, l.deadline_at
    from public.telegram_personal_logins l
    join public.telegram_personal_sessions s on s.id = l.session_id
    where l.session_id = p_session and s.status = any(public.tgp_open_login_statuses())
    for update of l
  )
  update public.telegram_personal_logins l
     set input_kind = null, input_sealed = null, updated_at = now()
    from taken t
   where l.session_id = t.session_id
  returning t.input_kind, t.input_sealed, t.deadline_at;
end $$;

-- Completes a login: duplicate-ownership and capacity checks, then creates or
-- reuses the workspace's social_accounts row in the same transaction.
create or replace function public.tgp_activate(
  p_session uuid, p_worker text, p_epoch bigint,
  p_telegram_user_id text, p_display_name text, p_username text, p_phone_masked text)
returns jsonb language plpgsql set search_path = '' as $$
declare s public.telegram_personal_sessions; v_err text; v_account uuid;
begin
  if p_telegram_user_id !~ '^[0-9]{1,20}$' then return jsonb_build_object('ok', false, 'code', 'BAD_IDENTITY'); end if;
  select * into s from public.telegram_personal_sessions where id = p_session;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tgp:business:' || s.business_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('tgp:telegram-user:' || p_telegram_user_id, 0));
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then
    return jsonb_build_object('ok', false, 'code', 'LEASE_LOST');
  end if;
  select * into s from public.telegram_personal_sessions where id = p_session for update;
  if not (s.status = any(public.tgp_open_login_statuses())) then
    return jsonb_build_object('ok', false, 'code', 'LOGIN_NOT_OPEN');
  end if;

  if exists (select 1 from public.telegram_personal_sessions o
             where o.telegram_user_id = p_telegram_user_id and o.id <> p_session
               and o.status in ('connected','reconnecting','pausing','paused','disconnect_pending')) then
    v_err := case when exists (select 1 from public.telegram_personal_sessions o
                               where o.telegram_user_id = p_telegram_user_id and o.id <> p_session
                                 and o.business_id = s.business_id
                                 and o.status in ('connected','reconnecting','pausing','paused','disconnect_pending'))
                  then 'ACCOUNT_ALREADY_CONNECTED' else 'ACCOUNT_IN_OTHER_WORKSPACE' end;
  end if;
  if v_err is null and not public.tgp_is_active_owner(s.business_id, s.holder_user_id) then
    v_err := 'HOLDER_NO_LONGER_OWNER';
  end if;
  if v_err is null then v_err := public.tgp_channel_capacity_error(s.business_id, 1); end if;

  if v_err is not null then
    update public.telegram_personal_sessions
       set status = 'failed', last_error_code = v_err, ended_at = now(), updated_at = now()
     where id = p_session;
    delete from public.telegram_personal_logins where session_id = p_session;
    return jsonb_build_object('ok', false, 'code', v_err);
  end if;

  select id into v_account from public.social_accounts
   where business_id = s.business_id and platform = 'telegram_personal'
     and platform_account_id = p_telegram_user_id
   order by created_at desc limit 1 for update;
  if v_account is null then
    insert into public.social_accounts (business_id, platform, platform_account_id, account_name, is_active)
    values (s.business_id, 'telegram_personal', p_telegram_user_id, left(p_display_name, 200), true)
    returning id into v_account;
  else
    -- Detach the row from any earlier (ended) session, keep its history.
    update public.telegram_personal_sessions set social_account_id = null
     where social_account_id = v_account and id <> p_session;
    update public.social_accounts
       set is_active = true, account_name = left(p_display_name, 200), updated_at = now()
     where id = v_account;
  end if;

  update public.telegram_personal_sessions
     set status = 'connected', social_account_id = v_account, telegram_user_id = p_telegram_user_id,
         display_name = left(p_display_name, 200), username = left(p_username, 64),
         phone_masked = left(p_phone_masked, 32), last_error_code = null,
         connected_at = now(), updated_at = now()
   where id = p_session;
  delete from public.telegram_personal_logins where session_id = p_session;
  return jsonb_build_object('ok', true, 'social_account_id', v_account);
end $$;

create or replace function public.tgp_claim_commands(p_session uuid, p_worker text, p_epoch bigint, p_limit int)
returns setof public.telegram_personal_commands language plpgsql set search_path = '' as $$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return; end if;
  return query
  update public.telegram_personal_commands c set status = 'claimed', updated_at = now()
   where c.id in (select id from public.telegram_personal_commands
                  where session_id = p_session and status in ('queued','claimed')
                  order by created_at limit greatest(p_limit, 0) for update skip locked)
  returning c.*;
end $$;

create or replace function public.tgp_finish_command(
  p_command uuid, p_session uuid, p_worker text, p_epoch bigint, p_status text, p_error_code text)
returns boolean language plpgsql set search_path = '' as $$
begin
  if p_status not in ('done','failed') then return false; end if;
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return false; end if;
  update public.telegram_personal_commands set status = p_status, error_code = p_error_code, updated_at = now()
   where id = p_command and session_id = p_session and status = 'claimed';
  return found;
end $$;

-- 9. Function privileges ---------------------------------------------------------
do $grants$
declare f text;
begin
  foreach f in array array[
    'tgp_open_login_statuses()','tgp_terminal_statuses()','tgp_channel_capacity_error(uuid,int)',
    'tgp_is_active_owner(uuid,uuid)','tgp_wake(uuid)',
    'tgp_begin_login(uuid,uuid,uuid,text,int,int)','tgp_submit_login_input(uuid,uuid,uuid,text,text)',
    'tgp_cancel_login(uuid,uuid,uuid)','tgp_request_action(uuid,uuid,uuid,uuid,text,uuid)',
    'tgp_set_team_access(uuid,uuid,uuid,text,uuid[])','tgp_holds_lease(uuid,text,bigint)',
    'tgp_claim_sessions(text,int,int)','tgp_renew_lease(uuid,text,bigint,int)',
    'tgp_release_lease(uuid,text,bigint,text)','tgp_worker_update(uuid,text,bigint,jsonb)',
    'tgp_worker_login_update(uuid,text,bigint,text,text,text,text)','tgp_take_login_input(uuid,text,bigint)',
    'tgp_activate(uuid,text,bigint,text,text,text,text)','tgp_claim_commands(uuid,text,bigint,int)',
    'tgp_finish_command(uuid,uuid,text,bigint,text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$grants$;

commit;
