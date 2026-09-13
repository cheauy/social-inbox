# TENH CHAT — Messenger sticker UI and native replies

This cumulative ZIP contains only the 32 files changed from **social-inbox(20260913-050143).zip**. It includes the preceding hover-reaction and sticker catalog fixes, so no separate earlier patch is needed. Copy the included folders into the project root, replace matching files, and redeploy. Keep your existing configuration and database. The sticker UI/native-reply update adds no runtime dependency, environment variable or migration. For the included catalog/reaction setup, follow `docs/messenger-reactions-stickers/INSTALL.md` and `docs/meta-stickers/INSTALL.md`.

## Requested sticker changes

- Subtitle: **Messenger Sticker**.
- Removed the sentence below the sticker grid.
- Composer icon: a smiling sticker with a peeled corner.
- Each pack tab shows one individual sticker instead of Meta's composite pack artwork. Visible tabs request previews in batches of up to eight, with cached covers across picker opens. The browser receives only one sticker per tab. Meta documents no `limit` parameter on this catalog endpoint, so the server retrieves/caches the pack response and selects one preview; opening that pack can reuse the same cached response.
- Confirmed sends enter Recents even when sending has already closed/unmounted the picker. Failed sends do not enter Recents. Recents keeps the last 20 unique stickers, newest first, in browser storage scoped to the workspace; loaded outgoing chat history also fills Recents. No extra message-history query, polling or database table was added. Clearing browser data clears the locally remembered list; opening chat history can restore loaded stickers.

## Meta feature audit

| Requested feature | Result |
| --- | --- |
| [Reply to a specific message](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages#send-a-reply-to-a-message) | Added native replies for text, photos/albums, videos, audio, files and stickers. The server validates the selected local row in the authorized workspace and conversation, then sends top-level `reply_to: { mid }`. Replies can target customer or Page messages. TENH retains the quote and jump target when a bare echo/history response arrives. |
| [Messaging types](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages#messaging_types) | Existing inbox modes retained: `RESPONSE` in the standard window, and `MESSAGE_TAG` / `HUMAN_AGENT` for eligible manual support. Initial private replies keep their separate comment recipient flow. `UPDATE` is the proactive-message mode; the customer-reply composer continues to use `RESPONSE`. No unsupported/deprecated tag fallback was added. |
| [Delivery and read status](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages#delivery_status) | Already present: `message_deliveries` and `message_reads` subscriptions, webhook updates, and Sent / Delivered / Seen indicators. Also fixed a race in attachment sending: a late send response no longer resets a receipt already marked Delivered or Seen by the webhook. |
| [Multiple attachments](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages#sending_multiple_attachments) | Already present: up to 30 photos per native Messenger message, using the `message.attachments` array. Other media types retain their separate single-attachment sends. Photo albums now carry the selected native reply too. |

Quoted replies in this patch follow Meta's documented `RESPONSE` flow within the 24-hour window. For an eligible older manual support conversation, cancel the selected quote to use the existing plain Human Agent reply. Native stickers retain their existing standard-window restriction. Existing historical TENH-only references remain historical local references; they are not retroactively sent to Meta.

Meta's [Send message guide](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages) and [Sticker API guide](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/sticker-api) were checked on September 13, 2026. The preceding patch's App-token catalog fix and Page-token sends remain required. Page permissions and webhook subscriptions must already be configured as in that patch.

## Verification

- Strict TypeScript validation: zero diagnostics in 529 source files using the supplied project dependencies and a temporary Next-compatible configuration. The uploaded archive has no root build configuration/lockfile, so this is not a production Next build result.
- 35 behavioral API tests: text/media/sticker native payloads, authorization and target checks, standard-window enforcement, token retry, no silent quote removal, echo/read races, sticker duplicate receipts, quote merging, and one-preview responses/cache reuse.
- 2 React/jsdom behavior tests: lazy tab previews, success after unmount, reopening Recents, failed sends, workspace isolation, history deduplication and persistence.
- 36 prior reaction/sticker checks, 73 sending/window/media/normalization regression checks, and 5 existing native-reply rendering/enrichment checks passed.
- Live sends to a customer were not performed. After deployment, verify a text reply, a photo reply and a sticker reply in a test Messenger conversation, then reopen the sticker picker and check Recents.

Run the API/regression checks from the project root with the existing development dependencies installed:

```sh
node --test tests/messenger-replies/api.test.cjs tests/messenger-reactions/api.test.cjs tests/meta-stickers/meta-sticker-patch.test.cjs
node --test lib/facebook/media-message.test.mjs lib/facebook/private-reply.test.mjs lib/facebook/send-attachment.test.mjs lib/facebook/messenger-window.test.mjs lib/inbox/normalize-messages.test.mjs
```

The optional UI tests require `jsdom@26` in the development test environment:

```sh
node --test tests/messenger-replies/sticker-ui.test.cjs
```
