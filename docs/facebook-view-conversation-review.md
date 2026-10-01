# View conversation — local review

The Messenger conversation header now exposes an accessible View conversation shortcut. It makes one read-only request on click, with no render-time requests, extension dependency, cookie scraping, or customer action. A blank tab is opened during user activation and detached from its opener; only that untouched loading tab can be redirected or closed. Switching chats aborts the request and prevents a late response from navigating it.

The existing conversation access gate checks active membership/subscription. The navigation mode then reads the conversation, Page and customer within the authorized business and verifies their IDs/source relationships. Meta lookup uses Page conversations filtered by customer PSID and matches the exact Page/customer participants. Page ID, PSID, Graph thread ID and Suite navigation ID remain distinct. The Page token stays in a server-side Authorization header.

The new navigation mode skips the manual-link table and accepts only the existing strict HTTPS `business.facebook.com/latest/inbox/all` or `/messenger` validator, with the matching Page asset, explicit FB_MESSAGE type and a provider-returned selected ID. Unsafe/unsupported/legacy links produce an explicit Open Page inbox fallback, without guessing a selected ID or automatically opening another conversation. Extra query parameters such as tokens/redirects are stripped by the existing validator. Authorization/context failures do not supply a fallback.

The existing process-local cache coalesces matching requests and holds at most 256 contexts. Successful lookups expire after five minutes; unsuccessful provider results now expire after 30 seconds to bound repeat clicks. Connection version and all authorized context IDs are part of the key. Navigation mode cannot force-refresh that cache. Cold server instances may each make a lookup; this is not a distributed rate limiter.

Runtime files changed: `app/api/conversations/[conversationId]/facebook-conversation/route.ts`, `lib/facebook/cached-conversation-link.ts`, `components/inbox/companion-facebook-action.tsx`, `components/inbox/conversation-header.tsx`.

Tests: 13 server navigation tests, existing and extended React DOM action tests, and a real-component native Chrome fixture with nine passing assertions. The combined regression run passed 95 tests. Final TypeScript/build passed; touched-file lint adds no findings against HEAD (existing UI lint errors remain). Recoverable local candidate snapshot is recorded in `docs/deploy-candidate-manifest.json`.

Limits: all new checks use synthetic API results. Live Meta permission acceptance and exact Business Suite destination/redirect behavior remain unverified. Supported direct link formats may be absent even when Meta resolves the Graph thread; the fallback deliberately says Page inbox. No deployment, remote SQL, permission change, messages or browser account access occurred.
