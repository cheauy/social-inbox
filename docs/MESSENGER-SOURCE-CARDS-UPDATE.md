# TENH CHAT — Messenger post and ad source cards

This patch adds a source card to the Facebook chat timeline when Meta supplies referral context. It shows the source photo, title, full Post ID and full Ad ID when available. Clicking the photo opens TENH's image viewer. A supplied Post ID provides a View post link.

Apply this incremental ZIP over the current TENH CHAT project after the preceding sticker-cache update. It contains only changed/new files, with their original folder structure.

Installation:

1. Run `db/migrations/20260913_messenger_referral_sources.sql` in the project's Supabase SQL editor **before deploying the code**. The inbox now selects the new `conversations.facebook_messenger_sources` column.
2. Copy the ZIP's folders into the project root, then deploy/restart the application using your existing deployment configuration.
3. In the Meta app's Page webhook configuration, enable `messages`, `messaging_referrals` and `messaging_postbacks`. Keep the existing delivery, read, reaction and feed subscriptions enabled.
4. Refresh each connected Page's subscription. Reconnecting/selecting the same Facebook Page in TENH runs the existing connection-health subscription check. Alternatively, a signed-in member with channel-management permission can call the existing `POST /api/facebook/subscribe` endpoint with `{}`. The updated subscription list now includes `messaging_referrals`; the configured connection-health job also uses this list.
5. Test with a customer opening a click-to-Messenger ad and sending a message. Check the card against the actual `ad_id` and `ads_context_data` received in the signed webhook. Reload the conversation: the saved context should still appear.

Behavior and limits:

- Handles `message.referral`, standalone `referral`, and `postback.referral`, including Meta's documented field/value envelope. A standalone referral can appear before the first real message.
- Saves up to 20 recent referral contexts per conversation. Referrals already embedded in loaded message history also render, including older ones. Existing stored message referrals work immediately; previously skipped standalone webhook logs are not automatically backfilled.
- Saved context is reused on reopening. There is no extra Graph request to reconstruct the ad and no polling for source photos. The browser loads Meta's supplied image URL normally; missing or expired images show Photo unavailable while keeping the IDs visible.
- A referral alone does not create a message, increment unread counts, update the last-message preview/time, reopen an existing resolved conversation, or extend the Messenger reply window. Existing message receive, reaction, delivery/read and comment processing remain in place.
- Page and customer identity are resolved from the signed webhook's entry/recipient/sender, with workspace and connected-Page checks. Repeated deliveries are deduplicated, and concurrent source writes are merged.
- An ordinary message, organic post CTA, short link, or shop entry may not include a source photo or post/ad ID. TENH displays only the source information Meta supplies. A recipient PSID or arbitrary `ref` is never presented as a Post ID or Ad ID. An ad-only referral may have an Ad ID without a Post ID or post link.
- Meta documents `ads_context_data.video_url` as a video thumbnail; TENH uses it as a photo fallback. No Ads Manager permission or Marketing API lookup is introduced.

Validation completed locally:

- 24 new parser, signed-webhook, persistence, isolation, concurrency, timeline and React card tests passed.
- 77 message, attachment, comment-context, reply-window and history-normalization regression tests passed.
- 73 existing reaction, native-reply and sticker/cache tests passed.
- Strict TypeScript checking passed across 533 TS/TSX files with zero diagnostics.
- Tests use mocked Supabase/Meta boundaries. The migration and a live customer/ad flow still need to be verified in your deployment. No production build is claimed: the supplied archive does not include the deployment's Next/TypeScript configuration.

Meta references:

- [Message referral payload and ad context](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/messages)
- [Standalone Messenger referrals](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/messaging_referrals)
- [Postback referrals](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/messaging_postbacks)
- [Recipient IDs](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages#recipient_ids) identify the message recipient; the source photo and ad/post IDs come from referral webhook context.
