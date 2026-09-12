# TENH sticker picker — bottom pack strip UI

## Install

This is a two-production-file presentation patch on top of `TENH-sticker-store-reply-safety-changed-files.zip` (the 19-file follow-up after the seven-updates patch). It is not a complete project.

Merge into your existing repository root:

- Replace `components/inbox/tenh-sticker-picker.tsx`.
- Add `lib/inbox/sticker-picker-ui.ts`.

Keep the existing `lib/telegram/sticker-catalog.ts`, sticker routes, six PNG assets, composer and send/reply-safety code. No extension file, webhook, sending route, database migration, package dependency, lockfile or environment variable is changed. Your current extension version is not changed.

## Implemented presentation

- White panel with rounded corners and a scrollable four-column sticker grid.
- Fixed bottom strip with Recent choices, pack/category icons and horizontal navigation.
- The existing six Telegram pack menus are preserved; their thumbnails replace the fallback icon after that pack has loaded.
- Search filters the current pack. It is not a global marketplace search.
- The Telegram + button reveals the existing load-pack-by-name/link feature.
- Recent choices are in memory for the selected conversation session only. These record selection, not confirmed delivery; they clear on conversation/platform change and are not persisted to browser storage.
- Loaded Telegram sets are cached in memory for up to five minutes in the current conversation. Switching conversations clears the cache, covers and recent choices; there is no shared bot/file-ID cache.
- Same native Telegram selection callback and same TENH PNG attachment callback. The agent still presses Send. No direct sends are added to the picker.
- Outside click/Escape close; arrow/Home/End keys navigate pack tabs; the panel is positioned inside the current visual viewport using a portal to avoid composer overflow clipping.
- Fetches are aborted on closing, disabling or changing conversations. Late responses are ignored. Preview addresses are rebuilt as authenticated same-origin preview URLs, not accepted as arbitrary hosts or bot-token URLs.

## What this patch does NOT add

It does not fetch Facebook's native Sticker Store or create six new Facebook sticker packs. Facebook currently uses the same six existing TENH PNG images. The image categories in the bottom strip are those existing images, not native Facebook packs. The UI identifies them as a TENH image library.

Telegram still loads actual named packs using your existing connected-bot backend, which uses getStickerSet/getFile/sendSticker. That Bot API interface is different from fetching every pack installed in somebody's Telegram app.

Meta's public Messenger API collection documents image/GIF attachments. I did not find a documented public Messenger Sticker Store catalog endpoint or an App Review permission granting that catalog. Original or appropriately licensed artwork can be offered in TENH's own library and sent with the documented image-attachment method; that does not make it a native Messenger store sticker. A third-party sticker provider is another possible catalog source, subject to confirming the license covers delivery through external Messenger accounts.

Official references checked 2026-09-12:

```text
https://core.telegram.org/bots/api#getstickerset
https://core.telegram.org/bots/api#getfile
https://core.telegram.org/bots/api#sendsticker
https://www.postman.com/meta/messenger-platform-api/folder/7cc3gd2/send-api
https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api
https://docs.stipop.io/en/chat/api-endpoints/sticker-store/new-sticker-packs
```

## Verification

34 Node checks passed. These are helper behavior tests plus static source assertions: response validation, same-conversation preview construction, recent-choice deduplication/caps, searches, bounds with mobile keyboards/offscreen triggers, unchanged send callback interface, and cancellation-code presence. They are not end-to-end React tests.

Changed TypeScript/TSX passed TypeScript transpilation syntax checks.

Three static JSX snapshots (desktop Facebook, mobile Facebook, Telegram with fixture content) were rendered in Chromium using compiled Tailwind 4.1.10 CSS. Bounds, fixed footer placement and tab presence were checked and screenshots visually inspected. Those fixtures use mocked hooks/icons/data; they do not verify interactive React behavior or live sticker delivery.

Not run: a full Next.js production build, full semantic project type-check, installed-extension test, authenticated Supabase/Telegram/Meta integration or live pack availability. Required app dependencies are not installed in this environment. No production-ready or live-delivery claim is made.

In your repository, run:

```sh
node --test tests/sticker-picker-ui.test.cjs
npm run build
```

Then check a preview deployment: open on Facebook/Telegram, switch the bottom packs, choose a sticker, press Send, test recent choices, cancel a slow request by switching conversations, and verify the existing deleted-reply safety still works.
