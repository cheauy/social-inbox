# Inbox album / single image fix — local follow-up

The active checkout is the user's deployed commit b27e557ad17cb2ae14deaa85f3890e43a3142cdf plus local follow-up changes. This executor has not pushed/deployed these fixes, applied SQL, changed grants, written to production or sent customer messages. Later Bot drafts remain deferred. Existing Inbox/UI/paging/Bot safety changes are retained.

## Confirmed causes and behavior

1. MessagePanel previously grouped adjacent same-direction images within 60 seconds. That made distinct nearby singles look like albums and ignored Telegram's explicit identity. `lib/inbox/photo-groups.ts` replaces the heuristic. It uses an individual Facebook message's attachment array, Telegram media_group_id, or an explicit outgoing TENH Telegram upload batch. Business/channel/thread/sender/recipient/direction/staff boundaries are retained. Missing optimistic scope can be filled only from an exact batch whose observed owners agree. No time bucket, timer, polling, new read query or inferred album is added.
2. Telegram ingestion already preserves the original update, including message.media_group_id. Outgoing responses preserve the flat provider message. The TelegramMessage type now declares that field. The multi-upload optimistic flow and send-photo route additionally share a validated UUID batch identity, allowing pending and stored items to belong to the same submitted group. A single upload gets no batch marker. Photo-size variants inside one Telegram photo are not separate album items. [Telegram Message documentation](https://core.telegram.org/bots/api#message) defines media_group_id within its chat.
3. Facebook send reconciliation overwrote stored attachment arrays with local blob previews. That branch is removed; server URLs/metadata remain authoritative. Normalization retains album identity, attachment arrays and local storage-slot metadata when a bare echo/history projection omits them. Explicit new arrays are respected. Native image selections still use parent-message ID plus photo index, preserving each image's reply/copy/viewer target.
4. Facebook multi-upload previously persisted only the first file, relying on a best-effort follow-up Graph attachment lookup for the others. It now stores each explicitly submitted image under the existing private bucket: photo for item zero, photo-N for later items. The first successful stored copy is reused. A compare-and-swap metadata update records count/saved indices and ordered attachment URLs without overwriting receipts, pins or concurrent metadata. Failed local storage never causes another provider send. Existing-message lookup is narrowed to the authenticated business and conversation.
5. The authorized media route validates the selected recorded slot and tenant, and rejects absent/deleted selections. The image proxy signs the selected slot; Graph recovery filters image attachments and retains the requested index rather than replacing every failed album item with item zero. Shared InboxPhotoImage retries a failed source once through the authorized image endpoint, then displays an accessible Photo unavailable fallback. Album frame, single image and viewer retain their original individual-photo references.

Partial albums show the currently available image independently, then form a grid as more identified items load. Group members sort chronologically with numeric Telegram message-ID ties; the existing last-row anchor stays in place. Duplicate provider rows contribute one photo. Deleted items leave grids. Substantive captions from all members are retained without repeated placeholders/duplicate caption text. Per-photo originals and reply metadata remain on each member.

## Exact runtime files

- lib/inbox/photo-groups.ts (new), lib/inbox/normalize-messages.ts
- components/inbox/photo-album-frame.tsx and inbox-photo-image.tsx (new)
- components/inbox/message-panel.tsx and inbox-view.tsx
- lib/telegram/types.ts
- app/api/telegram/send-photo/route.ts
- app/api/facebook/send-attachment/route.ts
- app/api/messages/[messageId]/media/route.ts
- app/api/inbox/message-image/route.ts

Tests: tests/inbox-albums.test.cjs (new), extended tests/fixtures/inbox-paging-browser.entry.cjs. The existing browser builder/harness fixes remain local from the prior stage.

## Validation and limits

222 focused tests passed, including 15 album cases and existing image/reply/media/realtime/paging/Bot/retirement regressions. Tests exercise incoming/outgoing singles, true albums, sender/scope separation, partial/out-of-order arrival, duplicate/bare echoes, deletion, captions, per-photo selection, private stored slots, Graph unavailability during multi-upload and mixed-video recovery without substituting photo zero. The isolated Chrome fixture passed 31 assertions, including real shared grouping/album-frame/image components, original second-photo viewer selection, partial-to-grid changes, ordered arrival and accessible broken-image fallback. It is a small synthetic React shell; the full authenticated MessagePanel/provider integration is not mounted there.

The final targeted lint comparison found no introduced findings in eight existing files; all three new runtime modules are clean. TypeScript passed after the first completed build. An earlier concurrent type check hit Next's transient missing generated routes.js while the build regenerated .next/types; the sequential check passed. Production build passed; no remote release followed. Evidence is under Temp: tenh-album-final-tests.txt, tenh-album-browser-result.json, tenh-album-typecheck.txt, tenh-album-lint-comparison.json and tenh-album-final-build.txt.

No real customer messages, real provider album upload, live private-storage writes or production CDN-expiry test was performed. Messenger metadata delivered as separate messages without a shared authoritative batch identity remains separate; this code cannot prove it is an album and never guesses from timing. Meta's official webhook documentation could not be fetched during verification, so no universal claim about all Messenger client representations is made. Older rows missing album identity or unsaved image bytes cannot be safely reconstructed from timestamps. A failed storage slot remains unavailable unless its exact provider URL can be recovered. Mixed Telegram videos retain their existing individual video renderer; this change groups image items only. Partial item availability across history boundaries is limited to the currently loaded history and expands when older rows load.

No schema migration is needed: the additional identities/slot metadata use existing raw_payload JSON and the existing private media bucket. Stored history/media is not purged.
