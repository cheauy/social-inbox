# Subscription payment flow — local implementation review

Target: TENH CHAT, `C:\Users\TUF\social-inbox`, HEAD `140151e` plus the existing working changes. This is local implementation evidence, not production verification. Unrelated admin, integrations and settings changes were preserved. POS was read only. No hosted SQL, payments, approval/rejection actions, callback replays, credential changes, commits, pushes or deployment were performed for this task.

## Root causes and changes

| Root cause | Change |
| --- | --- |
| Manual submission updated only one panel; method switching could hide its pending state. | Committed or uncertain submission replaces checkout with an exact-attempt status view. No QR, upload form, method switch or payment action remains on a submitted attempt. Validation errors stay on the entry form. |
| Recovery and polling selected the workspace's latest manual payment, including historical approvals. | Canonical `manual_request` / `tran_id` links restore the exact saved attempt before new-purchase quoting. Checkout discovery returns unresolved attempts only. Initial load, submission recovery and polling use the same authorized status resolver. |
| URL success hints and historical approval were treated as activation. | Removed query-only success claims and legacy overview payment polls. Payment outcome, saved receipt evidence and matching current entitlement are separate. Missing/conflicting application evidence requires review. Expired or superseded coverage remains historical. |
| Approval redirects lost the purchased workspace; reads changed the selected workspace. | Web verification pins the actual purchase workspace and preserves the current selection. Explicit Continue uses the existing authorized workspace-switch API, which rechecks membership and current access. Receipt actions retain the active-owner policy. |
| Old asynchronous requests and polls could update a newer view. | Identity-keyed components, session invalidation, synchronous response epochs, aborts, sequential polling, bounded backoff, offline/hidden-tab pauses and explicit Check status. Terminal states stop automatic polling; explicit PayWay checking can reconcile late payment through secure server verification. |
| Manual preparation had no durable server binding; uncertain commits and cleanup were unsafe. | A private prepared-upload ledger binds the request ID, initiating member, exact path, file metadata and saved quote. Retrying reuses the original attempt. Transactional finalization and abort inspect saved state under the subscription/attempt locks. Uncertain responses reconcile by ID; proof is preserved. Verified existing proof skips signing and re-upload. |
| Retrying checkout could close and replace an unresolved PayWay purchase. | Pending purchases return their existing identifier. No automatic closure/supersession occurs. Cross-provider pending claims serialize in the proposed database migration. |
| Captured normal-plan activation could overwrite a newer subscription after a late payment. | A companion migration captures an immutable server-read subscription baseline at preparation. Approval compares it under the subscription lock before the existing activation body can mutate entitlement. Missing/changed baselines and terminal-source conflicts require recovery; reviewed legacy authorization remains separate. Readiness gates fail closed if these guards are absent. |

Customer-facing copy is short and supports English and Khmer. Sandbox remains labelled as a test, unknown evidence does not imply confirmed settlement, and issued documents remain TENH receipts. No pricing, duration, capacity, proration, trial, renewal or settlement rules were copied from POS.

## Changed implementation files

- `components/subscription/payment-attempt-view.tsx` — canonical status, recovery, scoped verification and explicit Continue.
- `components/subscription/subscription-payment-view.tsx` — attempt transition, duplicate-click protection, discovery, lost-response handling and file recovery; preserves its pre-existing edits.
- `components/subscription/subscription-view.tsx` — removes obsolete payment effects and query-only success claims; routes exact returns to status.
- `app/dashboard/subscription/payment/page.tsx` — exact-attempt entry before quote/lifecycle logic; restores unresolved purchases.
- `app/api/subscription/payment-status/route.ts` and `lib/billing/payment-attempt.ts` — authorized read-only resolver and conservative application classification.
- `app/api/manual-payments/route.ts` — prepare/resume/finalize/abort lifecycle and compatible native reads.
- `app/api/manual-payments/admin/route.ts` — application readiness, returned-request validation and concurrent notification deduplication.
- `app/api/payway/status/route.ts` — explicit POST verification with optional workspace pin/selection preservation; existing native GET defaults retained.
- `app/api/payway/checkout/route.ts` and `lib/payway/pending-checkout-policy.ts` — preserve unresolved purchases and require installed application guards.
- `lib/payway/finalize-payment.ts` — preserve verified evidence for recovery when application guards are unavailable and validate activation identity.
- `db/migrations/20261015104508_manual_payment_upload_lifecycle.sql` — review-only prepared uploads and cross-provider pending-claim serialization.
- `db/migrations/20261015113000_payment_application_baselines.sql` — review-only immutable application baselines and atomic approval guard.

Regression files: `tests/billing-payment-attempt.test.cjs`, `tests/manual-payment-attempts.test.cjs`, `tests/payway-application-baseline.test.cjs`, `tests/subscription-overview-payment-state.test.cjs`, `tests/payway-return.test.cjs`, `tests/payway-pending-preservation.test.cjs`, `tests/payway-safety.test.cjs`, `tests/payway-strict-workspace.test.cjs`, `tests/payway-cross-provider-recovery.test.cjs`, `tests/payment-attempt-browser.cjs`, and `tests/fixtures/payment-attempt-browser.entry.cjs`.

## POS reference

Read the supplied archive and matching manifest from `C:\Users\TUF\.codex\visualizations\2026\10\10\01a1268f-34bc-7202-b10f-229457b02d6e`; its SHA-256 matches the manifest. Adopted exact order/transaction/workspace binding, saved provider context, secure provider verification, distinct submission/approval/application and duplicate-payment protection.

CHAT deliberately leaves payment entry immediately after committed proof, uses an accurate status heading, and offers explicit Continue without a mandatory countdown. It does not copy POS's stale Checkout heading, ten-minute timer, scheduling rules, product math, schemas or RPC names. The archive excludes database definitions and therefore provides no evidence of database atomicity.

## Verification

See `docs/evidence/payment-attempt-20261015/checks.json` for final commands/counts and `browser/browser-results.json` for responsive browser assertions/screenshots. Tests use synthetic records, mocked transports and local embedded PostgreSQL; no real payment or customer proof was used.

The SQL tests exercise captured activation/invoice bodies, successful application and replay, stale preparation, changed subscription/cancellation/expiry, missing baselines, source rollback on invoice failure, private ACLs and combined migration behavior. Embedded PostgreSQL is single-connection; these tests do not prove multi-session lock contention or deadlock behavior.

## Release prerequisites and remaining limitations

1. Review the actual installed billing coexistence functions, triggers, ownership and fingerprints against the captured definitions used by the fixtures. The baseline draft requires `tenh_compat_subscription_identity`, `tenh_legacy_approval_authorized` and the existing private billing audit/recovery infrastructure. No hosted inspection/application was performed for this task.
2. Obtain separate migration/release approval. Fence and drain billing writers/callbacks, install the manual-upload lifecycle draft first and the application-baseline draft second, verify service-only access and guard readiness, then deploy the matching callers together. Until that order is complete, readiness checks intentionally block new purchases/approval instead of applying unsafely.
3. Reconcile pre-existing unresolved purchases separately. Old prepared tickets or pending payments without an original baseline require review; do not fabricate their original baseline from today's subscription or mass-backfill historical approvals. Already-approved history and receipt reads remain available. A harmless intervening subscription change may conservatively require review as well.
4. Retain additive tables/guards and proof objects during rollback. Do not drop the ledger, weaken authorization, delete historical orphan proof, or restore old unsafe finalization as a rollback shortcut. Prepared uploads remain recoverable and can be explicitly cancelled before submission; signing expiry does not prove non-payment.
5. Run isolated multi-session PostgreSQL contention tests before release. No local `postgres`, `initdb` or `psql` executable was available. Native mock/SQL compatibility tests run here cannot establish physical native-app runtime behavior.
6. The existing recovery projection does not expose every later operator-resolution event. Some resolved historical conflicts can conservatively remain in review. Current subscriptions also lack a direct source-payment pointer; ambiguous application attribution stays historical/review rather than asserting active access. There is no supported scheduled-purchase feature in current CHAT, so future dates do not invent one.
7. Browser flows, authentication changes, provider responses and navigation failures were mocked. Live PayWay, hosted SQL/RLS, real callbacks, physical devices and deployed behavior remain unverified. No production egress saving is claimed.
