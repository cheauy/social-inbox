# TENH existing website + Companion upgrade (1.2.22)

## Correct baseline and scope

Built directly on `social-inbox(20260912-112456).zip`. This is a changed-files patch for your existing Next.js/Supabase project and its existing `tenh-extension/` folder. **There is no Express server, separate dashboard, separate login, SQLite database or replacement webhook.** Do not apply the previous Express dashboard package to obtain these features.

No original project file is deleted. Root `package.json`, environment files, lockfiles, existing Facebook Page token helpers, native Telegram APIs, group chat, billing and the existing Messenger webhook remain untouched. The full production build was not verified; run it in your normal environment before deploying.

## Installation order

1. Commit/back up your current code and review the patch against your latest repository. Merge the changed-files ZIP into the existing project root. Keep literal `[conversationId]` route folder names and do not create `%5B...%5D` paths. Do not overwrite your own configuration/environment files.
2. Apply `db/migrations/20260912_existing_tenh_upgrade.sql` to the **existing** Supabase database. This is an additive migration: profile columns if absent and a server-only `facebook_sticker_sends` receipt table. The latter prevents repeated/uncertain sends from being dispatched twice. It is not another customer database.
3. The previously delivered `supabase/migrations/202609120001_tenh_seven_updates.sql` was missing from this uploaded source. It is restored unchanged for the existing Block User feature and its regression tests. **If it was already applied to your database, do not apply it again just because the file is included.** Apply it first only if the previous seven-updates migration was never installed. No migrations were executed on your database here.
4. Add `STIPOP_API_KEY` to the existing server/Vercel environment. It must be your Stipop Chat API key, not `NEXT_PUBLIC_*`. Optional: `STIPOP_LANGUAGE` (two lowercase ISO letters, default `en`), `STIPOP_COUNTRY` (two uppercase letters, default `KH`). Optional `STIPOP_MEDIA_HOSTS` is a comma-separated exact CDN hostname allowlist only if your vendor actually returns a CDN outside `*.stipop.io`; never add arbitrary/untrusted hosts.
5. Keep existing Facebook/Supabase environment variables, OAuth redirect URLs and webhook configuration unchanged. In particular do not configure one global Page token/ID for every TENH customer: this integration uses each conversation's existing connected Page and token helper. Keep the project's existing Graph API version setting; no `/v19.0` hardcoding was added.
6. Install your normal locked dependencies, run your existing type/lint checks and `npm run build`, then test a preview deployment. No production dependency was added by this patch.
7. Deploy the website/API files. Extract the standalone Companion ZIP into your **existing** unpacked extension folder and reload its existing Chrome entry. Verify version **1.2.22**. Refresh TENH and Business Suite tabs once. Do not create duplicate TENH extension installations. A production Web Store update still requires the normal store submission/review process.

## 1. Profile synchronization, in your existing workflow

`POST /api/save-profile-url` accepts `{ "psid": "...", "publicProfileUrl": "https://www.facebook.com/profile.php?id=..." }`. The existing extension device credential is sent as a Bearer token. Same-origin, signed-in TENH calls also work. The exact Page can be supplied as `pageId`, and exact `conversationId`/`businessId` are optional extra constraints. Ambiguous matches are refused instead of selecting the first customer or Page.

The endpoint updates existing `contacts.facebook_profile_url`/`facebook_profile_id`, preserving the Messenger PSID. It reuses member permissions, active subscription/device authentication and existing event logging. Scoped IDs, Page IDs, account-menu URLs, malformed/external URLs and silent replacement of a different saved public profile are rejected. A browser-reported link is **not independent Meta identity verification**.

The uploaded Companion 1.2.21 had its old active profile lookup retired and did not contain this POST workflow. This upgrade adds separate passive helper/observer files without rewriting the existing Facebook bridge, TENH bridge, selector module, side panel, tab manager or realtime/retry/ACK/delta core.

As an agent navigates a visible Business Suite conversation and exposes that customer's details, the observer reads only an explicit View/Open Profile link from the matched details section. It does not click profile controls, search customers in background tabs, read cookies/passwords or call private Facebook APIs. It verifies Page/thread context again in the worker before the authenticated POST. It avoids customer-authored message links, general account menus and ambiguous panes. Repeated observations are deduplicated and failures are throttled. Popup setting **Sync visible customer profile links** can disable uploads; Advanced shows the last result.

Once saved, TENH's existing customer photo and **View public profile** link open that URL directly without requiring the extension. The component re-reads authorized data on a matching extension event, focus and a low-frequency visible-details refresh; it never trusts URL data from window messages. If no actual link exists, the avatar shows an availability notice. The requested `m.me/{PAGE_ID}?id={PSID}` link is separately labelled **Open Page Messenger**; it is NOT a public-profile fallback or a guarantee of opening someone else's private thread.

The DOM fixtures are synthetic, not a live Facebook session. Actual Business Suite layouts can differ. The observer fails closed when it cannot tie an explicit profile link to a visible selected customer. This is not a universal PSID-to-public-ID conversion, and it does not reinstate the earlier invisible profile-probing feature. Update the extension's privacy disclosure for this newly enabled optional data synchronization and obtain applicable authorization; technical access is not a claim of Meta permission/approval.

## 2. Stipop inside the existing Inbox

The existing Sticker button/picker now has **Online / TENH** choices for Facebook. Online searches Stipop through `GET /api/stickers/search?conversationId=...&q=...`, with six search-category shortcuts, a grid and More. These are six categories, not six invented native Facebook sticker packs. Telegram's existing native sticker sets and TENH's existing image collection remain available.

Clicking an online result calls `POST /api/stickers/send` with the selected conversation, a server-signed selection ticket and a unique request ID. It goes through the current optimistic-message UI. Your typed text stays in the composer.

The server binds the selection to the authenticated workspace, member, Page and customer. It verifies the existing block/window policy, downloads the signed catalog result from approved HTTPS hosts with file-size/MIME/signature checks and redirects refused, then adapts it into the **existing `/api/facebook/send-attachment` handler**. That handler already uploads a reusable attachment and sends it through the connected Page. Its token refresh, message persistence and echo/realtime behavior are reused, not duplicated.

Artwork is delivered as a Messenger **image attachment**, not a native Facebook Sticker Store item. The Stipop key is never returned to the browser. Stipop gets a stable hashed per-agent/per-workspace user identifier; analytics are registered after confirmed delivery. Use a Stipop plan/license that permits your intended artwork distribution through external Messenger accounts.

A durable receipt guards against duplicate requests, including network uncertainty after dispatch. An uncertain result stays pending/uncertain and asks the agent to check Messenger rather than blindly sending again. The receipt is not an outbox that retries a customer send automatically. Don't delete uncertain receipts to force retry.

Without `STIPOP_API_KEY`, only the new Online tab shows a configuration notice; local TENH images and Telegram packs are not removed. No provider key or artwork is included in the ZIP.

## 3. Existing features audited and reused

- Business Suite navigation already authorizes the selected workspace/Page/customer and builds `asset_id`, `selected_item_id`, `mailbox_id` and `thread_type=FB_MESSAGE`. Its normal behavior and extension-only navigation gate remain unchanged. Facebook itself may redirect or request login; no live routing guarantee is made.
- Customer Details → Other → Block/Unblock already uses `/{PAGE_ID}/moderate_conversations` and `block_user` / `unblock_user`, marks state only after confirmation, and displays provider diagnostics. This was not replaced with an unsupported PSID-to-`/blocked` request. A Page-specific block is not a global ban and doesn't grant missing Meta permissions.
- The existing signed `/api/webhooks/facebook` endpoint and native incoming `message.reply_to.mid` handling remain intact. Outgoing TENH-only reply references are not falsely upgraded to native Messenger quotes.
- Existing Telegram reply/deletion-safety, native stickers, pinned headers, quick replies/tags, team/group features, normal API sending/receiving and extension realtime core were not reimplemented.

## Verification performed

- 108 new mocked/unit tests: authenticated profile receiver, URL validation, multi-Page/workspace isolation, passive-worker state, Stipop API contract, scope-bound signed selections, approved media/MIME checks, receipt idempotency and uncertain-result protection.
- 99 existing seven-updates regressions, plus 34 existing sticker-picker tests: **241 Node tests passed in one combined run**. The existing extension regression harness was updated to execute the new helper module alongside the old worker code, and to expect version 1.2.22; existing security assertions were retained. The restored prerequisite migration fixes a source-file omission, not a relaxed RLS check.
- 23 synthetic local Chromium DOM checks: selected-customer matching, hidden/ambiguous/own-account/message links, wrapped URLs, throttled observation and cleanup. No real Facebook document/account was accessed; the test injects a fixture URL while rendering local HTML.
- Syntax parsing passed for 13 changed/new TS/TSX files and all 11 extension JS files; manifest asset/import references checked. Syntax checking is not a full TypeScript production build.
- ZIP path/duplicate/integrity checks and preservation hashes are recorded in `release-manifest.json`.

**Not verified:** full Next.js build (`next: not found` because project dependencies are absent here), live Supabase migration execution, live Stipop catalog/media/analytics, Meta delivery/moderation, and the real installed extension workflow. A local unpacked-extension smoke attempt did not produce a service worker within 7 seconds and is recorded as NOT VERIFIED, not passed. No production deployment or Web Store approval was performed.

Test command (uses your existing TypeScript dev dependency):

```sh
node --test tests/existing-upgrade/*.test.cjs tests/tenh-seven/*.test.cjs tests/sticker-picker-ui.test.cjs
npm run build
```

The optional synthetic DOM test uses Python Playwright and local Chromium:

```sh
python tests/existing-upgrade/profile-dom-fixtures.py
```

## Preview acceptance checklist

Test with a non-production Page/customer first. Confirm auto TENH login, then profile sync from an explicitly visible correct customer pane; check a second Page and a second agent/workspace. Confirm no automatic profile tab is opened. Disable Companion and verify saved profile links and normal Inbox still work. Search/send one Stipop sticker and verify the receiving account sees one image, then test repeated request ID and an expired/blocked send. Recheck Telegram native packs/reply safety, existing Block diagnostics and incoming quoted replies. No normal login/channel feature should require the Online sticker catalog or passive profile observer.

## Primary documentation consulted

- Stipop search: https://docs.stipop.io/en/chat/api-endpoints/search/sticker-search
- Stipop analytics: https://docs.stipop.io/en/chat/api-endpoints/sticker-send/register-sticker-send
- Meta Messenger: https://www.postman.com/meta/messenger-platform-api/collection/iyp204x/messenger-platform-api
- Meta moderation: https://www.postman.com/meta/messenger-platform-api/folder/a43ince/moderate-conversations-api

These references describe provider APIs; they do not prove your account has live access or that every customer exposes a public profile link.
