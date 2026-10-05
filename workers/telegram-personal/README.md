# TENH Telegram Personal worker

Status: **Phase B draft.** Tested offline only (fake TDLib, scratch Postgres).
Never connected to Telegram, never deployed, no credentials created.

One always-on Node service that owns every Telegram Personal session for all
TENH workspaces. Each session has its own TDLib database directory, its own
encryption key and its own database lease. The Next.js app never holds a
Telegram session; it only queues requests through the `tgp_*` SQL functions.

## Run tests

```bash
cd workers/telegram-personal
npm ci
npm run typecheck
npm test                                    # unit + lifecycle (fake TDLib)
TGP_TEST_DATABASE_URL=postgresql://postgres@localhost:55432/postgres \
  node --test test/pg-store.integration.test.ts   # SCRATCH Postgres only
```

## Configuration (worker secret store only — never in chat, git or Vercel)

| Variable | Purpose |
|---|---|
| `TELEGRAM_PERSONAL_WORKER_ENABLED` | Must be `true`, otherwise the process exits immediately. |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | TENH's own application from my.telegram.org (registered by the owner). |
| `TELEGRAM_PERSONAL_KEK` | 32-byte base64 key that wraps each session's TDLib database key. `node src/keygen.ts --kek` |
| `TELEGRAM_PERSONAL_SEAL_PRIVATE_KEY_FILE` | X25519 private key (PEM, 0600) that opens login inputs. `node src/keygen.ts /secure/seal.pem` prints the matching public key for Vercel. |
| `TELEGRAM_PERSONAL_DATABASE_URL` | Direct Postgres connection (needs LISTEN). Recommended: a dedicated role with EXECUTE on the worker `tgp_*` functions and SELECT on `telegram_personal_sessions` only. |
| `TELEGRAM_PERSONAL_DATA_DIR` | Persistent encrypted volume (`/data` in the image). |
| `TELEGRAM_PERSONAL_WORKER_ID` | Stable per host. Sessions are pinned to the worker that holds their files. |
| `TELEGRAM_PERSONAL_MAX_SESSIONS` | Capacity cap per worker (default 25). Measure memory per session in Phase C. |
| `TELEGRAM_USE_TEST_DC` | `true` to use Telegram's test servers during the pilot. |
| `PORT` | Optional `/healthz` (no PII). |

Losing the KEK or the volume means every connected owner must sign in again;
there is intentionally no plaintext backup.

## Lifecycle guarantees (covered by tests)

- QR login (default), phone + code, and 2FA password. Email/registration/premium
  steps fail closed (`UNSUPPORTED_AUTH_STEP`).
- QR links are stored only while the login is open; late QR updates after a
  cancel/expiry are rejected by the database.
- A device Telegram authorized but TENH refused (duplicate owner, channel limit,
  cancelled) is signed out with `logOut`, not left as an orphan.
- Remote termination (Telegram → Settings → Devices) ⇒ `revoked`, channel slot
  freed, local data removed. An idle session confirms its authorization every
  `TELEGRAM_PERSONAL_AUTH_PROBE_MS` (default 60 s) so termination is noticed
  even when Telegram sends no update; network errors never count as revoked.
- Pause keeps data; Disconnect signs out at Telegram, then removes data. An
  unconfirmed sign-out stays `disconnect_pending` (`LOGOUT_UNCONFIRMED`) and is
  retried; it is never reported as done.
- SIGTERM: stop claiming, `close()` every client, record `clean` only when TDLib
  confirmed `authorizationStateClosed`, otherwise `unclean`.
- Lost lease ⇒ the client is closed immediately and every later write is fenced.
- Login step timeouts are reported as `LOGIN_STEP_TIMEOUT` (outcome unknown).
- The worker sets TDLib `online=false`; it never fakes read, typing or online state.

## Deployment notes (for Phase C — not done)

Single instance, persistent volume, stop grace ≥ 30 s, no autoscaling (sessions
are pinned to a worker id). Pin TDLib: the adapter refuses to start unless TDLib
`1.8.67` is loaded. Rollback = stop the worker (sessions stay valid on disk) and
turn off `TENH_TELEGRAM_PERSONAL_ENABLED` in the web app.
