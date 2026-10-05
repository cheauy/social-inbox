# Telegram Personal: media, profile photos, edits, deletions, replies, sending files

**Status: draft, tested in this container only** (scratch Postgres with the real SQL, simulated Telegram, simulated storage).
Not installed, not piloted. Sending stays off until `TENH_TELEGRAM_PERSONAL_SEND_ENABLED=true` (owner decision).

## What it does

| Feature | Behaviour |
|---|---|
| Real media | Photo, video, GIF, video message, voice, audio, document and static sticker are copied from Telegram into the private bucket `tenh-message-media` and shown in the thread like Bot media. Files over `TELEGRAM_PERSONAL_MEDIA_MAX_MB` (default 20) or any storage error leave the text placeholder; the message is never lost. Animated stickers stay placeholders. |
| Profile photos | The contact gets the person's Telegram photo (private bucket `tenh-contact-avatars`), refreshed when it changes. |
| Edits | Edits made in Telegram (either side) update the text; an older edit never overwrites a newer one. |
| Deletions | "Delete for everyone" in Telegram shows "Message deleted" and removes the text and file link. Messages TDLib merely drops from its cache are ignored. |
| Replies (in) | A reply shows which message it quotes. |
| Replies (out) | Holder clicks Reply on a message, then sends: Telegram shows it as a reply. |
| Sending files | Holder attaches one photo or file (up to 4 MB, Vercel limit) with an optional caption. The file is staged privately under `<business>/tgp-outbox/<request id>/`, the worker fetches it **before** anything is sent (fetch failure = nothing sent), sends once, then removes the staged copy. Same at-most-once rules as text. |

Visibility is unchanged: files are served only through TENH routes that check who may see the chat.

## Settings

Worker `.env` (optional; without them media stays placeholders):

```
TELEGRAM_PERSONAL_STORAGE_URL=<same as NEXT_PUBLIC_SUPABASE_URL>
TELEGRAM_PERSONAL_STORAGE_KEY=<the Supabase service role / secret key>
TELEGRAM_PERSONAL_MEDIA_MAX_MB=20
```

Starting is simpler now: `npm start` in `workers/telegram-personal` reads `.env` itself, and `npm run dev:all` in the project folder starts TENH and the worker together (Ctrl+C stops both).

## Install

SQL Editor, one script each, nothing highlighted, in order (skip any already installed):
`20261023_telegram_personal_auto_share.sql`, then `20261024_telegram_personal_media.sql`.
The updated worker and web app keep working before the SQL is installed (features stay off; plain text sends still work).

## Actual test results (2026-10-05, this container)

| Suite | Result |
|---|---|
| SQL: all five files, assertions incl. media/reply/edit/delete/avatar/send-media, installed twice, editor-split install | pass |
| Worker (simulated Telegram + storage), 3 runs | 55/55 each |
| Worker + real SQL, full flow incl. photo, avatar, reply, edit, delete, document send with quote | 3/3 |
| Web route/visibility tests incl. file staging, quote, fallback | 32/32 |
| Full existing suite (1,351) vs base | same 110 pre-existing failures, 0 new |
| Typecheck / lint (changed files) / production build | clean / no new errors / success |

Not verified: real Telegram files, real Supabase Storage upload, the UI in a browser.
