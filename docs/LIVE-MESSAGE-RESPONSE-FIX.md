# Live message response and presence fix — 2026-09-13

Apply this incremental ZIP on top of the previous TENH patches, preserving its
folder paths. Redeploy the Next.js app (or restart the local development server),
then refresh the browser. No SQL migration or dependency update is required.

## Changes

- Conversation loading, prefetch, live fallback and older-message pagination now
  validate the response before accepting a message page. HTML, empty bodies,
  malformed JSON and invalid message pages fail safely. Existing messages remain
  available; a failed response does not become a successful empty page.
- Errors identify the HTTP status, response content type and whether the request
  followed a redirect. HTML page bodies are excluded from the diagnostic.
- Switching or closing the active conversation aborts its pending live fallback
  request and ignores late responses/errors.
- Exceptions during message API access checks now return a JSON 500 response.
  Existing authorization decisions and workspace checks remain enforced.
- Presence broadcasts use the WebSocket when it is connected and the channel is
  joined; otherwise they use Supabase's explicit `httpSend()` method. A removed
  workspace channel cannot broadcast after its pending `track()` completes.

## Check after deployment

1. Open a conversation, switch between chats and load older messages. The
   `GET /api/conversations/<id>/messages` requests should return JSON.
2. Briefly go offline, then reconnect. The chat should recover and a newly
   received message should alert once. The existing polling intervals and sound
   deduplication were retained.
3. With two agent sessions open, switch conversations and type a reply. Confirm
   viewing/typing presence updates, including after reconnecting.

If an HTML response still occurs, inspect that **messages request** in the
browser Network tab: its status, Content-Type, redirect destination and matching
server log will identify the remaining server, routing or deployment problem.
The supplied console log alone does not identify which one returned the HTML.
The nearby successful `/api/workspaces` request is a different request.

## Local validation

- 31 focused tests cover invalid responses, API access failures, polling recovery,
  one notification per new message, cancellation, reconnects and workspace races.
- The Messenger source-card regression suite is also run with this patch.
- Strict TypeScript validation covers the supplied TS/TSX files.

These checks use controlled HTTP/Supabase responses, not the deployed service.
The provided archive lacks the complete root build configuration, so this patch
does not claim a production build or live deployment test.
