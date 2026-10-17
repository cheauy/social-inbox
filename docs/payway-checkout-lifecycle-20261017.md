# PayWay checkout lifecycle — local review, 2026-10-17

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
