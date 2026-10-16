# Payment cancellation

This is a local implementation and forward migration draft. No production migration, provider operation or deployment has been performed.

## Provider limits

- **ABA PayWay:** a durable database claim precedes verification and the existing signed Close Transaction request. Only a confirmed close can finish cancellation. PROCESSING, conflicting evidence, timeouts and lost acknowledgements remain for reconciliation. Browser cancel-return GETs only navigate; they cannot authorize cancellation.
- **Bakong KHQR:** the provider adapter has inquiries, not a QR-revocation operation. Checkout lifecycle is separate from settlement (`20261016093000_bakong_checkout_lifecycle.sql`). A checkout is *open* until its server-set `expires_at` (15 minutes, never extended), or until the customer cancels it (`payment_cancellations.outcome = 'checkout_closed'`, with actor, time and reason). A closed or expired unpaid checkout hides its QR and stops blocking new purchases. Selecting a plan again always issues a new attempt, reference and QR; a closed purchase intent is rejected with `CHECKOUT_CLOSED`. The billing row stays `pending` (settlement unknown) with all evidence. A saved QR may still receive a transfer: a confirmation after cancellation or after expiry goes to review and never activates automatically. Received or disputed funds (`verified`/`review`) still block a new purchase until reviewed. Unused inquiry reservations are released one hour after QR expiry. Used requests and the three-inquiry lifetime cap are never reset.
- **Manual:** a prepared upload can be aborted without deleting its bytes or ticket. Submitted proof requires **Withdraw proof**. Withdrawal stops the ordinary approval flow, retains the proof/request and blocks another checkout pending billing reconciliation. It does not prove that no bank transfer occurred.

No cancellation reverses a bank transfer or invalidates a saved bank QR. No inquiry-call records are deleted or refunded. Uncertain KHQR reservations are deliberately retained.

## Required migration and rollout

`db/migrations/20261016083154_payment_cancellation_safety.sql` adds a service-only cancellation ledger/RPCs and checkout/late-settlement guards. Apply it only through a separately reviewed production rollout, before deploying these callers. Reads and cancellation fail closed when that schema is unavailable.

Review the installed manual lifecycle, billing compatibility/application-baseline and Bakong RPC/trigger versions against the migration dependencies. Fence/drain billing writers during installation and verify service-only ACLs. The new table has RLS, no client grants and no direct service-role mutation grants. Cancellation identity/timestamps are retained independently of workspace/member deletion. Subscription rows and proof records are not changed/deleted by confirmed cancellation.

The existing finalizers remain authoritative. If confirmation wins, cancellation cannot overwrite approval. If cancellation wins, a late PayWay approval is retained in the existing recovery queue, updates the cancellation to reconciliation-required and cannot reapply entitlement. Unresolved cancellation/withdrawal records block cross-provider checkout creation under the subscription lock.

Uncertain requests and submitted withdrawals intentionally have **no automatic retry/unblock**. Existing operator recovery evidence plus the new ledger must be reviewed together. A refund/settlement decision and an audited operator resolution procedure are required before releasing such a block; this patch does not invent a bank cancellation or a generic “mark unpaid” override.

## Local verification

- `node --test tests/payment-cancellation.test.cjs tests/payment-cancellation-ui.test.cjs tests/payment-cancellation-sql.test.cjs tests/subscription-pending-payments.test.cjs`
- `node tests/payment-cancellation-browser.cjs` uses only synthetic loopback responses. It checks English/Khmer at 360/390/768/820/1024/1440px, a short landscape screen and CSS 200% zoom; it saves synthetic-fixture screenshots under `docs/evidence/payment-cancellation-20261016`.
- Existing temporary JSDOM/PGlite and bundled Playwright installations are used; no package/lockfile changes. Set `NODE_PATH` to the existing local JSDOM installation if needed. `TENH_PGLITE_MODULE`, `TENH_PLAYWRIGHT_MODULE` and `TENH_BROWSER_EXECUTABLE` can select other existing local test runtimes.

SQL tests execute the real migration against isolated PGlite/PostgreSQL with synthetic provider data. They cover both confirmation/cancellation orderings, replay, expiry, withdrawal, permissions, retained proof, budget evidence and checkout blocking. They do **not** prove simultaneous independent-session concurrency on the production PostgreSQL version. Native multi-session and provider sandbox certification remain rollout checks; no real tokens or payments are used here.

## Files changed for this request

- Server: `app/api/subscription/cancel-payment/route.ts`, `app/api/subscription/pending-payments/route.ts`, `app/api/subscription/payment-status/route.ts`, `app/api/payway/cancel-return/route.ts`, `lib/billing/cancel-payment.ts`, `lib/billing/subscription-pending-payments.ts`, `lib/bakong/payments.ts`, `lib/payway/close-transaction.ts`.
- UI: `components/subscription/cancel-payment-button.tsx`, `subscription-membership-list.tsx`, `payment-attempt-view.tsx`, `bakong-payment-view.tsx`, and the explicit confirmation flag in `subscription-payment-view.tsx` (all under the same component directory).
- Schema: the forward migration above. Tests: `tests/payment-cancellation{,-ui,-sql}.test.cjs`, `tests/payment-cancellation-browser.cjs`, and focused fixture/assertion updates in `bakong-api`, `billing-payment-attempt`, `subscription-pending-payments`, `payway-cross-provider-recovery` and `payway-return` tests. Screenshots are synthetic fixture evidence, not live workspace data.

Existing uncommitted subscription/expiry/page work was retained. Other modified files in the working tree are not part of this request's change list.
