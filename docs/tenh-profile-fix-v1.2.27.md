# TENH Facebook global-id / direct profile upgrade — Companion 1.2.27

This patch upgrades the existing TENH web code and TENH Companion from the supplied 1.2.26 package. It does not add a new app, database, login, webhook, or external service.

## What changed

### 1. Messenger PSID is no longer used as Business Suite `selected_item_id`

TENH still keeps the Page-scoped Messenger customer ID (PSID) for normal Messenger API send/receive. For the explicit **Open in Meta Business Suite** action, the backend now asks Meta for the exact Page/customer conversation link first.

If Meta's provider-returned link already contains a Business Suite `selected_item_id`, TENH treats that as a separate navigation/global id only after the Page and both conversation participants have matched exactly.

If the provider link is a legacy/Page-inbox route, the Companion may load that exact provider link in a disposable inactive tab and observe Meta's redirect to Business Suite. When that redirect exposes a different `selected_item_id`, the Companion caches that Page+PSID → navigation-id mapping for seven days.

The direct URL format generated after a navigation id is known is:

```
https://business.facebook.com/latest/inbox/all
?asset_id=<PAGE_ID>
&nav_ref=diode_page_inbox
&mailbox_id=
&selected_item_id=<META_NAVIGATION_ID>
&thread_type=FB_MESSAGE
```

TENH does not put the PSID into `selected_item_id` anymore. If no exact provider link/global id can be verified, TENH opens only the correct Page inbox instead of pretending the PSID is an exact conversation id.

### 2. View Facebook Profile can use the conversation-bound global id first

For **View Facebook Profile**, Companion 1.2.27 first tries the exact conversation-bound navigation/global id when Meta exposes one. It opens the resulting Facebook profile candidate in an inactive tab and verifies the visible customer name before TENH accepts or saves the profile URL.

If that candidate is not a valid/accessibile public profile, the existing 1.2.26 fallback remains: TENH reads the explicit profile destination rendered by Facebook in the exact authorized customer conversation and verifies it before opening.

After a verified profile URL is saved in TENH, future profile clicks open it directly and no longer require the extension.

### 3. Pancake-style empty `mailbox_id` is accepted

The server and extension route validators now accept Business Suite links with:

```
mailbox_id=
```

when `asset_id` or another Page selector still matches the expected Page. This matches the valid routing style seen in Meta/Pancake links while retaining Page/thread validation.

## What did NOT change

- Messenger webhook/API messaging remains authoritative.
- Existing PSIDs are not overwritten or converted.
- No Pancake private code or undocumented GraphQL document ids were copied into TENH.
- No extension permissions were added.
- No database migration is required for this 1.2.27 patch.
- Realtime/retry/ACK/delta sync, Side Panel, Quick Replies, Tags, Telegram, group chat, stickers and other unrelated features are unchanged by this patch.

## Install

1. Back up or commit your current project.
2. Merge the changed-files ZIP into the current TENH project root.
3. Deploy the updated website/API files first.
4. Replace/reload the existing TENH Companion extension with the complete **1.2.27** extension ZIP. Keep only one enabled TENH Companion installation.
5. Refresh TENH and Facebook/Business Suite tabs once.
6. Test with a non-production Page/customer first.

## Acceptance checks

1. Open a Messenger customer whose PSID differs from Meta's Business Suite selected item id.
2. Click **Open in Meta Business Suite**.
3. Confirm the final Business Suite URL uses the Page id for `asset_id`, an empty `mailbox_id`, and a `selected_item_id` that is not the PSID when Meta exposes a separate navigation id.
4. Click the customer's avatar in TENH.
5. Confirm the profile opens only after the extension verifies the customer name, and that TENH saves the verified profile URL for later direct opening.
6. Repeat on a second Page to confirm the Page+PSID cache never crosses Pages.

## Validation performed

- 74 focused automated tests passed with zero failures.
- Extension JavaScript syntax checks passed.
- Changed TS/TSX files passed TypeScript transpile/syntax diagnostics.
- No extension host permissions were widened.

Not verified here: live Meta account behavior, a full Next.js production build, or Chrome Web Store review. Meta can change Business Suite routing, so test the preview deployment before production.
