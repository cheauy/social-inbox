# Telegram Personal — D1 (shared chats, receive-only)

Status: **installed and piloted (receive) on 2026-10-05.** The owner installed the
D1 SQL and confirmed shared chats and incoming messages appear in the Personal
inbox (read-only, as designed). Remaining owner checks: waiting-chat count,
teammate visibility, stop sharing. Built after the owner
approved D1 on 2026-10-05 (history none by default with optional last 50, a
count for new unshared chats, media as placeholders) and chose **separate
tables** for Personal chats.

## What D1 does

- The account holder opens **Integrations → Telegram → Choose chats to share**.
  The worker lists their recent one-to-one chats with real users (no groups,
  bots, Saved Messages or Telegram service chat). Nothing is shared by default.
- Shared chats receive new messages in real time, including messages the holder
  sends from their phone. Media and other content appear as placeholders
  (“📷 Photo · open Telegram to view”, with caption). Files are not downloaded.
- Optional: import the last 50 messages when sharing (never counted as unread).
- Unshared chats store **no names and no text**: only an account-scoped hash of
  the chat id to show “N new chats waiting”. (Data minimization, not secrecy:
  numeric ids could be guessed by someone with database access.)
- **Personal inbox** at `/dashboard/inbox/personal`: chat list + messages,
  unread counts, live updates (Realtime with a 20 s fallback refresh), mark read
  in TENH only. Telegram read receipts are never sent. Read-only until D2.
- Stop sharing (keep or delete history), and **Remove imported data** (holder
  or any owner, with confirmation).

## Visibility (who sees Personal chats)

Personal chats live in `telegram_personal_chats` / `telegram_personal_messages`,
which none of the existing inbox, customer, search, analytics, reminder or
extension code reads. Every read goes through `tgp_member_can_see`:
holder → always; otherwise the account team-access setting (only me · owners ·
all inbox members · selected members); removed members never. The same rule is
the Realtime row level security policy, so live events reach only allowed users.

## Files

| Area | Files |
|---|---|
| SQL (proposal, run manually) | `db/proposals/20261021_telegram_personal_d1.sql` |
| Worker | `workers/telegram-personal/src/chats.ts`, `session-runner.ts`, `store.ts`, `pg-store.ts`, `supervisor.ts` |
| Web API | `app/api/telegram-personal/connections/[sessionId]/chats/**`, `app/api/telegram-personal/inbox/**`, `remove_data` in `connections/[sessionId]/route.ts` |
| Web helpers | `lib/telegram-personal/inbox-server.ts`, `server.ts` |
| UI | `components/integrations/telegram-personal-chats.tsx`, `components/inbox/telegram-personal-inbox.tsx`, `app/dashboard/inbox/personal/page.tsx` |
| Tests | `tests/sql/telegram-personal-d1.test.sql`, `workers/telegram-personal/test/chats.test.ts`, `pg-store.integration.test.ts`, `tests/telegram-personal-web.test.cjs` |

## Actual test results (2026-10-05, this container)

| Suite | Result |
|---|---|
| D1 SQL assertions (scratch PG 16) incl. RLS as `authenticated` | pass |
| Both SQL files installed statement-by-statement (editor-style split) | pass |
| Worker unit + lifecycle + D1 (fake TDLib), 3 consecutive runs | 35/35 each |
| Worker + real SQL (PgStore) incl. D1 flow, and fallback without D1 SQL | 2/2 |
| Web route/permission tests | 15/15 |
| Web typecheck / lint (changed files) / production build | clean / 0 errors / success |
| Existing suite (136 files) vs base commit | identical failure set (110 pre-existing), 0 new |

Not verified yet: real Telegram chat listing/receiving, the Personal inbox UI in
a browser, Realtime delivery on Supabase.

## Known limitations (D1)

- Edits and deletions in Telegram are not reflected yet; groups are ignored.
- Reconnecting an account creates a new session whose team access starts at
  “Only me” again (safe default); set it again after reconnecting.
- Telegram timestamps are whole seconds: a message stamped in the same second as
  “mark read” may not count as unread.
- Replying from TENH is D2 (needs separate approval, including any real send).

## Install and rollback

Install: paste the whole SQL file into the Supabase SQL Editor with nothing
highlighted and run once (one transaction). The updated worker keeps working
before the SQL is installed (chat features simply stay off).
Rollback: unset `TENH_TELEGRAM_PERSONAL_ENABLED` (routes 404, UI hidden). Data
removal: “Remove imported data” per account. The D1 tables are additive.
