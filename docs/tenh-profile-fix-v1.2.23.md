# TENH Facebook profile correction — 1.2.23

This is a cumulative patch for the supplied social-inbox project. It includes the earlier profile changes and this correction, plus the complete Companion 1.2.23 extension ZIP. It is not a standalone copy of the whole website.

## What was wrong

Version 1.2.22 put the customer's Messenger PSID in Business Suite's `selected_item_id`. The reported URLs show that these identifiers differ. That could load a broken conversation or stale customer card. The resolver also rejected an active lookup tab with an unnecessary instruction to return to TENH.

Version 1.2.23 keeps the PSID and inbox identifier separate. There is no runtime mapping for any specific person, username, Page or business. Public profile URLs are captured automatically; customers do not need a manual URL field.

## Install

1. Back up your project, then extract this patch over its root, preserving the folders and replacing the corresponding files.
2. If you did not already apply the 1.2.22 profile migration, run `db/migrations/20260912_automatic_facebook_profile_links.sql` in Supabase SQL Editor. It adds missing profile columns and preserves existing messaging IDs. There is no additional 1.2.23 migration.
3. Deploy the updated website/API files through your usual Vercel workflow. Updating the extension alone is insufficient: the new server helper must be deployed too.
4. Extract `dist/tenh-companion-1.2.23.zip` into your existing unpacked extension folder. At `chrome://extensions`, reload TENH Companion and check version **1.2.23**. For a fresh install, choose **Load unpacked** and select that extracted folder. Keep one enabled TENH Companion installation.
5. Refresh TENH and Facebook/Business Suite. Use the same Chrome profile with Facebook signed in and access to the connected Page.
6. Open a Messenger conversation in TENH and click the customer's avatar. A saved valid public URL opens directly. An unknown URL starts the automatic lookup.

## How lookup works

- TENH first verifies the paired extension's workspace, conversation, Page and customer PSID.
- The server requests the Page's conversations with the PSID as `user_id` and fields `id,link,participants`. It accepts one complete two-party conversation containing exactly the authorized Page and customer IDs. Names alone never select the API conversation.
- The Page token stays on the server. The extension receives a sanitized conversation URL returned by Meta and the native customer name. It never constructs an inbox URL or public profile URL from the PSID.
- The extension reads a matching existing Facebook tab, including an active tab, or opens an inactive tab using that returned URL. A returned legacy thread link may redirect into the same Page's Business Suite in the newly created inactive tab.
- The loaded route must match the verified conversation link. Any conflicting selected-row evidence is rejected. A matching visible customer heading and an actual public profile link in the customer identity area are required. Links inside chat messages, ambiguous links, and Page/PSID values used as public IDs are rejected.
- The public profile destination is checked in an inactive tab before opening. A short-lived result is bound to the original TENH tab, document, Page and customer. Switching TENH conversations cancels the final opening.
- After opening, TENH automatically saves the real profile URL through its existing customer API, subject to customer-management permissions and concurrent-edit checks. Existing tabs and temporary tabs taken over by the user are preserved.
- Facebook's “No contact card” and loading-error states now produce specific messages. If Meta does not return a usable conversation link, lookup stops before opening a guessed inbox URL.

## What is verified, and what still needs a live check

**179 focused automated tests passed**, covering the API, Chrome extension mocks, rendered DOM fixtures, avatar behavior, bridge contracts, public URL validation, authorization, persistence, and passive-tab behavior. The cases include different PSIDs and inbox IDs for multiple customers and Pages, same-name mismatches, missing/ambiguous API results, legacy redirects, the reported Facebook error states, and conversation changes during lookup. The supplied real example appears only in tests.

Changed TypeScript sources and their imported dependencies passed a temporary strict type check. All four changed extension JavaScript files passed syntax checks. The packaged extension and patch were checked against the source files.

Meta's maintained Business SDK exposes the conversation `link` and `participants` fields, but these fixtures do not establish which link or DOM your signed-in Facebook account currently returns. This version has **not** been tested against a live authenticated Facebook account, deployed to Vercel, or applied to Supabase. It cannot guarantee automatic lookup for every customer: Page permissions, missing API links, inaccessible profiles, or different Facebook layouts can prevent discovery. A Suite `selected_item_id` is not treated as proof of a public profile ID.

A full Next.js production build was not run because the supplied archive has no root `tsconfig.json`; the temporary validation configuration is not part of the patch. In the earlier check of the broader supplied message-safety suite, 35 checks passed and one could not run because its referenced `supabase/migrations/202609120001_tenh_seven_updates.sql` was absent from the archive. That unrelated migration is not reconstructed here.

For the live check, click an unknown profile whose public URL you already know, then repeat with another customer and another connected Page. Confirm the final tab is that customer's public profile. Refresh TENH to confirm the captured link opens directly. A missing-link or unavailable-card message means discovery did not succeed; it does not mean the profile was fixed.

No extension permissions, messaging IDs, send/receive behavior, sound, webhook processing, or extension sync core were changed. The separate Business Suite shortcut is outside this profile correction.

## Repeat the focused tests

Install project dependencies and `jsdom@26` (or set `TENH_JSDOM_PATH` to an existing jsdom installation), then run:

```sh
node --test scripts/test-facebook-conversation-link.cjs scripts/test-facebook-profile-opening.cjs scripts/test-facebook-profile-resolver.cjs scripts/test-customer-facebook-avatar.cjs scripts/test-profile-bridge-contract.cjs scripts/test-extension-passive-tabs.cjs lib/facebook/customer-profile-url.test.mjs lib/facebook/profile-lookup-error.test.mjs lib/extension/companion-response.test.mjs tests/tenh-seven/server.test.cjs tests/tenh-seven/extension.test.cjs
```
