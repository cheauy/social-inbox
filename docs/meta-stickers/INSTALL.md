# TENH Meta Messenger stickers

The corrected implementation and current installation instructions are in
[`../messenger-reactions-stickers/INSTALL.md`](../messenger-reactions-stickers/INSTALL.md).

The catalog uses server-side App credentials, with `/sticker_packs`,
`/sticker_packs/{PACK_ID}/stickers`, and `/sticker_search`. Sending uses the Page
token and `message.sticker_id` through `/{PAGE_ID}/messages`.

The existing receipt-table migration is
`db/migrations/20260912_existing_tenh_upgrade.sql`; apply it only if the
`facebook_sticker_sends` table has not already been created. No additional
receipt-table migration is needed.

See [Meta's Sticker API documentation](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/sticker-api)
for catalog restrictions and the standard messaging window.
