# Telegram Personal — Phase B (isolated implementation, offline-tested)

Status: **tested draft — NOT a pilot, NOT production-ready.**
No Telegram account, `api_id`, credential, session, migration, deployment or
message was created, run or sent. Everything below was verified with a fake
TDLib and a scratch Postgres 16 database inside the development container.

Added requirement (2026-10-05): build it as a **multi-tenant SaaS feature** —
every workspace Owner connects their own account self-service, with isolated
sessions, explicit team-access controls, connection limits and revocation.

## What exists now

| Area | Where | Notes |
|---|---|---|
| Schema + RPCs (proposal) | `db/proposals/20261020_telegram_personal_draft.sql` | Sessions, logins, lifecycle commands, member access; fenced worker RPCs; activation with duplicate-owner and capacity checks. Refuses to install if a `social_accounts.platform` CHECK excludes `telegram_personal`. |
| Read-only preflight | `docs/sql/telegram-personal-preflight-readonly.sql` | Run first; send back the output. |
| Worker service | `workers/telegram-personal/` | Separate Node 22 package (`tdl` 8.1.0 + `prebuilt-tdlib` → TDLib 1.8.67, pinned). See its README. |
| Web flag | `lib/telegram-personal/feature-flag.ts` | Off unless `TENH_TELEGRAM_PERSONAL_ENABLED=true` **and** the workspace is in `TENH_TELEGRAM_PERSONAL_BUSINESS_IDS` (or `*`). Routes answer 404 when off. |
| Web API | `app/api/telegram-personal/connections/**` | Start sign-in, status/QR, sealed inputs, cancel, pause/resume, team access, sign-out. |
| UI | `components/integrations/telegram-personal-panel.tsx`, `integration-workspace.tsx` | Add connection → Telegram → **Telegram Bot** (unchanged flow) or **Telegram Personal**. Purple "Personal" badge. |
| Guard | `app/api/subscription/usage-management/route.ts` | The generic enable/disable toggle refuses `telegram_personal` rows (worker-owned lifecycle). |

The Telegram Bot integration, Facebook, inbox, roles and subscriptions code
paths are unchanged apart from the two integration UI touch points and the
usage-management guard above. The inbox only lists `facebook`/`telegram`
channels, so Personal rows stay invisible there until Phase D.

## Multi-tenant model

- **Self-service:** any active Owner of a workspace can connect *their own*
  Telegram account (the "holder"). Agents cannot start a connection.
- **Isolation per session:** own TDLib directory (`/data/sessions/<uuid>`), own
  random 32-byte database key wrapped with the worker KEK *and bound to the
  session id*, own lease/fencing epoch. Login inputs are sealed with AAD
  `session id + input kind`, so a value replayed into another tenant's session
  is rejected (tested).
- **One owner per Telegram account** across all workspaces (unique index +
  advisory lock; tested with a real concurrent race).
- **Team access** (holder decides): `holder_only` (default), `owners`,
  `all_inbox_members`, `selected_members`. Stored now; enforced on
  conversations in Phase D (`canSeePersonalConversations`).
- **Connection limits:** an active Personal account is one row in
  `social_accounts`, so the existing `getBusinessEntitlements` counts it as
  **1 channel**. Capacity is checked when the sign-in starts *and again
  atomically at activation*; resume re-checks it. Max 3 open sign-ins per
  workspace, 1 per holder.
- **Revocation:** the holder or any workspace Owner can sign the account out
  (Telegram `logOut`, revokes the device). Only the holder can resume or change
  team access. Termination from Telegram → Devices is detected (`revoked`).
  Deleting the workspace makes the worker sign out and wipe local data.

## Lifecycle definitions

| Action | Telegram side | TENH data | Channel slot |
|---|---|---|---|
| Cancel sign-in | `destroy` (or `logOut` if Telegram had already authorized) | session files removed | not used |
| Pause | client closed, session kept on disk | kept | freed |
| Resume (holder) | client reopened from disk | kept | re-checked, used |
| Sign out (holder/owner) | `logOut` → device revoked; files removed | conversation history kept | freed |
| Revoked remotely | detected, files removed | kept | freed |
| Remove imported data | — | **Phase D** (nothing is imported yet) | — |

States shown in the UI: connecting · waiting for login · connected ·
reconnecting · pausing/paused · signing out · expired · cancelled · revoked ·
disconnected · failed (with a specific reason).

## Actual test results (2026-10-05, this container)

| Suite | Command | Result |
|---|---|---|
| Worker unit + lifecycle (fake TDLib) | `cd workers/telegram-personal && npm test` | **23/23 pass** (+1 integration skipped without DB); repeated 5× with no flakes before the last change |
| Worker + real draft SQL | `TGP_TEST_DATABASE_URL=… node --test test/pg-store.integration.test.ts` | **1/1 pass** |
| Draft SQL assertions | `tests/sql/run-telegram-personal-sql.sh` | **pass** — assertions, concurrent duplicate-ownership race, install guard |
| Web helpers + routes | `node --test tests/telegram-personal-web.test.cjs` | **10/10 pass** |
| Worker typecheck | `npm run typecheck` | clean |
| Web typecheck | `npx tsc --noEmit` | clean |
| Lint (changed web files) | `npx eslint …` | 0 errors; 2 `<img>` warnings (same pattern as existing files). Test `.cjs` files hit the same `no-require-imports` rule as every existing test file. |
| Production build | `next build --webpack` (placeholder env values) | **success**; 3 new dynamic routes |
| Existing suite, regressions | 136 test files, base commit vs this branch | **identical failure set** (110 failures pre-exist on the base commit, including some Telegram Bot UI tests); 0 new failures |
| TDLib binary | `prebuilt-tdlib` loaded offline | reports **1.8.67** |

Covered scenarios: session isolation; QR login; QR refresh; delayed QR after
cancel; cancel racing a completed scan (device signed out, not orphaned);
phone + code + 2FA with wrong code/password; login deadline expiry; unsupported
auth step; login step timeout reported as unknown; duplicate account across
workspaces (and same workspace); channel limit at activation; restart with the
same key; clean vs hung shutdown (`clean`/`unclean`); network loss → reconnecting
→ connected; remote revocation; revocation while the worker was down; pause /
resume / sign-out; unconfirmed sign-out stays `disconnect_pending`; lease loss
fences all writes; worker pinning and capacity; directory lock; workspace
deletion; permission matrix; flag off = 404; QR never leaves the server as a
raw link; inputs reach the DB only as ciphertext.

**Not yet covered (Phase D scope):** duplicate/out-of-order message updates,
optimistic send reconciliation and uncertain sends — no messages are ingested
or sent in Phase B. **Not verified:** the UI in a real browser (it needs an
authenticated Supabase session); Postgres LISTEN/NOTIFY wake-ups in isolation
(tests also poll); real Telegram behaviour of any kind.

## Defaults I chose (change any of them before Phase C)

1. Worker architecture approved → isolated always-on worker (host not chosen).
2. TDLib via `tdl` + `prebuilt-tdlib`, pinned to TDLib 1.8.67.
3. Personal account = 1 channel. The existing free-trial reuse protection is
   **not** extended to `telegram_personal` yet (your decision).
4. Only Owners connect; only the holder sees the QR/inputs, resumes, and sets
   team access; any Owner may pause or sign out.
5. Team access default: holder only. History import default: none (Phase D).
6. Sign-in window 5 minutes; QR via server-rendered PNG; `qrcode@1.5.4` added.

## Schema install (2026-10-05)

The owner applied `db/proposals/20261020_telegram_personal_draft.sql` in the
Supabase SQL Editor (first attempt rolled back cleanly after a partial run;
second run succeeded). Verified: `social_accounts_platform_check` includes
`telegram_personal`, 4 `telegram_personal_*` tables, 21 `tgp_*` functions.
Feature flag still off; no worker running; no Telegram session exists.

## Phase C pilot log

- 2026-10-05: worker running on the owner PC (`TELEGRAM_PERSONAL_WORKER_ID=local-pc`),
  web app on localhost with the flag allowlisted to the owner workspace.
  First sign-in attempt stalled only because the worker process had been
  stopped; after restarting it, **QR sign-in with the owner's own account
  succeeded** against real Telegram. Pending checks: Devices entry, restart
  (reconnecting → connected, clean shutdown), pause/resume, sign-out, remote
  termination. No messages ingested or sent (Phase D).

## Live preflight results (2026-10-05, read-only, run by the owner)

- `social_accounts_platform_check` allowed only `facebook`, `telegram`. The
  draft now extends **exactly that definition** to add `telegram_personal`, and
  still refuses to install if it finds any other platform constraint.
- `tenh_enforce_channel_entitlement` and `tenh_guard_trial_channel_reuse`
  triggers run on `social_accounts`. Their bodies are not in the repo; the
  draft catches a refusal from them during activation/resume and returns
  `CHANNEL_LIMIT_REACHED` / `TRIAL_NOT_ALLOWED` / `CHANNEL_ACTIVATION_REFUSED`
  (the worker then signs the new device out).
- `social_accounts` has RLS enabled and **no policies**, so although the table
  is in the Realtime publication, browsers cannot receive its rows.
- `messages` is unique on `(business_id, platform_message_id)` → Phase D keys
  must stay connection-scoped (as designed). `contacts`/`conversations`
  platform checks will need `telegram_personal` in Phase D.
- `platform_account_id` is NOT NULL; 0 workspaces have multiple active Bots.

Rollback of the constraint change is only possible while no
`telegram_personal` rows exist: restore
`check (platform = any (array['facebook','telegram']))`.

## Remaining blockers / your actions before Phase C

1. Trigger bodies checked (2026-10-05): `tenh_check_channel_entitlement` counts
   every active `social_accounts` row (Personal = 1 channel) and its DETAIL codes
   are mapped exactly; `tenh_guard_trial_channel_reuse` skips platforms other than
   facebook/telegram, so Personal accounts have **no trial-reuse protection**
   unless you decide to extend it (expired trials are still blocked by
   `tgp_channel_capacity_error`).
2. Choose a worker host with a persistent encrypted volume (e.g. Fly.io
   Machine + volume, Railway/Render worker with disk, or a VPS). Not provisioned.
3. Register TENH's own app at my.telegram.org yourself; put `api_id`/`api_hash`
   only in the worker secret store. Generate the KEK and seal key pair on the
   worker host with `node src/keygen.ts` (never paste them into chat).
4. Decide whether the pilot uses Telegram's test DC (`TELEGRAM_USE_TEST_DC`).
5. Earlier pilot (`C:\Users\TUF\Documents\Codex\2026-10-04\task-2`) is still not
   inspected — not reachable from this environment; nothing from it is reused.

## Phase C plan (needs your explicit approval at the time)

Apply SQL to a non-production project → deploy one worker with the flag on for
one allowlisted workspace → you sign in with your own account → verify login,
reconnect after worker restart, pause/resume, sign-out and revocation from
Telegram → Devices. **Receive-only.** Any real test send needs a separate
approval then.

## Rollback

Web: unset `TENH_TELEGRAM_PERSONAL_ENABLED` (routes 404, UI hidden). Worker:
stop it (sessions stay valid on disk; nothing else depends on it). Schema: the
new tables/functions are additive; dropping them does not touch existing data,
but sign accounts out first so no device stays authorized.
