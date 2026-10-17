Checkout redesign — local verification, October 17, 2026

Updated the checkout presentation using existing plan calculations and payment handlers. Desktop has methods on the left and the summary/checkout on the right; tablet/mobile place the summary first and actions below the methods. The action area stays in normal flow on short screens to avoid covering content.

Added submitted-payment help, the configured TENH support destination, exact saved customer-reference copying and a permission-checked in-page receipt preview. Receipt URLs are signed for 60 seconds after active membership and billing-manage authorization, using only the persisted payment's proof. No client-supplied storage path is accepted. The receipt read does not change payment status.

Files touched for this task:

- [Checkout presentation](C:/Users/TUF/social-inbox/components/subscription/subscription-payment-view.tsx:1169)
- [Submitted-payment integration](C:/Users/TUF/social-inbox/components/subscription/payment-attempt-view.tsx:461)
- [Submitted-payment help and preview](C:/Users/TUF/social-inbox/components/subscription/submitted-payment-help.tsx:8)
- [Shared dialog keyboard handling](C:/Users/TUF/social-inbox/components/subscription/checkout-dialog.tsx:30)
- [Authorized receipt read](C:/Users/TUF/social-inbox/app/api/subscription/payment-status/route.ts:64)
- [Manual dialog tests](C:/Users/TUF/social-inbox/tests/manual-checkout-dialog.test.cjs)
- [Buy preflight tests](C:/Users/TUF/social-inbox/tests/buy-checkout-preflight.test.cjs)
- [Payment status fixture](C:/Users/TUF/social-inbox/tests/payment-status-ui.test.cjs)
- [Receipt authorization tests](C:/Users/TUF/social-inbox/tests/billing-payment-attempt.test.cjs)
- [Responsive browser fixture](C:/Users/TUF/social-inbox/tests/manual-qr-browser.cjs)
- Screenshots and this report in this directory.

The existing modified buy-subscription-view.tsx was preserved. Other active-chat changes, including customer-reference APIs/components and their migration, were preserved and coordinated. Those changes are not claimed as part of this redesign.

| Check | Result |
| --- | --- |
| Four focused node suites | 78 passed, 0 failed |
| Browser fixture | 12 passed: English/Khmer at 360, 390, 768, 820, 1024, 1440px |
| Short landscape | Both languages, 740 × 320 |
| Enlarged layout | 2× CSS zoom at 1440px; no horizontal overflow |
| Manual flow | Receipt/note preserved, upload/finalize errors and retries, duplicate submission prevention, authoritative submitted status |
| Preview interactions | Repeated QR/receipt opening, Escape/close, focus return, scroll locking, receipt fetch failure/retry, duplicate preview clicks and dismissal during pending read |
| Selection | Native radio keyboard navigation without submitting or creating payment |
| Receipt permissions | Signed-out, outsider, denied manage permission, wrong workspace/bucket, unsupported MIME and ambiguous query rejected |
| Existing PayWay lifecycle suites | Server-confirmed close, automatic-checking states, expiry and confirmation races remain covered |
| TypeScript | Passed: npx tsc --noEmit |
| Production build | Passed: npm run build (Next.js webpack) |
| Focused ESLint | 0 errors, 6 warnings (image elements and an existing effect dependency warning) |
| Full repository lint | Failed: 1,167 errors, 175 warnings across the shared repository |
| git diff --check | Passed; Git reports LF/CRLF conversion notices |

Screenshots are from real components in a loopback-only fixture with synthetic payment state and a QR marked NOT FOR PAYMENT. They are not authenticated production screenshots.

Screenshots: checkout-1440.png, checkout-768.png, checkout-390.png; manual/preview screenshots at the same widths; receipt-390.png.

Unverified limits: no real provider, bank transfer, hosted receipt or account was used. Physical mobile keyboards, screen-reader output and native PDF rendering on mobile were not verified. CSS zoom is an enlarged-layout check, not browser-menu zoom. The concurrent customer-reference feature requires its separately prepared database migration for customer references to be available; Copy reference stays disabled when that saved reference is unavailable.

No commit, push, deployment, hosted settings change, migration application or real payment was performed by this task.
