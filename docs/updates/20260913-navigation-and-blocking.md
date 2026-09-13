# TENH conversation navigation and customer blocking — 13 September 2026

## Install

1. Run `db/migrations/20260913_facebook_block_modes.sql` in the Supabase SQL editor. It creates the block table if missing and adds the block mode to existing installations. Existing message blocks remain active.
2. Copy the web patch files into the TENH project, keeping their paths, then deploy the application normally. The patch includes the earlier unique-key header fix.
3. Extract `TENH-Companion-1.2.28.zip`. For an existing unpacked extension, replace the files inside its current folder, then click **Reload** for TENH in `chrome://extensions`. If installing unpacked for the first time, enable Developer mode and choose **Load unpacked**, selecting the folder containing `manifest.json`; disable any older TENH extension so only one instance runs.
4. Refresh both TENH and Business Suite tabs. Check that the extension shows version **1.2.28** and is connected. Existing unpacked-install pairing and Facebook cookies are preserved; a new extension installation may need pairing.

The SQL migration must precede the web deployment. TENH keeps enforcing existing message blocks if the mode column is missing, and refuses new moderation operations until the migration is applied.

## What changed

- The extension ignores the old `facebookNavigationCacheV1`. That cache could persist a last-opened Facebook thread against the wrong customer for seven days.
- The current authorized Meta conversation link wins over an older cached destination. Persistent navigation entries are bound to the Page, customer PSID, and provider route, and expire after seven days. Only IDs returned directly in the participant-verified provider link are persisted.
- A legacy provider-link redirect is accepted for the current click only after two consistent reads of a matching customer card and profile link in the loaded Facebook document. An address-bar or pending URL alone cannot identify the customer. Redirect observations are not saved as durable customer mappings, including during public-profile lookup.
- When Facebook's current layout does not expose a verifiable customer card, the provider link can still open, but TENH explicitly says the exact customer selection could not be verified. Select the customer manually in that case. No PSID is invented as a Business Suite thread ID, and no customer is selected by searching their name.
- **Other** now shows **View this conversation**, **Files, documents & links**, **Block user**, and **Report spam** for Facebook Messenger conversations. The view action uses the same Companion shortcut as the header.
- **Block user** opens a Stop communication dialog with the two requested choices. Choose an option, click **Next**, review the customer and Page, then confirm. Cancel and Escape make no API request. The block status changes only after a positive Meta response and successful local persistence.
- The API distinguishes a Messenger message block from a Facebook Page ban. Removing a Page ban also requests message unblocking. A messages-only request cannot silently downgrade a recorded Page ban.

There is no reason from this code diagnosis to clear Facebook cookies. Version 1.2.28 invalidates the unsafe navigation cache automatically. Facebook can still redirect an unavailable provider link or require sign-in; the fallback notice is intentional.

## Blocking API

Authenticated TENH route: `GET` / `POST /api/conversations/{conversationId}/facebook-block`.

GET returns `success`, `available`, `modesAvailable`, and `state`. State includes `is_blocked` and `block_mode` (`messages` or `page`). These are the last provider-confirmed changes made through TENH; changes made separately in Business Suite are not automatically discovered by this endpoint.

POST uses the signed-in TENH session, workspace/conversation access, and the `customers/manage` permission. The browser sends no Page token. The server resolves the Page and recipient from the authorized conversation.

| Intent | JSON body | Meta actions |
| --- | --- | --- |
| Block messages and calls | `{"blocked":true,"mode":"messages"}` | `BLOCK_USER` |
| Ban from this Page and Messenger | `{"blocked":true,"mode":"page"}` | `BAN_USER` |
| Unblock messages | `{"blocked":false,"mode":"messages"}` | `UNBLOCK_USER` |
| Remove Page ban and unblock messages | `{"blocked":false,"mode":"page"}` | `UNBAN_USER`, `UNBLOCK_USER` |

Existing callers may omit `mode`: blocking defaults to `messages`; unblocking uses the stored scope. The provider request is `POST /{page-id}/moderate_conversations`, with a server-held Page token, `user_ids: [{"id":"<authorized-PSID>"}]`, and the action list above. The endpoint, parameter types, and action values are defined in [Meta's official Business SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py).

A short lease prevents concurrent agents from sending conflicting operations. Permission errors, token errors, uncertain responses, and local-save failures remain visible. If Meta confirms a change but saving fails, the response identifies `providerConfirmed`, `requestedBlocked`, and `requestedMode`; retry that same action after resolving the storage issue. Never interpret HTTP 200 alone as provider confirmation.

## Verify after deployment

- Alternate between two customers on the same Page, including a previously misrouted conversation. Use **View this conversation** and check the visible customer heading in Business Suite. Repeat with a different Page. The extension must not blindly reuse `1031384773402503` for unrelated customers.
- Open Block user and cancel: no customer status should change. With a designated test customer, complete a message block, check it in Business Suite, and unblock. Repeat for the Page-ban option if your Page/app has access.
- A Meta permission refusal should remain an error in the dialog, with no successful block state or activity recorded.
- Switch chats repeatedly: there should remain one status dropdown and one header shortcut, and an old customer's block dialog should close.

Automated verification: 535 TypeScript/TSX files checked with zero diagnostics. The route, actual React dialog, customer switching, old-schema enforcement, provider errors, extension cache/redirect behavior, and existing profile/source/live-message regressions passed local tests. The provider and Chrome APIs were mocked for automation. No real customer was blocked, no production database was migrated, and no deployment or live Meta permission validation was performed here.
