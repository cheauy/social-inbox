# TENH Messenger reactions and sticker fix — 13 September 2026

Built against `social-inbox(20260913-050143).zip`. This ZIP contains only changed/new files with their original folders. It is a patch, not a complete project.

## Install

1. Back up or commit your current project. Extract this patch into the project root and replace the matching files.
2. Confirm the existing server-side Vercel variables `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` are set for the deployment. The sticker catalog now uses these to authenticate as the app. An existing `FACEBOOK_APP_ACCESS_TOKEN` can be used instead. Do not put secrets in any `NEXT_PUBLIC_` variable.
3. Run your usual build and deploy to `app.tenhchat.com`, then refresh TENH.
4. Enable the Page webhook field `message_reactions` in your Meta app's webhook configuration. In TENH, run **Repair Facebook webhooks** for connected Pages. The existing subscription checker now includes this field. This enables customer reactions to arrive in TENH; it is separate from sending a reaction.
5. Test with your own Facebook test customer: react to text, a photo, a photo inside an album, a video, a voice message, and a file; change the emoji; remove it; react from Messenger and check a second TENH team session.
6. Open Stickers, browse packs, search `love`, and send a sticker to a test customer who messaged the Page within the last 24 hours.

No new SQL is required for reactions. Native sticker sends reuse the existing `facebook_sticker_sends` table. If it was never created, apply the existing `db/migrations/20260912_existing_tenh_upgrade.sql` from your full project once. The old sticker instructions named a migration that was absent from this upload; this is the correct existing migration.

## What changed

- Hover a Messenger message to reveal the smile/plus action; click it to choose 👍 ❤️ 😂 😮 😢 😡 🎉. On touch screens, tap the visible action.
- Choose a different emoji to replace the Page reaction. Choose the selected emoji or click the Page reaction badge to remove it.
- Individual photos in a grouped album have their own control. Photos sharing a single native Messenger message use that message's ID, as required by Meta.
- Reactions appear immediately and revert if Meta rejects them. A confirmed Meta action followed by a TENH database failure shows a synchronization warning rather than claiming the action failed.
- Customer reaction webhooks update the existing message metadata. No new polling loop, realtime connection, notification sound, or unread message is created.
- Reaction updates preserve existing pin, delivery, read, and reply metadata; delayed history responses cannot restore an older reaction.
- All reaction requests verify membership, subscription access, conversation-management permission, Page, customer, message ownership, and customer block state on the server.
- Sticker catalog requests now use an App Access Token and the documented root endpoints. The former Page-prefixed catalog requests caused the `Unknown path components: /sticker_packs` error.
- Native `sticker` webhook attachments and transitional image/sticker payloads render as stickers. Overlapping searches and conversation switches discard stale results.
- Native sticker sends continue to use a Page Access Token and duplicate-send receipts, and now enforce the Sticker API's documented standard 24-hour messaging window. Ordinary text/media messaging policy is unchanged.

This patch adds no Chrome extension or native Android project changes. It updates the web Inbox, including its touch controls, and the shared backend.

## Meta documentation verified

- [Sender actions and emoji reactions](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/sender-actions)
- [Sticker catalog and sending](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/sticker-api)
- [Reaction webhook](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-reactions)

Catalog endpoints: `GET /sticker_packs`, `GET /sticker_packs/{PACK_ID}/stickers`, and `GET /sticker_search?q=...`, under the configured Graph API version. The existing default is v26.0. Meta provides public, free, first-party sticker packs. Personal avatar stickers, custom stickers, paid packs, and GIFs are excluded from this catalog.

Reaction endpoint: `POST /{PAGE_ID}/messages`, with the customer's Page-scoped ID, `sender_action: react`, and `payload: {message_id, reaction: emoji}`. Removal uses `sender_action: unreact` and omits `payload.reaction`.

## Validation

- Full-project strict TypeScript check: 526 TS/TSX files, zero diagnostics, using a temporary Next-compatible configuration because the upload has no root tsconfig.
- 28 behavioral API tests and 8 sticker contract checks passed.
- 42 existing message-normalization, attachment-echo, and Messenger-window regression tests passed.
- React DOM checks passed for optimistic reactions, removal rollback, Escape/focus, conversation-switch isolation, Telegram action preservation, and overlapping sticker searches.
- The patch archive was compared byte-for-byte against the supplied archive and checked for unrelated replacements and secrets.

Tests used mocked Meta responses and database records. No live customer reaction or sticker was sent, no production data was changed, and no deployment was performed. Run your normal `npm run build` and a live test after installation; a full Next.js production build was not run here.
