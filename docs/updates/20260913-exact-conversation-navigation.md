# TENH exact-conversation navigation — Companion 1.2.29

Apply this update over the previous TENH changes. No additional SQL migration is required for this patch.

## Install

1. Copy the files from `TENH-CHAT-Exact-Conversation-Fix-2026-09-13.zip` into your project, keeping their paths, and deploy the website normally.
2. Extract `TENH-Companion-1.2.29.zip` into the existing unpacked extension folder, replacing the old files. In `chrome://extensions`, click **Reload** for TENH and confirm **1.2.29**. Keep only one TENH extension enabled. The ZIP also contains the complete extension source; use it for the project's `tenh-extension/` directory if you maintain that folder separately.
3. Refresh TENH and Business Suite tabs. For an existing unpacked installation, pairing and Facebook cookies are preserved. The web button will identify a connected extension older than 1.2.29 and ask you to update it.
4. Open a TENH Facebook Messenger conversation and click **View this conversation**. Check the customer heading in the opened Facebook tab. Repeat with a previously failing customer and a customer on another Page.

## Why 1.2.28 was incomplete

The old worker could verify a legacy link in a background tab, close it, rebuild a URL from the observed ID, then navigate again. That second navigation could redirect to a different thread. Direct provider Business Suite links also returned success without checking the rendered customer.

Two regression tests reproduce these gaps against the 1.2.28 package. They pass in 1.2.29.

## Updated behavior

- The backend retains validated `bpn_id` and `nav_ref` routing parameters when Meta includes them in a participant-verified conversation link. These parameters are never hardcoded from one customer's URL for another customer. Unrelated URL parameters are removed.
- The worker opens the actual provider link in an inactive tab and waits for its loaded customer identity. It then activates that same tab without replacing its URL and verifies it again after activation.
- Direct Business Suite links receive the same displayed-customer checks. A matching address bar alone is insufficient.
- Exact provider routes can be checked using a unique matching chat header and composer when the profile panel is closed. A legacy redirect needs the matching customer card and explicit profile link. No conversation is selected by a customer-name search.
- Repeat clicks can reuse a verified open tab. The tab cache is scoped to workspace, Page, recipient, and provider route, limited to 40 entries and seven days within the browser session. Each reuse checks the live document again. A closed tab or a tab moved to a different customer is not trusted as a cached identity.
- Failed verification no longer automatically opens a default Page inbox or a potentially wrong customer as the result of **View this conversation**. If the customer changes after activation, TENH reports that verification failed. An active tab taken over by the user is not closed or redirected.
- The generic **Open Facebook** action in the extension popup remains available.
- TENH provides **Navigation details** and **Copy navigation details** when a particular customer cannot be verified. Details contain the extension version, authorized Page/customer/conversation IDs, expected customer name, and failure stage. They exclude cookies, access tokens, page HTML, and message text.

This update preserves the previous blocking dialog/API, source-card display, header key fix, and messaging behavior.

## If one customer still fails

Expand **Navigation details**, click **Copy navigation details**, and share that JSON together with the Facebook customer heading you expected to open. The URL alone cannot establish whether its `selected_item_id` belongs to TENH's selected customer.

Do not manually replace `selected_item_id` with TENH's Page-scoped Messenger recipient ID. They can be different identifiers. Clearing cookies is not part of this fix.

Facebook's layout, permissions, or provider link may still prevent verification. The extension now reports that condition rather than claiming a different thread is the intended chat. Live behavior still needs checking in your authenticated Facebook session.

## Validation

159 targeted local tests passed across navigation, provider-link normalization, profile DOM/worker behavior, passive tabs, actual React shortcut behavior, and header conversation switching. The wrong-thread regression cases include the URL structure reported in this conversation. Type checking covered 535 TypeScript/TSX files with zero diagnostics. Tests used simulated Chrome/provider APIs and DOM fixtures; no live Facebook session or production deployment was accessed.
