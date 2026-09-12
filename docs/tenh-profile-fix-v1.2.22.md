# TENH automatic Facebook profile lookup — 1.2.22

The supplied 1.2.21 disabled the resolver, the profile commands in the service worker, and the Facebook bridge handlers. The avatar only opened saved links. The supplied database migration added `facebook_profile_id` but not the `facebook_profile_url` column used by the existing profile API.

This patch restores an automatic lookup for Messenger customer avatars. It is prepared for a live check; it has not been tested against an authenticated Facebook account. It does not implement a PSID-to-public-ID API or claim to reproduce Pancake's internal mechanism.

## Install

1. Back up your local project. Extract this patch over the project root, keeping its folders. It contains changed/new files only, plus a complete extension ZIP under `dist`.
2. In your Supabase project's SQL Editor, run `db/migrations/20260912_automatic_facebook_profile_links.sql`. It adds missing columns only and preserves existing customer/messaging IDs. It is safe to run if the columns already exist. This patch does not apply it to your live database.
3. Deploy the updated website/API files to `app.tenhchat.com` using your normal Vercel deployment. The website and extension must both be updated.
4. For your existing unpacked Chrome extension, extract `dist/tenh-companion-1.2.22.zip` into its current extension folder, replace its files, and click Reload on the extension at `chrome://extensions`. Check that its version is 1.2.22. Keep one enabled TENH extension. The complete ZIP has `manifest.json` at its root. For a fresh unpacked installation, use Load unpacked on the extracted folder.
5. Refresh TENH and your Facebook/Business Suite tabs. Sign in to Facebook with Page inbox access in the same Chrome profile, and let TENH connect its companion.
6. In TENH, select a Facebook Messenger conversation and click the customer's avatar. No profile URL entry field is required.

## Behavior

- A saved valid public link opens directly, including saved username links.
- An unknown Messenger profile asks the paired extension to authorize the exact workspace, Page, conversation and customer ID with TENH. The customer name comes from TENH's server record.
- The extension reads an already open exact inbox tab passively, or opens its own inactive lookup tab after the click. Startup, installation, pairing and background sync do not open lookup tabs.
- The resolver requires Facebook's rendered selected conversation row, matching customer heading, and a visible profile link in the customer identity area. A URL in a message or a name match alone is insufficient. Conflicting IDs, ambiguous links, the Page ID and the Messenger PSID are rejected.
- Facebook's profile destination is checked in an inactive tab for a matching visible profile heading and an unavailable/login state. Only a verified result is opened in the foreground.
- A short-lived one-use result ties opening to the original TENH tab/document and customer context. If the agent switches conversation or closes the component before lookup completes, TENH does not request the final opening.
- Temporary inactive tabs are cleaned up. Existing tabs and temporary tabs that the agent takes over are preserved.
- After a successful opening, TENH automatically saves the real link through its existing customer API. Existing customer-management permissions and concurrent-edit checks apply. A save failure is displayed; the profile can still open.
- Browser discovery requires desktop Chrome with the companion. A saved link can subsequently be opened by the team wherever this TENH customer avatar component is used. This patch does not add extension support to Android.

## Limits and live acceptance

Facebook may use a different inbox layout or omit the link/selected-row evidence. In those cases the action returns an availability/verification message. The fixtures exercise the accessible DOM patterns supported by this resolver; they do not prove that those patterns are currently present in your Facebook account.

Check one customer whose public profile you already know. The profile must be that customer. Repeat for a customer on another connected Page and for two customers with the same name. Reload TENH and confirm a captured link opens directly. Switch conversations while an unknown profile is loading and confirm the old profile does not open. If Facebook does not expose enough evidence, retain the displayed error message and a screenshot of that customer's Business Suite identity area for the next selector adjustment.

No Facebook Graph API scopes or additional extension permissions were added. Messenger sending/receiving, sound, webhooks, group chat, Tags, Quick Replies, and the extension's existing sync/retry/ACK/delta core were not changed by this patch.

## Validation

- 149 focused automated tests passed: extension/API mocks, simulated rendered DOM, component state/lifecycle, website-to-extension bridge, URL validation, existing authorization/persistence checks, and passive tab/startup behavior.
- Changed TypeScript sources and their imported dependencies passed a temporary strict type-check configuration. All changed extension JavaScript files passed `node --check`.
- The broader supplied message-safety suite had 35 passing checks and one check that could not run: it references `supabase/migrations/202609120001_tenh_seven_updates.sql`, absent from the supplied archive. That unrelated block-storage migration was not reconstructed or applied.
- A full Next.js production build was not run. The supplied archive has no root `tsconfig.json`; validation used a temporary configuration outside the patch.
- No live Facebook session, Supabase migration execution, or Vercel deployment was performed.

Re-run the profile fixtures after installing project dependencies and `jsdom@26` (use `npm install --no-save jsdom@26`, or point `TENH_JSDOM_PATH` at an existing jsdom installation):

```sh
node --test scripts/test-facebook-profile-opening.cjs scripts/test-facebook-profile-resolver.cjs scripts/test-customer-facebook-avatar.cjs scripts/test-profile-bridge-contract.cjs scripts/test-extension-passive-tabs.cjs lib/facebook/customer-profile-url.test.mjs lib/facebook/profile-lookup-error.test.mjs lib/extension/companion-response.test.mjs tests/tenh-seven/server.test.cjs tests/tenh-seven/extension.test.cjs
```
