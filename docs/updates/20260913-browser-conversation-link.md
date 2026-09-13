# Saved Business Suite links — TENH CHAT

This patch replaces the earlier no-extension navigation patch. It addresses the reported legacy Facebook inbox link redirecting to the first customer. It adds a customer-specific, persistent Business Suite link and keeps View this conversation independent of TENH Companion.

## Install

1. Apply `db/migrations/20260913_facebook_inbox_links.sql` in your Supabase SQL editor.
2. Apply `db/repairs/20260913_hae_rith_inbox_link.sql` to save the Hae Rith link you supplied. Its result must show Page `203981939455120`, recipient `38223061640675514`, and selected item `61584041913037`.
3. Merge this ZIP's files into your existing TENH project. This is a changed-files patch, not a complete project.
4. Restart the localhost Next.js server and refresh TENH. For production, deploy the website changes and refresh the page. No extension installation or update is needed.
5. Open Hae Rith under Apex Clothing and choose **View this conversation**. Verify that Facebook shows Hae Rith. The saved destination is based on your manually selected URL; it has not been tested in a live Facebook session here.

The database migration must run before the new API is used. No SQL has been run against your database from this workspace.

The Hae Rith setup script only inserts a link when the exact workspace, connected Page, Messenger customer ID and existing conversation match. It stops if that context is missing or ambiguous. It does not overwrite an existing saved link. If its result already contains a different link, use Edit conversation link in TENH to correct it after verifying the selected customer in Facebook.

## Other customers

For a customer whose Meta-provided link also opens the first chat:

1. Manually select that customer on the correct Page in Meta Business Suite.
2. Copy the full address-bar URL.
3. Select the same customer in TENH. In Customer Details, below View this conversation, click **Edit conversation link**.
4. Paste the URL, confirm that you selected this customer in Facebook, and click **Save link**.
5. Click **View this conversation** again. TENH reuses that saved link on future visits, across browser refreshes and server restarts.

The header shortcut also offers **Set conversation link** when a usable direct link is unavailable. Editing requires the workspace's customers/manage permission. Other authorized agents can open the saved link. Use Edit conversation link to replace or remove an incorrect mapping.

This is a one-time setup per affected customer. It is not a verified API conversion for all Facebook IDs. The Page/customer can be checked against TENH, but the correspondence between a manually pasted Suite selected_item_id and that customer relies on the agent's explicit confirmation. If the saved URL itself still opens the wrong customer, correct that mapping; clearing browser cookies does not repair a wrong saved destination.

## What changed

- Saved destinations take priority over the Meta lookup and are isolated by workspace, connected Page and recipient ID. A saved link is also checked against the current contact and Page before being returned.
- The API accepts an automatically resolved destination only when Meta returns a direct Business Suite Messenger URL matched to the Page/customer participants.
- Legacy URLs such as `https://www.facebook.com/{PAGE}/inbox/{THREAD}/?section=messages` now produce a setup notice. TENH no longer opens that known problematic route for this shortcut.
- The API never substitutes a Messenger PSID or a Graph thread ID into selected_item_id. IDs remain strings, including IDs larger than JavaScript's safe integer range.
- Supported routing parameters in the supplied Suite link are retained. Tracking parameter ir_qe_exposed is removed.
- Saving and removing links require current authorization, customer context and a matching saved version. A uniqueness constraint prevents assigning the same Suite conversation to another recipient on the same workspace/Page.
- Pending lookups and editing requests are cancelled on customer changes. Late responses cannot open or populate the newly selected customer's form.
- A blocked popup produces a normal browser link. An unexpected HTML response produces a readable notice instead of a JSON parsing exception.

## Storage and caching

Confirmed links are stored in `public.facebook_inbox_links` with no expiry. Opening one reads that small saved record without another Graph API request. It rechecks current conversation access and the Page connection on every request. Browser cookies and access tokens are not stored in the link table.

The existing bounded server cache for Meta lookups remains five minutes, up to 256 entries per server process. Its keys include workspace, conversation, Page account, recipient, connection version and Graph version. A server restart clears this temporary lookup cache, but not the saved database links.

HTTP responses remain private, no-store so a shared browser or CDN cache cannot return another customer's link. Here `cacheUsed: true` with `linkSource: agent_saved_business_suite` means the API reused the confirmed stored destination.

## TENH API

All operations use the signed-in session and the exact context query:

```text
/api/conversations/{TENH_CONVERSATION_ID}/facebook-conversation
  ?businessId={TENH_WORKSPACE_ID}
  &pageId={FACEBOOK_PAGE_ID}
  &recipientId={MESSENGER_PSID}
```

- GET opens/resolves the destination.
- GET with `settings=1` retrieves the editable saved link, its confirmedAt version and canSaveLink permission. It does not query Meta.
- PATCH saves a URL using `{ "conversationLink": "<URL>", "confirmed": true, "expectedConfirmedAt": null }` for a new mapping. For an existing mapping, use confirmedAt from settings as expectedConfirmedAt.
- PATCH removes a saved link using `{ "conversationLink": null, "expectedConfirmedAt": "<current version>" }`.

The server obtains Page/contact/workspace IDs from the authorized conversation, not from a request body. RLS is enabled and browser roles cannot access the table directly. Only the authorized server route uses the service role.

## Hae Rith mapping supplied by the user

| Field | Value |
| --- | --- |
| TENH workspace | f92ebb56-d907-499e-a84d-c09180b849b6 |
| Apex Clothing Page | 203981939455120 |
| Messenger recipient PSID | 38223061640675514 |
| Business Suite selected item | 61584041913037 |

These IDs are confined to the setup script and test evidence. Runtime navigation does not hardcode them or use them as defaults for any other customer.

## Validation

84 focused automated tests passed, covering authorization, exact Page/customer matching, saved-link isolation, repeated opens, persistence across simulated server instances, link editing/removal, permissions, stale updates, unsafe URLs, legacy-link refusal, popup behavior and rapid header switching. TypeScript checked 538 files with zero diagnostics.

Meta calls and browser navigation are simulated in these tests. SQL was reviewed, but a PostgreSQL instance and a live Facebook session were not available. The uploaded project also lacks the complete production build configuration; no production build or live deployment is claimed.

Run the tests from the existing project with TypeScript, React and jsdom available:

```sh
node --test --test-concurrency=1 --test-reporter=spec scripts/test-browser-conversation-link.cjs scripts/test-facebook-conversation-link.cjs tests/messenger-sources/business-suite-action.test.cjs tests/messenger-sources/header-switching.test.cjs
```

## Included runtime and database files

- components/inbox/companion-facebook-action.tsx
- app/api/conversations/[conversationId]/facebook-conversation/route.ts
- lib/facebook/conversation-link.ts
- lib/facebook/customer-conversation-link.ts
- lib/facebook/cached-conversation-link.ts
- db/migrations/20260913_facebook_inbox_links.sql
- db/repairs/20260913_hae_rith_inbox_link.sql

The historical component filename/export stays compatible with the existing header and menu. Test files, their fixture/helper, this guide and a checksum list are also included.
