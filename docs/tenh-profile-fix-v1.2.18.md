# TENH customer-profile fix — 1.2.18

## Source and scope

This patch is based only on `social-inbox(20260911-110323).zip`, whose embedded extension is version 1.2.17.
Input SHA-256: `6ae3aa5e4aad8b227bf96c5660cb2e2aa045e221696299ec36208dfcd1e67fb2`.

No older project snapshot was substituted. No original file was deleted. Of the 561 original files, 549 are byte-identical; 12 are updated (9 runtime/source files and 3 existing test files). Additional test/documentation files are supplied.

The latest uploaded website ALREADY had the resolve/confirm commands. This update preserves that protocol and adds context validation to both phases. It does not claim the prior website was missing it.

## Installation — update the website AND extension

1. Back up or commit your current project.
2. Extract `TENH-v1.2.18-profile-fix-changed-files.zip` into the project root. It preserves the `components/`, `lib/`, `tenh-extension/`, `scripts/` and `docs/` paths. Do not replace your dependencies, environment variables, Next.js configuration or lockfile.
3. Run your normal project type check/build in your local or CI environment, then deploy the web changes. No database migration, new API route or new environment variable is introduced.
4. Extract `TENH-Companion-v1.2.18.zip` into your existing unpacked-extension folder and reload that SAME Chrome installation. Confirm version **1.2.18**. Do not run several TENH copies from different folders.
5. Refresh TENH. An existing Facebook tab is not required for the photo-click action. The same Chrome profile must have a valid Facebook login with access to the Page.
6. Click the customer photo in Customer Details. Do not use the separate **Open in Facebook** conversation button for this test.

The complete updated project snapshot is also supplied for reference. The changed-files ZIP is the safer overlay for an existing repository that contains configuration files omitted from the supplied source archive.

## What changed

- The profile action can now create an **inactive, temporary** Business Suite lookup tab when there is no suitable tab. It does not focus Business Suite or navigate the agent's existing Facebook tabs.
- The extension authorizes the requested workspace + Page + Messenger conversation through the existing `/api/extension/context` endpoint. It checks authorization again before opening.
- Lookup requires the exact requested Page and selected Messenger thread. The customer's name is an additional identity check, not permission to choose a same-name conversation.
- Profile links can be read from the customer header/detail card even when the search box is absent. Supported name-linked headers and English/Khmer View profile labels are handled.
- The candidate profile is loaded in a separate inactive temporary tab. A settled visible profile heading must match the authorized customer name. Generic Facebook navigation and text in a post do not count as profile verification.
- Unavailable profiles, sign-in pages, mismatched identity, ambiguous links, unsafe URLs and known scoped Messenger-ID links are rejected instead of being shown in the foreground.
- A short-lived, single-use, document-bound opening ticket completes the existing second command. Tickets survive service-worker suspension in `chrome.storage.session`; they are not stored in synced or long-term profile storage.
- The visible final destination is the Facebook **profile**, not Business Suite. There is no visible inbox fallback for a profile click.
- A numeric public ID is returned/displayed only when present in the resolved profile URL or its canonical/OG URL metadata. Otherwise a genuine username profile link stays a username link. No username/PSID-to-public-ID conversion is invented.
- Old unverified `localStorage` profile-cache entries are ignored. New cache entries are scoped to workspace/Page/conversation/customer, expire after an hour, and are saved in page session storage only after validation and a successful opening confirmation.
- Switching customers while the initial lookup is pending prevents its result from being cached or submitted for opening. The confirmation includes the requested workspace/Page/thread/conversation again.
- A known saved public Facebook ID can still open directly without the extension, but an ID equal to the Messenger ID is rejected.
- Errors have specific reasons and a Copy error details action. Diagnostics omit customer names, message content, profile links and tokens.

## Preserved

Auto TENH connection, the no-manual-pairing UI, realtime connection/reconnect, ACK/delta/retry logic, outgoing-message observation/reconciliation, Quick Replies, Tags, Side Panel, normal Open in Facebook, managed-tab/sync behavior and existing context-invalidation protections were not replaced. The edited service-worker/selector/TENH bridge files preserve **75 existing non-profile named functions exactly**; the profile-related dispatch arguments are the targeted exception in `handle`.

All backend route files, `customer-profile.tsx`, the normal avatar-recovery component, Messenger/Comments/Telegram code, web/mobile presence, sound logic, package.json and other unlisted files are byte-identical to the input.

Chrome permissions and host permissions are unchanged. No cookie/password extraction, private Facebook endpoint, remote executable script or messaging-window workaround was added.

## Runtime/source files changed

- `tenh-extension/manifest.json`
- `tenh-extension/src/background.js`
- `tenh-extension/src/facebook-profile-resolver.js`
- `tenh-extension/src/facebook-selectors.js`
- `tenh-extension/src/tenh-bridge.js`
- `components/inbox/customer-facebook-avatar.tsx`
- `lib/extension/use-companion.ts`
- `lib/facebook/customer-profile-url.ts`
- `lib/facebook/profile-lookup-error.ts`

## Checks actually run

- **43 Node tests passed** across background profile opening, the photo component, actual hook/content-script command forwarding, existing avatar recovery, response handling and profile URL helpers.
- **17 Chromium DOM fixture checks passed.** These use real DOM/layout in a local fixture with simulated Facebook locations, not a Facebook account.
- All 8 extension JavaScript files passed `node --check`.
- All **467** supplied TS/TSX source files parsed with zero syntax errors.
- Strict TypeScript checks passed for the changed URL/error helpers and the existing response helper.
- Manifest JSON, unchanged permissions, referenced package assets, input/output inventories and ZIP CRC integrity checked.

### Not validated here

A full Next.js production build was **not** completed. The supplied ZIP has no root tsconfig/lockfile and dependency installation failed with a registry DNS error (`EAI_AGAIN`). Package/dependency versions were not changed to work around that. Use your existing repository's configuration and installed dependencies to run `npm run build` before deployment.

No test used your signed-in Facebook/Business Suite account, live TENH credentials or production database. Facebook UI, login checks and profile availability can differ. This is not a promise that every Messenger customer has an accessible public profile.

## Live acceptance test

Test a customer whose Facebook profile you can manually access, and one whose profile is restricted. Test with no Facebook tabs, with an active Facebook tab on another customer, and with two different Pages containing identical customer names. The active TENH view must remain in place during lookup; only a validated customer profile should be focused on success. A failure should show a reason in TENH, never a guessed profile or a foreground Business Suite fallback. Also verify the existing ordinary messaging/Quick Reply/Tag features after deploying.

**Important ID limitation:** `selected_item_id` is checked against the requested thread ID. If Facebook uses a different internal thread identifier for a conversation and no trusted mapping exists, the result is `conversation_mismatch`. This build deliberately does not fall back to picking a person by display name. A real link that Facebook does not expose cannot be manufactured by the extension.

## Test commands

```sh
node --test scripts/test-customer-facebook-avatar.cjs scripts/test-facebook-profile-opening.cjs scripts/test-customer-avatar-recovery.cjs scripts/test-profile-bridge-contract.cjs
node --experimental-strip-types --test lib/extension/companion-response.test.mjs lib/facebook/customer-profile-url.test.mjs
node scripts/test-facebook-profile-resolver.cjs
```

The fixture runner needs Playwright plus Chromium on the test machine. Its `TENH_PLAYWRIGHT_PATH` and `TENH_CHROMIUM_PATH` environment overrides can point to an existing local test installation. No Playwright runtime dependency was added to TENH.
