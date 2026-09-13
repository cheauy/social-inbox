# TENH — Conversations API thread lookup

This update implements an authenticated lookup of Meta's actual conversation ID and exposes it as `thread_id`. It works independently of whether Meta supplies a usable browser link. It does not establish automatic Business Suite redirection for every customer.

## Install and test

1. Merge the included files into your current TENH project, preserving their folders. This is a changed-files update for the project after the Saved Business Suite Links patch.
2. Restart the Next.js server and refresh TENH. For production, deploy the website changes. No extension update or new database migration is required.
3. Select the customer whose View this conversation action returned `facebook_direct_link_required`.
4. Click View this conversation again. When Meta finds the thread but the link is unavailable, open **Meta lookup details → Copy lookup details** in the notice. The details now include the exact `thread_id` returned by Meta.
5. To test only the thread API, copy the TENH `facebook-conversation` request URL from Network, append `&lookup=thread`, and open it in the same signed-in browser. This mode returns HTTP 200 when the thread is found, including when `navigationAvailable` is false.

The new thread-only lookup does not require the manual-link table. The existing Edit conversation link feature still uses the migration from the preceding patch. Existing saved links continue to open without another Graph request.

## API request

```text
GET /api/conversations/{TENH_CONVERSATION_ID}/facebook-conversation
    ?businessId={TENH_WORKSPACE_ID}
    &pageId={FACEBOOK_PAGE_ID}
    &recipientId={MESSENGER_PSID}
    &lookup=thread
```

Use the current signed-in TENH session. The server checks workspace access, the exact conversation, the connected Page and the recipient before requesting Meta. Page access tokens stay on the server.

The server requests:

```text
GET https://graph.facebook.com/{CONFIGURED_GRAPH_VERSION}/{PAGE_ID}/conversations
    ?platform=MESSENGER
    &user_id={MESSENGER_PSID}
    &fields=id,link,participants
    &limit=5
Authorization: Bearer {PAGE_ACCESS_TOKEN}
```

Meta's conversation identifier is `data[].id`. TENH returns it as `thread_id` without changing it. The value remains a string, including a `t_` prefix when supplied. TENH requires exactly one returned conversation whose participants match the authorized Page and recipient. Ambiguous, group or incomplete participant results fail without returning an ID for the wrong customer.

Example of a successful thread lookup when no usable Suite URL is available (illustrative values):

```json
{
  "success": true,
  "threadLookupSucceeded": true,
  "thread_id": "t_123456789012345",
  "threadIdSource": "meta_conversations_api",
  "metaConversationLink": null,
  "cacheUsed": false,
  "navigationAvailable": false,
  "conversationLink": null,
  "navigationReason": "facebook_direct_link_required"
}
```

Actual responses also include the authorized conversationId, businessId, pageId and recipientId. `metaConversationLink` contains only a sanitized provider link, or null when missing/unsupported. It is diagnostic data; navigation must use `conversationLink` only when available.

For the ordinary View this conversation request, a navigation failure remains HTTP 424 with `success: false`. It now also reports `threadLookupSucceeded: true` and `thread_id` when Graph lookup succeeded. A successful Graph lookup and a usable Business Suite destination are separate results. Permission, provider and unmatched-participant failures report their own reasons instead of always requesting a manual link.

## Why the thread ID does not resolve the redirect by itself

TENH's existing saved API-response fixture contains three different values:

| Value | Existing fixture |
| --- | --- |
| Graph response `data[0].id` | `t_971148639112183` |
| ID in Meta's legacy Page-inbox link | `1187032264483411` |
| ID in the supplied Business Suite URL | `100003773480379` |

Removing `t_` or placing the PSID in `selected_item_id` would not reproduce that Suite URL. This update therefore exposes the real ID without generating a destination from an unverified conversion.

The provided [Meta Conversations documentation](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations) returned HTTP 429 during this check. Meta's official SDK source confirms the Page `/conversations` edge, `user_id` and `platform` parameters, and the `id`, `link`, `participants` fields: [Page SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py), [UnifiedThread SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/unified-thread.js). These sources do not establish the required Business Suite routing conversion. No claim of a universal redirect fix is made.

## Cache behavior

A verified thread result, including a result with no usable link, is cached for five minutes in the server process. The cache holds at most 256 entries and combines concurrent lookups for the same context. Its key includes workspace, conversation, connected account, Page, recipient, connection update time and Graph version.

Repeated View this conversation clicks reuse a successfully resolved thread instead of forcing a refresh because the browser link is unavailable. Add `refresh=1` to deliberately query Meta again. Failed thread lookups are not cached. A cold server instance queries Meta again. This temporary cache is distinct from the persistent, manually saved Suite links.

Current membership and Page connection are rechecked even on cache hits. Changing conversations cancels pending requests and clears the copied details. HTTP responses remain private, no-store.

## Validation

98 focused automated tests passed. They cover exact thread IDs, missing/unsafe links, IDs larger than JavaScript's safe integer range, Page/customer isolation, authorization, cache reuse and expiry, saved-link compatibility, late responses, copying details and header switching. TypeScript checked 538 files with zero diagnostics.

Tests use simulated Meta responses and browser APIs. No live Facebook session or production deployment was available. The uploaded project lacks the complete production build configuration, so no production build is claimed.

```sh
node --test --test-concurrency=1 --test-reporter=spec scripts/test-browser-conversation-link.cjs scripts/test-facebook-conversation-link.cjs tests/messenger-sources/business-suite-action.test.cjs tests/messenger-sources/header-switching.test.cjs
```

TypeScript, React and jsdom must be available for the test harness.

## Runtime changes

- `lib/facebook/customer-conversation-link.ts`: separates participant-matched thread discovery from browser-link availability; retains the existing extension-facing link function.
- `lib/facebook/cached-conversation-link.ts`: caches verified thread results even when there is no browser destination.
- `app/api/conversations/[conversationId]/facebook-conversation/route.ts`: adds `lookup=thread`, thread metadata and distinct lookup/navigation outcomes.
- `components/inbox/companion-facebook-action.tsx`: adds copyable lookup details and reuses successful thread lookups.

The archive also includes the focused tests and their helper/fixture files. It contains no new customer-specific mappings or SQL scripts.
