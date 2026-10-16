# Subscription list payment entries

The Owned and joined subscriptions section keeps current subscriptions separate from requested purchases. Payment rows show the saved plan/term, amount/currency and exact-attempt link. Current plan limits and paid expiry still come from the workspace subscription response.

Only the authenticated user's latest active memberships with Billing Manage can return private payment summaries. Prepared manual uploads additionally require the initiating membership. The browser checks response user identity and membership IDs, aborts obsolete reads and clears private rows on auth changes. The summary endpoint is read-only and returns no proof paths, QR payloads or provider credentials.

## Expiry and resolution

- Bakong uses its stored `expires_at`. A server-time anchor and elapsed monotonic time drive the countdown. Refresh never creates a new deadline. Expiry hides only the pending row; it never changes payment status or invokes cancellation.
- Submitted manual requests show **Submitted for review**, without a countdown. They remain until the server records resolution. Prepared manual uploads have no stored expiry and receive no invented timer.
- PayWay currently sends a five-minute lifetime to the provider but does not persist `expires_at`. Its pending row therefore has no countdown or locally inferred expiry. Continue payment opens the existing transaction's status/confirmation flow; this change cannot reconstruct an unsaved provider checkout form.
- Explicit server-recorded provider review or cancellation reconciliation remains visible without a countdown. Cancellation controls and their confirmation dialogs are preserved.
- Saved payment state is read before obtaining a fresh workspace snapshot. Background reads run at most twenty times at thirty-second intervals while visible and online. Focus, reconnect and Refresh can recheck afterward. These reads never verify a provider transaction or consume Bakong inquiry reservations.

## Separate unresolved-purchase issue

An expired pending attempt can still hold the existing backend purchase guard and block another purchase. Hiding its row does **not** release that guard, cancel the payment, delete proof/history, or prove that no money arrived. Existing Billing history, payment-status and admin reconciliation paths retain the saved records. Resolving this purchase blocker requires separate recovery work.

## Rollout dependency

The concurrent cancellation work added a `payment_cancellations` read to the summary endpoint. Its separately reviewed migration, `20261016083154_payment_cancellation_safety.sql`, must be installed before deploying these combined callers. Missing or unreadable cancellation state fails closed: payment summaries show a retryable error while current subscriptions remain available. This display task does not apply that migration or change cancellation/verification/activation rules.

## Verification

- 45 isolated tests passed across `subscription-pending-payments`, `subscription-overview-payment-state`, `billing-payment-attempt`, and `payment-cancellation{,-ui,-sql}`. Fixtures use mocked HTTP, real React/JSDOM, fake elapsed time and isolated PGlite; no hosted writes or provider requests.
- TypeScript: `tsc --noEmit --incremental false` passed. Scoped ESLint and `git diff --check` passed.
- Browser fixture: English and Khmer at 390, 768, 1024 and 1440px. All eight cases kept active and payment rows visible without horizontal overflow; resume links remained at least 44px high. Review had no timer, and Joined/Owned filtering and restoration worked. Browser console reported no errors in the inspected Khmer fixture. This is local fixture verification, not authenticated production or physical-device certification.
- No full application build, hosted migration, commit, push or deployment was performed for this display task.
