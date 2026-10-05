# Telegram Personal: one TENH Inbox + replies (D2)

**Status: DRAFT, tested in this container only. Not installed, not piloted, not production ready.**
Built after the owner's decisions on 2026-10-05:

- "approve D2, 2=b, 3=yes": only the account holder may reply; 1 message per second and 20 per minute.
- One TENH Inbox: Personal chats sit with Facebook and Bot chats, under their subscription.
- "Move into the same tables as Facebook/Bot".

A real test send needs your **separate, explicit approval**. It is not covered by approving this phase.

## What changes

| Area | Before (D1) | Now |
|---|---|---|
| Where chats appear | Separate page `/dashboard/inbox/personal` | Main TENH Inbox; the old page redirects there |
| Channel selector | Facebook + Bot | Also each Telegram Personal account you may see, under its subscription, with a person badge |
| Storage | `telegram_personal_messages` | `contacts` / `conversations` / `messages` (pilot messages are moved, then the old table is dropped) |
| Replies | Read only | Text replies by the **holder only**; others see "Read only". Sending is behind a second switch (below) |
| History on share | Catch-up could import up to 20 older messages even with "none" (bug) | Fixed: nothing older than the share unless you choose "last 50" |

## Who sees a Personal chat

The visibility rule is unchanged: the holder always sees the chat; otherwise the account's team-access setting decides; removed members never see it. It is now enforced in every place inbox data is read:

- **Inbox list and counts:** `tenh_inbox_page` (patched in SQL).
- **Browsers and Realtime:** restrictive row level security on conversations, messages, activity, reminders and customer files.
- **Web app server reads:** `lib/telegram-personal/visibility.ts`. This covers:
  - Inbox, customers, search, analytics, reminders and notifications
  - workload, history, media and the extension badge
- **Regression guard:** `tests/telegram-personal-visibility-guard.test.cjs` fails if new server code reads inbox tables without this filter or a documented reason.
- **Feature flag off:** Personal chats are hidden from every server read.

## Sending safety

- **Holder only.** Enforced in SQL by `tgp_enqueue_send`. Replies go only into shared chats, and are rate limited.
- **One send per request id.** Each send carries a request id. A repeated request is not queued again.
- **No resends.** The worker marks a send `sending` *before* calling Telegram, and a `sending` command is never picked up again.
- **Outcomes:**
  - Telegram confirms: **sent**. The message appears in the thread, linked to the request.
  - Telegram refuses: **failed**. Nothing was sent.
  - Timeout or no answer within 2 minutes: **uncertain**. It is shown to the holder with "check Telegram before sending again". It is **never retried automatically**. A later confirmation from Telegram still resolves it.
- **Logs.** Message text is never logged.

## Switches (web app environment)

| Variable | Effect |
|---|---|
| `TENH_TELEGRAM_PERSONAL_ENABLED=true` + `TENH_TELEGRAM_PERSONAL_BUSINESS_IDS` | Existing. Feature visible for these workspaces |
| `TENH_TELEGRAM_PERSONAL_SEND_ENABLED=true` | **New, off by default.** Allows holder replies. Leave unset for the receive pilot |

## Install (you run these; order matters)

1. **Stop the worker** (Ctrl+C in its terminal).
2. **Supabase SQL Editor** (check the project name first): open a new query.
   - Paste the whole of `db/proposals/20261022_telegram_personal_unified_inbox.sql`.
   - Highlight nothing, then click Run once.
   - It runs as one transaction and refuses, changing nothing, if the live inbox function, platform rules or unique keys differ from what was reviewed.
3. **Check:** run `docs/sql/telegram-personal-unified-verify-readonly.sql` and send me the JSON.
   - Expected: both platform checks `true`, `inbox_page_patched` `true`, `d2_functions` 8, `restrictive_policies` 5.
   - Also expected: both `old_*_removed` `true`, `browser_can_execute_send` `false`.
4. **Update and start the worker:** pull this branch, then `npm start` in `workers/telegram-personal` as before. It catches up messages that arrived while it was stopped.
5. **Deploy the web app.** Do not set `TENH_TELEGRAM_PERSONAL_SEND_ENABLED` yet.

The updated worker also runs against the old database (it falls back to the D1 functions). The updated web app expects the new SQL, so do steps 2 to 5 together.

## Pilot checklist (receive; no sending)

- [ ] The channel selector shows your Telegram Personal account under the right subscription, with the person badge.
- [ ] Shared chats (including the D1 pilot chat) appear in the main Inbox with the Telegram icon; the header says "· Telegram Personal".
- [ ] A new incoming Telegram message appears live and counts as unread; marking read works.
- [ ] A teammate with "Only me" access sees neither the channel nor the chats (Inbox, Customers, search, analytics).
- [ ] Sharing a new chat with history "none" imports no older messages.
- [ ] The composer says "Read only for now…" (sending switch off).
- [ ] `/dashboard/inbox/personal` redirects to the Inbox.

**Then, only after you approve a real test send:** set `TENH_TELEGRAM_PERSONAL_SEND_ENABLED=true` and send **one** text to a chat you own (for example a second account of yours). Check it appears once in Telegram and once in TENH.

## Rollback

- **Unset `TENH_TELEGRAM_PERSONAL_SEND_ENABLED`:** sending stops; receiving continues.
- **Unset `TENH_TELEGRAM_PERSONAL_ENABLED`:** Personal chats are hidden from every server read and the routes return 404.
- **Pause the account:** its chats leave the Inbox list.
- **The SQL is not rolled back automatically.** Its only destructive step drops `telegram_personal_messages`, after copying every row into `messages`.

## Actual test results (2026-10-05, this container)

| Suite | Result |
|---|---|
| SQL on scratch Postgres 16, using copies of the live inbox functions | all pass |
| ↳ draft / D1 / unified assertions (unified installed twice) | pass |
| ↳ refuses an unreviewed inbox function | pass |
| ↳ refuses when unique keys are missing | pass |
| ↳ editor-style split installs of all 3 files | pass |
| Read-only verification query on scratch DB | expected values |
| Worker unit, lifecycle, chats and 7 new send tests (fake TDLib), 3 consecutive runs | 42/42 each |
| Worker + real SQL (PgStore), full stack: receive, holder-only send, duplicate request, uncertain sweep | 3/3 |
| Web: Personal routes and send route (17) + visibility guard and helpers (10) | 27/27 |
| Web typecheck / lint of changed files / production build (placeholder env) | clean / no new errors (pre-existing errors in `message-panel.tsx`, `conversation-list.tsx`, `inbox-channel-selector.tsx` unchanged) / success |
| Existing suite, 1,345 tests, vs base | identical 110 pre-existing failures, 0 new |

Not verified yet:
- Anything on your Supabase or a real Telegram account.
- The Inbox UI in a browser.
- Realtime delivery under the new policies.
- A real send.

## Known limitations

- **Text only.** No attachments, stickers, reply-to or edits from TENH.
- **Media is a placeholder.** It shows as a text placeholder ("📷 Photo (open Telegram to view)").
- **Edits and deletions** made in Telegram are not reflected. Groups are ignored.
- **Read receipts.** Telegram read receipts are never sent. Marking read in TENH does not mark read in Telegram.
- **Reconnecting** starts team access at "Only me" again.
- **Rate limits are per account** (1/s, 20/min). A rejected send says so and nothing is sent.

## Automatic sharing (owner decision 2026-10-05: all 1-to-1 chats, new messages only)

SQL: `db/proposals/20261023_telegram_personal_auto_share.sql` (install after 20261022; one script, nothing highlighted).

- Switch in **Integrations → Telegram → Share all my one-to-one chats automatically**. Holder only, off by default, and off again after reconnecting.
- When on, a chat with a real person appears in TENH when a new message arrives in it, in either direction. Nothing older is copied.
- Groups, channels, bots, Saved Messages and the Telegram service account stay out.
- A chat you stop sharing stays stopped. If you delete its history, a nameless marker keeps it out.
- **Remove imported data** also switches automatic sharing off.
- Teammates still see these chats only if Team access allows.
- Limitation: if a brand-new person messages you while the worker is stopped, that chat appears with their next message after the worker is running.

Tests: SQL assertions (installed twice, editor-split install), 4 worker tests (fake TDLib), the real-SQL integration test (bot ignored, new person shared), and a web route test.
