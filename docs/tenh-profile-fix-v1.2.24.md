# TENH Facebook profile correction — 1.2.24

## Confirmed cause

The provided Graph API response includes a conversation `link` in this format:

```text
/{PAGE_ID}/inbox/{INBOX_THREAD_ID}/?section=messages
```

TENH 1.2.23 rejected this format in its server validator and both extension parsers. The server also removed the `section` parameter. Its generic error incorrectly suggested that Meta had not provided a link. The successful response shows that the token used for that test already has access to the link; this rejection requires a TENH code correction.

Version 1.2.24 accepts the returned Page inbox path, resolves relative links against `https://www.facebook.com`, and preserves `section=messages`. It verifies the Page and participants for every customer. The path's thread ID remains separate from the Messenger PSID, Graph conversation ID and Business Suite `selected_item_id`. No customer-specific mapping or manual URL field is added.

## Install

This ZIP is a cumulative patch for the originally supplied project, including previous profile changes. It contains changed/new files with their original folders and a complete extension ZIP under `dist`. It is not a standalone website project.

1. Back up your project. Extract the patch over its root, preserving folders and replacing the corresponding files.
2. Deploy the website/API changes with your usual Vercel workflow. The new server validator must be deployed together with the extension update.
3. Extract `dist/tenh-companion-1.2.24.zip` into the existing unpacked extension folder. Reload TENH Companion at `chrome://extensions` and confirm **1.2.24**. For a fresh installation, use **Load unpacked** on that extracted folder. Keep one enabled TENH Companion installation.
4. Refresh TENH and Facebook/Business Suite. Use the same Chrome profile, signed in to Facebook with access to the connected Page. Click the customer avatar in a TENH Messenger conversation.

There is no new 1.2.24 SQL migration. If the earlier profile-column migration has never been applied, run the included `db/migrations/20260912_automatic_facebook_profile_links.sql`. It adds missing profile columns without changing messaging IDs.

## Resulting behavior

- A saved valid public URL opens directly. Unknown profiles start the existing automatic lookup and save the verified public URL through the existing customer API.
- The server verifies the workspace, Page and customer before using Meta's returned conversation link. The Page token stays on the server.
- The extension can read the supported Page inbox route directly or follow its redirect into the same Page's Business Suite in its own inactive tab. It does not substitute any of the four different identifier types for another.
- A matching rendered customer identity and an actual public profile link are still required. Wrong Pages, conflicting selectors, comment sections, stale customer headings and ambiguous profile links remain rejected.
- Errors now distinguish an empty conversation result, mismatching participants, a missing link, an unsupported link format, a missing customer name and an API request failure. An unsupported link is identified as a TENH compatibility problem.

## Validation and remaining live check

Six regression tests using the screenshot response and additional customers failed against 1.2.23 and passed after this correction. **193 focused automated tests passed, with zero failures.** These cover the API route and helper, extension navigation and ownership, simulated Facebook DOM, component lifecycle, existing authorization and persistence, bridge contracts, URL validation and passive startup behavior.

Changed TypeScript sources and their imported dependencies passed the temporary strict type check. Changed extension JavaScript passed syntax checks. ZIP contents, extension manifest references and the unchanged messaging sync core were checked against the source.

The real customer example is stored only in a test fixture. Application code contains no hardcoded customer, Page, business or profile mapping.

The supplied successful API response verifies that Meta returned this link. It does not verify the final browser redirect, the rendered profile link or the foreground public-profile opening. Those steps still need a signed-in browser check after installation. Facebook may not expose an accessible public profile for every customer. No Vercel deployment or live database operation was performed here.

A full Next.js production build was not run: the supplied archive lacks a root `tsconfig.json`, so type checking used a temporary configuration outside the patch. The earlier broader message-safety check had 35 passes and one missing-file failure referencing `supabase/migrations/202609120001_tenh_seven_updates.sql`, absent from the supplied archive; that unrelated migration is not reconstructed here.

For acceptance, click a customer whose public profile you know, then a different customer and a customer on another connected Page. Confirm the final tab is the right public profile, then refresh TENH and check that the captured link opens directly.

## Repeat focused tests

Install project dependencies and `jsdom@26`, or set `TENH_JSDOM_PATH` to an existing installation, then run:

```sh
node --test scripts/test-facebook-conversation-link.cjs scripts/test-facebook-profile-opening.cjs scripts/test-facebook-profile-resolver.cjs scripts/test-customer-facebook-avatar.cjs scripts/test-profile-bridge-contract.cjs scripts/test-extension-passive-tabs.cjs lib/facebook/customer-profile-url.test.mjs lib/facebook/profile-lookup-error.test.mjs lib/extension/companion-response.test.mjs tests/tenh-seven/server.test.cjs tests/tenh-seven/extension.test.cjs
```
