# Message source cards and Business Suite shortcut — 2026-09-13

Apply this incremental ZIP over the previous TENH fixes, keeping the folder
paths. Redeploy/restart the web app, then refresh TENH. No SQL migration or new
dependency is needed. Keep your existing TENH Companion installed and paired.

## Source-card behavior

| Customer action | TENH display |
| --- | --- |
| Opens an ad or post without sending a message | No source card |
| Sends an incoming message containing ad referral context | One “Message from an ad” card beside that message |
| Sends an incoming message containing an explicit post ID in referral context | Same layout labeled “Message from a post”; no Ad ID unless the referral identifies an ad |
| Sends a direct message without referral context | No new source card |

Cards use the Post ID, Ad ID, title and photo actually present in the saved
referral. The parser accepts the existing `ads_context_data.post_id` and an
explicit `referral.post_id`. This is tolerant parsing of supplied metadata, not
a guarantee that Meta emits post attribution for every ordinary post/message
button. A pasted Facebook URL, product code, customer ID or arbitrary `ref`
string does not become an inferred source card.

Only an exact incoming platform-message ID can attach saved context to a
message. An earlier ad open is never assigned to the next direct message just
because its timestamp is nearby. Saved and embedded copies are combined into
one card per message. Historical cards stay with their original messages.
Saved context whose message is outside the loaded history waits until that
message is loaded.

## Caching

Source metadata is already persisted in `facebook_messenger_sources` and in the
original message payload. The rendering code reuses these records, including
when the message-history payload lacks its original referral. Opening or
reopening the chat performs no extra Graph API request for the source card.
Repeated webhook delivery does not rewrite unchanged source metadata.

Photos keep their original stable URL and use normal browser HTTP image caching.
There is no new image proxy, storage upload, or cache-busting query parameter.
This does not guarantee offline images: Meta's cache headers and expiring image
URLs still apply. Missing/expired photos retain the IDs and show the existing
photo-unavailable state. No post photo is replaced with a customer's avatar.

## Open the customer's chat in Business Suite

A new external-link icon in the upper-right Messenger conversation header has
the tooltip **Open in Meta Business Suite**. Click it to use your paired TENH
Companion. The existing server endpoint validates the workspace, conversation,
Page and customer, then resolves Meta's provider-returned conversation link.
The packaged Companion already contains this navigation flow and navigation-ID
caching; this patch exposes it beyond the messaging-policy notice.

If Meta supplies only enough information to open the Page inbox, TENH now says
that the exact customer chat could not be selected. It does not report a generic
Page inbox as a verified customer-chat redirect. The shortcut needs a signed-in
Facebook session with access to that Page.

The requested [Messenger Extensions SDK documentation](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webview/extensions)
could not be fully checked during this change because Meta returned rate-limit
errors. No unverified SDK redirect method was added. This patch uses the existing
browser Companion and conversation-link resolver; it does not rebuild or replace
the Companion package or public-profile lookup.

## Test after deployment

1. Open an ad as a customer without sending: no “Opened an ad” card appears.
2. Send from that ad: one message source card appears when Meta includes referral
   context. A later direct message does not gain another source card.
3. Send from a normal post: the same layout appears when Meta includes the post
   referral. If absent, inspect that message's saved referral before assuming a
   UI fault; the source cannot be reconstructed from the message text alone.
4. Reopen the conversation: saved IDs/photo URL stay available without another
   Graph lookup for the card.
5. Click the header's Business Suite shortcut. Check both a successful exact
   chat selection and the notice when only the Page inbox can be opened.

Local validation: 77 tests pass, including the real MessagePanel and header,
metadata persistence/reuse, Companion action behavior and the previous live
message/presence fixes. Strict checking of 535 TS/TSX files has zero diagnostics.
HTTP/Supabase/Companion outcomes were controlled in tests; live Facebook
navigation and live organic-post webhook delivery still require your deployed
app and signed-in browser. A production build was not available from the partial
root build configuration in the uploaded archive.
