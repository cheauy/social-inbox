# PayWay checkout lifecycle — local review, 2026-10-17

> Follow-up: the primary-folder integration and later UI clarifications supersede the Buy auto-start, visible detail headings, and navigation/clock behavior described below. See [the current primary report](local-primary-integration-20261017.md).

Base: `0361e3579f3db62d516145a338f51668580a06a1` (verified fetched main).
Branch: `fix-payway-popup-lifecycle`.
Worktree: `C:/Users/TUF/AppData/Local/Temp/tenh-payway-popup-20261017`.
Primary checkout edits and the separate Inbox/avatar work were not copied or modified.

## Findings and resulting behavior

- The exact authorized read of PayWay transaction `1792228756496474454` in CHAT found **pending**, USD13.00, saved environment **sandbox**, `live_enabled=false`, created `2026-10-17 09:19:16.622657+00`. There is no saved expiry or lifetime. That record was not changed. This is evidence about that transaction, not a claim about the current global production configuration.
- The former persistent checking heading came from saved pending status. A provider popup close never proved payment cancellation. The existing GET cancellation-return route was already navigation-only; it now carries `payway=closed` for presentation. The status view also observes the provider's own mounted iframe disappearing or being hidden. These signals show **Checkout closed**, retain the saved reference and uncertainty, and never fabricate cancelled/unpaid/paid state.
- The top-right countdown and 44px accessible X share a flex header. Payment details are inside the same card, the duplicate Back link is removed, and genuine sandbox status is a concise indicator within details. Production attempts have no test indicator. Manual submitted proof remains Under review and has no PayWay deadline.
- Official current Purchase documentation supports lifetime in minutes, minimum three minutes, maximum thirty days: https://developer.payway.com.kh/purchase-14530820e0 . New requests sign `lifetime=10`. The official plugin contract was inspected as static JavaScript only: https://checkout.payway.com.kh/plugins/checkout2-0.js and its static checkout runtime. No bank transaction API was called.
- New checkouts save version, lifetime, server preparation timestamp and deadline once in existing `billing_transactions.metadata`; the saved-state DTO returns the validated deadline and server time. The TENH checkout window is ten minutes from server preparation; the signed PayWay provider lifetime is ten minutes. Reload/reopen cannot reset or extend it. Existing records are not backfilled. A versioned earlier lifetime is respected; legacy attempts without a saved lifetime get an honest fallback.
- At the deadline the view begins closing checkout, completes any verification already in flight, and makes one final saved-state GET before replacing the route with `/dashboard/subscription`. Any observed approved result takes precedence, including activation still pending, and a confirmed active payment stays on success. An existing verification is bounded by its 30-second timeout and the final saved read by ten seconds; this intentionally allows a boundary result to resolve before navigation. There is one replacement per mounted identity. Closure makes no cancellation, provider-close, subscription or receipt mutation. Late settlement/reconciliation remains available through the existing server paths and history.
- Buy on fixed and custom subscriptions keeps workspace preparation and existing-payment discovery on a disabled button with a spinner. It reuses the existing authorized discovery and guarded creation paths, then opens the provider's inline iframe (no `window.open` popup-blocker workaround). The same original attempt resumes if discovered or returned by a concurrent POST conflict. Failures stay near Buy. A known created workspace is reused on later preflight/plugin failure. Manual bank transfer remains selectable and follows the same discovery. Direct links retain a centered preparation shell. Navigation/unmount and auth changes invalidate delayed work.

## Local validation

`node --require ./.codex/bakong-test-lf.cjs --test` was run against:

- tests/buy-checkout-preflight.test.cjs
- tests/payment-status-ui.test.cjs
- tests/payment-success.test.cjs
- tests/payway-popup-return.test.cjs
- tests/billing-payment-attempt.test.cjs
- tests/payway-pending-preservation.test.cjs
- tests/payway-return.test.cjs
- tests/payway-safety.test.cjs
- tests/bakong-checkout-summary.test.cjs
- tests/bakong-expiry.test.cjs
- tests/bakong-popup.test.cjs
- tests/bakong-auto-check.test.cjs
- tests/manual-payment-attempts.test.cjs
- tests/subscription-pending-payments.test.cjs
- tests/payway-application-baseline.test.cjs

Result: **206 passed, zero failed**. The optional embedded PostgreSQL dependency was enabled. The existing LF shim only normalizes SQL fixture reads in memory for Windows line endings; SQL sources and hosted data were unchanged.

Coverage includes the exact deadline, in-flight pending verification, approval during verification or final-read boundaries, timer/abort cleanup, elapsed time after reload, expired links without provider inquiry, one-time replacement, old deadline fallback, provider-close presentation, bounded provider checks, manual review, duplicate Buy clicks, discovery failure/retry, existing/expired/paid attempts, conflict after discovery, sign-out, navigation failure, manual selection, and local late-settlement/application guards.

Type check: `node node_modules/typescript/bin/tsc --noEmit --incremental false` — passed.
Changed-source/test ESLint: zero errors; eight existing warnings (image elements, unused CalendarIcon and an existing translation-effect dependency). `git diff --check` passed.

Mocked headless Chrome exercises English and Khmer at 390, 768, 1024 and 1440px, including reduced motion and countdown/X spacing. **780 assertions passed across eight cases**, with zero browser runtime errors or external requests. Evidence lives at `docs/evidence/payway-popup-20261017/browser/`; the final `browser-results.json` is the authoritative pass/count summary. No real provider transfers or payment bytes are sent by that fixture. Representative phone and desktop screenshots were inspected locally.

Logs: `.codex/payway-popup-regressions.txt`, `.codex/payway-popup-types.txt`, `.codex/payway-popup-lint.txt`, `.codex/payway-popup-browser.txt`.

## Changed product files

- app/api/manual-payments/route.ts — authorized read-only PayWay attempt discovery during checkout preflight.
- app/api/payway/cancel-return/route.ts — presentation-only provider-close hint.
- app/api/payway/checkout/route.ts — signed ten-minute lifetime and persisted deadline.
- app/dashboard/subscription/payment/page.tsx — closed hint reaches saved-attempt view.
- components/subscription/buy-subscription-view.tsx — fixed-plan Buy preflight on button and retained method choice.
- components/subscription/custom-subscription-builder.tsx — shared custom Buy preflight.
- components/subscription/use-buy-checkout.tsx — shared preparation/session/retry boundary.
- components/subscription/subscription-payment-view.tsx — reused guarded flow, abort-safe provider start and direct-link preparation shell.
- components/subscription/payment-attempt-view.tsx — clock, expiry race handling, close state and card layout.
- lib/billing/payment-attempt.ts — safe saved deadline/server-time DTO fields.
- lib/payway/checkout-lifetime.ts — saved lifetime validation and new ten-minute contract.

Tests changed/added: `tests/billing-payment-attempt.test.cjs`, `tests/buy-checkout-preflight.test.cjs`, `tests/fixtures/payment-attempt-browser.entry.cjs`, `tests/manual-payment-attempts.test.cjs`, `tests/payment-attempt-browser.cjs`, `tests/payment-status-ui.test.cjs`, `tests/payment-success.test.cjs`, `tests/payway-pending-preservation.test.cjs`, `tests/payway-popup-return.test.cjs`. Existing payment fixtures now provide a stable router object so effects represent Next's stable router.

## Publication and remaining action

This is a local change only. No push, deployment, production settings, credentials, hosted schema, security policy, payment, refund, provider inquiry, close request or data purge was performed. No migration or environment-flag change is required for this patch. Production adoption requires independent review and explicit approval to publish/deploy this code branch; it does not change the existing sandbox/live configuration or retroactively assign deadlines to old records. There are no execution blockers.


## Latest local scope: PayWay QR dismissal ends checkout (2026-10-17)

The latest user clarification supersedes the earlier dismiss-only and QR-resume proposals. Closing the classic PayWay QR window, receiving its closed browser-return hint, or pressing the card's Cancel ends the TENH checkout session through the authenticated, same-origin checkout-session endpoint. It persists only the existing `checkout_session` metadata boundary. Financial status, settlement evidence, immutable transaction identity, access, invoices and late verification remain intact. No provider Close, refund, cancellation API or replacement Purchase is sent by dismissal.

The close path waits for an in-flight saved read or verification. Already verified payment wins. A failed or lost close response triggers an exact-attempt saved-state reread; the UI says closure is unconfirmed until the backend confirms it, and offers retry. Confirmed closure returns with a full document replacement so the provider iframe and scroll lock are removed. Closed unpaid rows are absent from customer active Pending and Billing history, including a later failed inquiry. Received/refunded money, reconciliation and later issued receipts remain available. Manual Submitted review and the separate manual QR lightbox are unchanged.

The bottom PayWay card retains Cancel. Its former Open/Show QR action is replaced with a spinner and exact English text “Checking payment automatically…”. This appears only while automatic checking is active, including its bounded scheduled checks; it disappears on offline/hidden pause, exhausted checks, error, close, expiry and terminal results. There is no payable QR reopening after closure.

The in-progress provider-issued QR URL integration was removed after this clarification: no JSON Purchase transport, saved URL helper, iframe dialog, auto-show query flag, or resume DTO field is included. Classic PayWay creation remains byte-equivalent to current main. Existing financial duplicate-purchase guards remain enforced: closing TENH presentation does not prove the provider transaction unpaid or authorize a second financial attempt in the same workspace.

Validation evidence: `C:/Users/TUF/AppData/Local/Temp/tenh-payway-resume-20261017/`. Focused suite after independent-review fixes: 120 passes; local embedded PostgreSQL application/late-settlement suite: 9 passes; final status suite and browser checkpoint recorded beside `close-review-checkpoint.json`. Eight EN/KM browser cases at 390/768/1024/1440 cover automatic checking, closure failure, actual QR dismissal, Cancel, expiry, frame/scroll cleanup and preserved manual flow. Browser requests are entirely loopback/mocked. The fixture waits for the Buy parent render before asserting its bounded scroll container.

Implementation files for this latest phase: `components/subscription/payment-attempt-view.tsx`, `app/api/subscription/billing-history/route.ts`; supporting checkout-session/lifetime/status/pending DTO work remains in the earlier local integration. Tests: `tests/payment-status-ui.test.cjs`, `tests/billing-receipts-server.test.cjs`, `tests/fixtures/payment-attempt-browser.entry.cjs`, `tests/payment-attempt-browser.cjs`, plus existing route, pending, Buy, manual and local database checks.

Local only. No commit, push, deployment, hosted write, environment change, credential removal, schema/security change, financial payment/refund or provider transaction request occurred. The direct Bakong retirement was already deployed in `0361e35`; no further production flag change is needed for this local UI/session patch. Publishing the accumulated primary edits remains a separate approval/review step.


Independent-review fixes: the provider observer now follows desktop `#aba-checkout` and the actual sibling mobile `#aba_checkout_sheet #aba_checkout_app` iframe, including ancestor display/visibility/ARIA/hidden state. It requires a visible provider presentation before treating hiding/removal as closure. Regression covers hidden initialization and three mobile close paths. Billing history now pages deterministically by created timestamp and ID until it finds 300 visible PayWay rows or exhausts the source, scanning at most ten pages of 300 rows. An exhausted scan bound returns an explicit unavailable response, never a falsely complete empty/partial list. Regression covers 610 hidden newer failures before a valid older paid receipt, and explicit failure after 3,000 hidden rows. The shared in-memory query harness models range offsets; no database schema changed. Final review evidence uses the `close-review-fix-*` logs and browser folder.

Final review browser: **8 English/Khmer cases, 1,120 assertions**, zero browser errors and external requests, `close-review-fix-browser/browser-results.json`. Latest status regression also covers pending/processing/draft/created QR dismissal; every closure preserves the original financial status. Final focused and type logs: `close-checkpoint-tests.txt` and `close-checkpoint-types.txt`.
