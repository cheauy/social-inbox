# Telegram Personal — Phase A (architecture proposal, not implemented)

Status: **DRAFT proposal only.** No code, schema, dependency, credential,
deployment or Telegram session has been created. Nothing here is a tested
pilot or production-ready. Phase B starts only after the owner approves the
decisions in §11.

---

## 1. Audit of the current system (what exists today)

| Area | Finding | Source |
|---|---|---|
| Connection model | One `social_accounts` row per channel. Telegram Bot = `platform = 'telegram'`, `platform_account_id` = bot user id, token in `telegram_bot_token_encrypted`, state in `telegram_token_status` / `telegram_webhook_status`, `is_active`. | `app/api/telegram/connection/route.ts` |
| Ownership guard | Partial unique index `telegram_verified_bot_unique` (referenced, not in repo) + preflight `loadVerifiedBotClaim`; trial-reuse trigger `tenh_guard_trial_channel_reuse` only knows `facebook`/`telegram`. | connection route, `db/migrations/20260911_trial_channel_reuse_protection.sql` |
| Credential crypto | `encryptChannelCredential` re-uses the Facebook AES-256-GCM key. | `lib/channels/channel-token-crypto.ts` |
| Ingestion | Bot: Telegram → HTTPS webhook (`/api/webhooks/telegram/[connectionId]`) → `processTelegramIncomingText` → upsert `contacts` (`business_id,platform,platform_user_id`) → upsert `conversations` (`social_account_id,contact_id`) → insert `messages`. Stateless, serverless-friendly. | `lib/telegram/process-message.ts` |
| Message identity | Bot key is `telegram:{chat_id}:{message_id}`, dedupe scoped by `business_id` only (not by connection). | process-message.ts L100, L648 |
| Outgoing sends | Synchronous Bot API call inside the request, then insert row; on uncertain outcome returns “do not resend”. | `app/api/telegram/send/route.ts` |
| Optimistic reconciliation | Client matches confirmed rows by `platform_message_id` or `raw_payload.tenh_client_request_id === optimisticId`. | `lib/inbox/optimistic-message-match.ts` |
| Realtime | Supabase Realtime on `messages` / `conversations` filtered by `business_id`; resync on reconnect/focus. `social_accounts` intentionally **not** published (credentials). | `lib/inbox/use-inbox-realtime.ts`, `db/migrations/20260929_inbox_realtime_publication.sql` |
| Tenant isolation | Server routes use `getCurrentMember()` + `memberHasPermission(member,"channels","manage")`, service-role writes always filtered by `business_id`. RLS on inbox tables. | connection route, `lib/auth/*` |
| Entitlements | `getBusinessEntitlements` counts **all** active `social_accounts` rows → any new row type is automatically counted against `channel_limit`. | `lib/subscription/get-business-entitlements.ts` |
| Feature flags | Plain server env flags (`TENH_TELEGRAM_REACTIONS_ENABLED`, `TENH_BOT_EXECUTION_ENABLED`…). | `lib/telegram/reaction-store.ts`, `lib/bot/worker.ts` |
| Hosting | Next.js 16 on Vercel (serverless functions + Vercel Cron). **No long-running process exists today.** | `vercel.json`, `package.json` |
| Base schema | `social_accounts`, `contacts`, `conversations`, `messages` DDL is **not in the repo**; constraints must be verified read-only (proposed preflight SQL). | `db/` |

### Pre-existing issues noticed (not changed; out of Phase A scope)
1. Bot `platform_message_id` is not connection-scoped. Two Bots in one workspace
   talking to the same user can produce the same `telegram:{chat}:{msg}` key
   (Bot message ids are per bot-chat), so the second message is dropped as a
   “duplicate”. Personal must not copy this pattern.
2. Unread counter is read-modify-write (`currentUnread + 1`), so concurrent
   webhooks can lose increments. Personal should use an atomic increment.

### Previous pilot (`C:\Users\TUF\Documents\Codex\2026-10-04\task-2`)
**Not inspected — blocker.** This session runs in a cloud container cloned from
GitHub; that Windows folder is not reachable and nothing from it is in the
repo or git history (searched for TDLib/MTProto/QR/api_id). Per your note it is
treated as unproven: no code, credentials, `api_id`, session file or database
from it will be reused. If you want it reviewed, push it (without secrets/
session files) to a separate branch or folder and I will compare it against
this design before Phase B.

---

## 2. Verified Telegram requirements (official docs)

- **Personal accounts require the MTProto client API, not the Bot API.** TENH
  must register its own application and use its own `api_id`/`api_hash`; the
  sample ids shipped with open-source code are server-limited
  (`API_ID_PUBLISHED_FLOOD`). — [Creating your Telegram Application](https://core.telegram.org/api/obtaining_api_id)
- **Terms of Service** — [API Terms](https://core.telegram.org/api/terms):
  no actions on the user’s behalf without knowledge/consent; must not tamper with
  read status (“ghost mode”), online/last-seen or typing indicators, or prevent
  self-destructing content from disappearing; flooding/spam = permanent ban;
  **accounts logging in via unofficial clients are automatically put under
  observation.** Consequence: this feature carries account-restriction risk for
  the owner and must be presented as such.
- **QR login (MTProto):** `auth.exportLoginToken` returns a token that usually
  expires in ~30 s, encoded as `tg://login?token=<base64url>`; must be
  re-exported on expiry; after the other device accepts, an `updateLoginToken`
  arrives and export is called again (may require DC migration / 2FA). —
  [Login via QR code](https://core.telegram.org/api/qr-login), [auth.exportLoginToken](https://core.telegram.org/method/auth.exportLoginToken)
- **TDLib** (Telegram’s own client library) wraps all of the above:
  `requestQrCodeAuthentication` → `authorizationStateWaitOtherDeviceConfirmation{link}`;
  phone/code via `setAuthenticationPhoneNumber`/`checkAuthenticationCode`;
  2FA via `authorizationStateWaitPassword` → `checkAuthenticationPassword`.
  `setTdlibParameters` accepts a `database_encryption_key`;
  `use_message_database` persists chats/messages across restarts.
  `close()` flushes databases and ends with `authorizationStateClosed`;
  `logOut` revokes the session; `destroy` wipes local data without logout. —
  [Getting started](https://core.telegram.org/tdlib/getting-started),
  [requestQrCodeAuthentication](https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1request_qr_code_authentication.html),
  [authorizationStateWaitPassword](https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1authorization_state_wait_password.html),
  [close](https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1close.html),
  [authorizationStateClosed](https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1authorization_state_closed.html)
- **Sending:** `sendMessage` returns a message with a *temporary* id; later
  `updateMessageSendSucceeded{old_message_id, message}` or
  `updateMessageSendFailed{old_message_id,…}` arrives. Server message ids are
  unique **per chat**, not globally. —
  [updateMessageSendSucceeded](https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1update_message_send_succeeded.html),
  [updateMessageSendFailed](https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1update_message_send_failed.html)
- **Node binding:** `tdl` + `prebuilt-tdlib` (prebuilt Linux x86_64 glibc ≥2.17,
  macOS, Windows), actively maintained (last update 2026‑03). TDLib has **no
  backward-compatible interface between versions**, so the TDLib version must be
  pinned and upgraded deliberately. — [tdl](https://npmjs.com/package/tdl),
  [prebuilt-tdlib](https://npmjs.com/package/prebuilt-tdlib)

Note: `core.telegram.org` is blocked by this container’s egress proxy, so the
above was confirmed through the official pages’ indexed content, not a live
fetch. Items marked “verify in Phase B” below must be confirmed against a test
account offline-first.

---

## 3. Where the persistent client runs — options

A Telegram user session is a long-lived, stateful MTProto connection with a
local database and an update stream. It **cannot** run inside a Vercel
function: functions are short-lived, have no persistent disk, can run
concurrently (two clients on one session), and are killed without a clean
`close()`. Vercel Cron cannot fill the gap — updates would be missed or replayed
and every invocation would be a new “device”.

| | A. Browser/device-local (TDLib WASM in owner’s browser) | B. Isolated backend worker (recommended) |
|---|---|---|
| Reliability | Receives only while owner’s tab is open; agents see nothing when owner is offline; multiple tabs fight over one IndexedDB DB | Always on; agents get messages 24/7; one owned client per session |
| Shared inbox fit | Poor — defeats the purpose of a team inbox | Matches existing webhook → DB → realtime model |
| Privacy | Session never leaves owner’s device (best) | Session lives on TENH infra (must be encrypted, access-controlled) |
| Security | Session in browser storage, exposed to XSS/extensions; can’t meet “no plaintext session in localStorage” robustly | Session on encrypted volume, key held separately (§6) |
| Hosting | No new infra | One always-on small container + persistent volume |
| Cost | ~0 | Low monthly cost for a pilot (single small VM/container + volume; verify current pricing of chosen provider). Memory grows per connected account — measure in Phase B |
| Ops | Bundle size ~MBs of WASM, browser quirks | Native lib pinning, deploy/rolling restarts, monitoring |

**Recommendation: B — one isolated worker service**, separate from the Next.js
app, deployed to an always-on host with a persistent encrypted volume (e.g.
Fly.io Machine + volume, Railway/Render background worker with disk, or a small
VPS). Vercel keeps serving UI/API unchanged. The worker is the **only**
component that holds Telegram sessions.

```
Browser (owner/agent) ──HTTPS──► Next.js API on Vercel (auth, permissions, flags)
        ▲                               │ insert command rows (no secrets in clear)
        │ Supabase Realtime             ▼
        │ (messages/conversations)  Supabase Postgres ◄─── worker writes state/messages
        │                               ▲  │ claims commands (lease + fencing)
        └───────────────────────────────┘  ▼
                         telegram-personal-worker (Node + tdl + pinned TDLib)
                         persistent volume: /data/tdlib/<social_account_id>/ (encrypted DB)
                                       │ MTProto
                                       ▼
                                   Telegram
```

---

## 4. Components

1. **Next.js (existing app, additive only)**
   - New routes under `app/api/telegram-personal/*` (connect, login status,
     submit code/password, cancel, chats list/share, send, disconnect, remove data).
   - All return quickly; long operations are queued commands. Bot routes untouched.
2. **Worker** (new top-level `workers/telegram-personal/`, own `package.json`,
   not bundled into Next.js):
   - Supervisor: claims session leases, starts/stops one TDLib client per
     claimed session, consumes commands, maps TDLib updates to the inbox tables.
   - Health endpoint (no PII) for the host’s liveness check.
3. **Supabase**: new tables (§9) + reuse `social_accounts`, `contacts`,
   `conversations`, `messages`.

### Command/control channel
Web → worker via a `telegram_personal_commands` table (claimed with
`FOR UPDATE SKIP LOCKED` through a service RPC). Worker wakes on Postgres
`LISTEN/NOTIFY` (direct DB connection) with a polling fallback (e.g. every 2 s).
No inbound port on the worker is required.

Login status (QR link, waiting-for-code, etc.) is **not** sent over Realtime:
the QR link is a live login credential. The owner’s browser polls an
authenticated GET route (1–2 s while a login attempt is open) that returns
it only to the user who started the attempt.

---

## 5. Connection UI & lifecycle

Add connection → two separate cards:
- **Telegram Bot** — existing BotFather token flow, unchanged.
- **Telegram Personal** (only rendered when the flag is on for this workspace) —
  “Sign in with your Telegram account”.

Before sign-in, a disclosure screen (must be acknowledged):
- TENH will run a Telegram session on its servers; it appears in Telegram
  → Settings → Devices and can be terminated there at any time.
- Telegram places third-party-client accounts under observation; misuse can
  restrict the account.
- **Nothing is shared with the team until you pick chats.** Only chats you
  share are imported and visible to agents with Inbox access; contacts and
  other chats are never imported.
- Agents can reply as you in shared chats; replies are sent from your account.

Login methods:
- **QR (default)** — QR rendered client-side from the link; auto-refreshes as
  TDLib issues new links; visible countdown; Cancel.
- **Phone + code** (fallback) and **2FA password** when TDLib asks. Entered in a
  TENH form field (never chat), sent over HTTPS, **sealed to the worker’s public
  key in the browser→API path** (API never sees plaintext; see §6), consumed once
  and deleted. Never logged.

States (single enum `telegram_personal_status`):
`connecting → waiting_qr | waiting_code | waiting_password → connected`;
`reconnecting` (network/worker restart), `expired` (login attempt timed out /
cancelled), `revoked` (session terminated from another device or
`AUTH_KEY_UNREGISTERED`), `paused`, `disconnected`, `error`.

Identity shown: account display name, @username (if any), masked phone
(`+855 •• ••• 123`), avatar, and a **“Personal”** badge distinct from **“Bot”**
in Integrations, inbox channel selector, conversation header and list items.

### Three separate destructive actions (each with confirmation)
| Action | Telegram side | TENH data | Slot |
|---|---|---|---|
| **Pause** | `close()` client, session kept on disk | kept | freed (`is_active=false`) |
| **Disconnect (sign out)** | `logOut` → session revoked at Telegram; local TDLib dir wiped | conversation history kept | freed |
| **Remove imported data** | none | delete this connection’s conversations/messages/media + chat shares | — |

“Disconnect” is reported done only after `authorizationStateClosed` following
`logOut`; if the worker can’t reach Telegram, status is
`disconnect_pending` (local access already disabled, retry offered) — never
reported as revoked when it wasn’t confirmed.

---

## 6. Security & threat model

| Threat | Mitigation |
|---|---|
| Session theft from DB/backup | TDLib DB lives only on the worker volume, encrypted by TDLib with a per-account `database_encryption_key`. That key is stored in Postgres **wrapped** by a worker-only KEK (`TELEGRAM_PERSONAL_KEK`, env/secret manager, not shared with Vercel and **not** the Facebook key). DB dump alone or disk alone is insufficient. |
| Vercel/API compromise | API tier has no KEK and no session access; it can only enqueue commands validated against the member’s permissions. Phone/code/2FA are sealed (X25519 sealed box) to the worker public key — API stores ciphertext only. |
| Logs leaking secrets | Central redactor in worker: drops TDLib verbosity to ≤1, never logs QR links, codes, passwords, phone numbers (masked), message text, keys. TDLib log file disabled. |
| Cross-workspace access | Every command carries `business_id`+`social_account_id`; worker re-checks the pair and that the conversation/chat belongs to that connection before acting. RLS on new tables; service-role only for worker. |
| Agents seeing private chats | Only `telegram_personal_chat_shares` rows (owner-created) are ingested; non-shared updates are dropped in memory, never written. |
| Same Telegram account in two workspaces | Partial unique index on `(platform_account_id)` for live personal rows; refused with an explicit error. |
| Two clients on one session (split brain) | DB lease with fencing epoch + `flock` on session dir (§7). |
| Account abuse / spam | Replies only into shared existing chats; no new-chat-by-phone, no contact import, no bulk send; per-account send rate cap; honour FLOOD_WAIT. |
| ToS (ghost mode, online status) | Worker sets `online=false` option; does not alter read state except when an agent explicitly opens/reads (later phase, opt-in); no typing spoofing. |
| QR hijack | QR link only returned to the initiating owner; short-lived; attempt cancelled after N refreshes / 3 min. Connected identity shown for confirmation before activation. |
| Lost volume | Recoverable by re-login only; no plaintext backups. Documented. |

---

## 7. Reliability

- **One owner per session:** `telegram_personal_sessions.lease_owner`,
  `lease_expires_at`, `lease_epoch`. Worker renews every ~10 s (TTL ~30 s).
  Every DB write by the worker includes `lease_epoch` and is rejected by RPC if
  stale (fencing). Plus OS `flock` on the session directory. Rolling deploy:
  new instance waits until old lease expires or is released.
- **Startup:** claim lease → open TDLib with key → expect `authorizationStateReady`
  (else mark `revoked`/`expired`) → TDLib replays missed updates itself (verify
  in Phase B) → ingest idempotently.
- **Shutdown (SIGTERM):** stop claiming commands → `close()` each client →
  wait for `authorizationStateClosed` (bounded, e.g. 20 s) → release lease →
  write `last_shutdown='clean'` **only** if Closed was observed; otherwise
  `'unclean'`. Kill/crash leaves `'unclean'` (detected on next start).
- **Idempotent ingest:** message key
  `tgp:{social_account_id}:{chat_id}:{message_id}` with a unique index; insert
  `on conflict do nothing`; edits/out-of-order updates keyed by the same id and
  ordered by Telegram `date` + id, not arrival time.
- **Atomic unread:** RPC `unread_count = unread_count + 1` only when the insert
  actually happened.
- **Timeouts:** per-operation bounded (send ≈ 30 s to confirmation, login step
  ≈ 15 s, history page ≈ 20 s). A timeout yields `uncertain`, never `failed`.
- **Multiple tabs:** UI state comes from DB rows (existing realtime); commands
  are idempotent by `client_request_id`, so a double click or two tabs cannot
  enqueue two sends.

### Send flow & uncertain outcomes
1. Browser creates optimistic bubble with `clientRequestId` (existing pattern).
2. API validates permission + share, inserts command
   (`unique(social_account_id, client_request_id)`) → 202.
3. Worker claims command (`queued→sending`), calls `sendMessage`, immediately
   records the returned **temporary** id (`sending→accepted_local`).
4. On `updateMessageSendSucceeded{old_message_id}` → insert/upgrade message row
   with final key and `raw_payload.tenh_client_request_id` (so the existing
   `matchesOptimisticMessage` merges it into the optimistic bubble — no
   duplicates) → command `sent`.
5. On `updateMessageSendFailed` → `failed` with redacted reason (user may
   retry manually).
6. Crash/timeout between steps 3 and 4 → `uncertain`. **Never auto-resent by
   TENH.** TDLib itself keeps unsent messages in its DB and finishes them after
   restart (verify in Phase B), and its later success/failure update is matched
   via the stored temporary id. If the temp id was never recorded, UI shows
   “Outcome unknown — check Telegram before retrying”.

---

## 8. Inbox integration (Phase D, behind flag)

- `social_accounts.platform = 'telegram_personal'` — a **new platform value**, so
  none of the ~200 `platform === "telegram"` Bot code paths change behaviour.
- `contacts.platform = 'telegram_personal'` (separate from Bot contacts; merging
  the same human across Bot/Personal is a later, opt-in step).
- `conversations`: one per (connection, shared private chat), existing
  `social_account_id,contact_id` uniqueness.
- `messages`: existing columns; `platform_message_id` = connection-scoped key.
- Realtime/selection/unread/pagination: reuse existing inbox machinery since
  the worker writes the same tables.
- New adapter `lib/telegram-personal/` for UI-side helpers (labels, badges,
  send endpoint selection). The inbox picks send route by platform.
- Initial scope: **private 1:1 text chats only.** Non-text messages are stored as
  a placeholder (“[Photo — open Telegram]”) so agents don’t miss them.
- Chat selection: owner opens “Choose chats to share” → worker returns a live,
  non-persisted list of recent private chats (name, last activity) to the
  owner only → owner shares chosen chats and chooses history import
  (none / last 50 messages, paged via `getChatHistory`). New chats from
  strangers are **not** auto-shared; owner sees a count-only “N new chats
  waiting” nudge (no content stored).

### Later phases (after verifying capabilities)
1. Edits (`updateMessageContent`/`updateMessageEdited`) and deletions
   (`updateDeleteMessages`, only `is_permanent`).
2. Replies (`reply_to` / `inputMessageReplyToMessage`).
3. Media in/out (download via `downloadFile` with size caps; reuse workspace storage).
4. Read state: mark read in Telegram only when an agent opens the chat, opt-in.
5. Groups (explicit share per group; members never imported).

---

## 9. Exact file / schema plan

### Phase B (isolated, offline-testable; nothing wired into inbox)
New only:
- `workers/telegram-personal/package.json` (`tdl`, `prebuilt-tdlib` pinned exact, `pg`, `tweetnacl`)
- `workers/telegram-personal/src/{index,supervisor,lease,commands,session-client,login-machine,redact,crypto,shutdown,config}.ts`
- `workers/telegram-personal/src/tdlib-port.ts` — interface so tests use a fake TDLib
- `workers/telegram-personal/test/*.test.ts` — synthetic lifecycle tests (fake TDLib)
- `workers/telegram-personal/Dockerfile`, `README.md` (deploy/rollback notes; not deployed)
- `lib/telegram-personal/feature-flag.ts`
- `app/api/telegram-personal/connection/route.ts`, `.../login/route.ts`, `.../login/[attemptId]/route.ts`
- `components/integrations/telegram-personal-panel.tsx`
- `db/proposals/20261020_telegram_personal_draft.sql` (draft; you apply manually)

Modified (minimal, guarded by flag):
- `components/integrations/integration-workspace.tsx` — add “Telegram Personal” card when flag on
- `lib/channels/channel-catalog.ts` — add `telegram_personal` entry (hidden when flag off)

### Phase D
- `app/api/telegram-personal/{chats,chats/share,send,disconnect,remove-data}/route.ts`
- `lib/telegram-personal/{message-key,adapter}.ts`
- `components/inbox/{inbox-channel-selector,conversation-header,conversation-list,reply-box}.tsx` — Personal badge + send route
- tests under `tests/telegram-personal-*.test.cjs`

### Proposed SQL
See `db/proposals/20261020_telegram_personal_draft.sql` (draft, not a migration)
and `docs/sql/telegram-personal-preflight-readonly.sql` (read-only checks to run
first). Summary:
- `telegram_personal_sessions` (1:1 with `social_accounts`; wrapped DB key,
  status, identity, lease/fencing, shutdown markers) — service-role only.
- `telegram_personal_login_attempts` (status, sealed inputs, expiry,
  initiated_by) — service-role only; served via API.
- `telegram_personal_commands` (type, client_request_id, payload, status
  incl. `uncertain`, temp id, attempts) — service-role only.
- `telegram_personal_chat_shares` (connection, chat_id, shared_by, revoked_at).
- Partial unique index: one live personal connection per Telegram user id.
- Message-key unique index scoped by `business_id, platform_message_id` (if
  not already present — preflight checks).
- Extend trial-reuse check to `telegram_personal` (needs your decision).
- RPCs: `tgp_claim_lease`, `tgp_renew_lease`, `tgp_claim_command`,
  `tgp_ingest_message` (fenced, atomic unread).

---

## 10. Billing & compatibility
- No code change needed to *count* it: an active `telegram_personal` row is
  already counted by `getBusinessEntitlements` → **proposal: 1 Personal account
  = 1 channel**, same as a Bot or Page. Paused/disconnected = 0.
- Reuse `verifyWorkspaceCanUseTelegram`-style checks (subscription active +
  `CHANNEL_LIMIT_REACHED`).
- Pricing/entitlement changes (e.g. Personal as paid add-on because of worker
  cost) — **not changed**; your decision.
- Flags (default off): `TENH_TELEGRAM_PERSONAL_ENABLED=true` **and**
  `TENH_TELEGRAM_PERSONAL_BUSINESS_IDS=<allowlist>` on Vercel; worker refuses to
  run unless `TELEGRAM_PERSONAL_WORKER_ENABLED=true`.

---

## 11. Decisions needed from you before Phase B
1. **Approve architecture B** (isolated always-on worker + encrypted volume) and
   pick a host (Fly.io / Railway / Render / VPS). I will not provision it.
2. **TDLib via `tdl` + `prebuilt-tdlib`** (official library) vs. a pure-JS MTProto
   library (GramJS). Recommendation: TDLib.
3. **TENH `api_id`/`api_hash`**: you register the app at my.telegram.org yourself
   and put them only in the worker’s secret store. Never paste them into chat.
4. Billing: Personal = 1 channel? Apply free-trial reuse protection to it?
5. Who may connect / share chats: proposal = only an **Owner**, and only the
   owner who signed in can change chat sharing for that account.
6. History import default on share: none vs. last 50 messages.
7. Share the previous pilot (sanitised) for comparison, or proceed without it.

## 12. Test plan (Phase B/C/D)
Session isolation (two fake accounts, two workspaces); login cancellation;
delayed/expired QR responses & refresh; 2FA path; reconnect after network loss;
revoked from another device; worker restart with/without clean close; lease
takeover & fencing (stale epoch writes rejected); duplicate and out-of-order
updates; optimistic reconciliation (one bubble); uncertain send never resent;
permission checks (agent can’t share chats / connect / see unshared chats;
cross-workspace ids rejected); duplicate account ownership; flag off = no UI, no
routes, no worker; full existing Telegram Bot test suite (`tests/telegram-*`)
unchanged and passing.

Phase C (real account, your approval): login + receive only. A real test send
needs a **separate** explicit approval at that time.
