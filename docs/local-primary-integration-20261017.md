# Primary local integration — 2026-10-17

The working app is in `C:/Users/TUF/social-inbox`, branch `main`. Its committed baseline is `ae7908d2ffc386b14d85c0509a17a16c8445ab01`, containing released `0361e3579f3db62d516145a338f51668580a06a1`. Direct Bakong retirement was already deployed in `0361e3579f3db62d516145a338f51668580a06a1`. The later PayWay/avatar/auth/billing fixes and preserved user edits remain uncommitted in this primary folder; this follow-up did not push or deploy them.

## Latest checkout layout and manual popup follow-up

The current implementation files are stable for independent review. Direct Bakong retirement remains already deployed in `0361e357`; these subsequent local changes are unpublished.

- Removed the requested checkout introduction. Reduced the desktop maximum width from 1040px to 900px, summary column from 390px to 330px, large headings/icons and whitespace by approximately 15 percent. Readable text and minimum 44px actions remain; there is no transform-based scaling.
- ABA PayWay and Manual share one Total/Checkout footer. It is anchored to the payment-method card bottom using flex layout, with safe-area bottom padding and its own content row. It does not create a desktop viewport overlay or cover the card content.
- Manual selection keeps transfer fields out of inline checkout. Checkout opens a centered native modal containing Transfer details, Scan ABA KHQR and Upload payment receipt. Its header contains the exact requested amount/order guidance and business-day estimate. The modal has accessible labels, keyboard focus containment, Escape/Close, focus restoration and bounded responsive scrolling. QR enlargement remains inside this dialog.
- Closing before submission preserves the selected receipt/note without a provider action. Upload/finalization errors keep the popup and proof. Repeated submits share one request ID and cannot initiate a duplicate submission. Only an exact server-confirmed submitted/reviewed request closes the popup. The submitted status uses the existing centered card shell, amount and two-column details with **Payment submitted** and **Approval usually takes 1-2 business days.** It has no countdown, QR controls or paid-activation claim.
- Independent review P2 findings are fixed: prepare/upload/finalize each have a 20-second bound; uncertain-outcome recovery has a 10-second bound. A stalled stage restores retry/close controls after bounded exact-ID recovery. A storage request that cannot be aborted may finish later; retry retains the same reservation/path and the server remains authoritative. No replacement payment or financial cancellation is performed. Recovery accepts exact authoritative submitted/approved/rejected/cancelled states and routes them through the saved-state renderer; approval is never inferred.
- Existing PayWay ten-minute expiry, cancellation closure, tenant isolation, immutable amount verification, historical receipts and late settlement handling are retained. Show QR reopening remains explicitly unavailable for the existing PayWay integration.

Verification: `checkout-modal-unit-final2.txt` has **51 passing tests**, including all stage timeouts, bounded recovery, same-ID retry, lost-response approved/rejected outcomes, repeated submission, close/reopen with proof, keyboard/scroll behavior and existing PayWay expiry/cancellation. `checkout-modal-types-final.txt` passes TypeScript. `checkout-modal-lint-final2.txt` has zero errors and only existing translation-hook/image warnings. `checkout-modal-browser/browser-results.json` passed **1008 assertions in eight EN/KM responsive cases**. The final screenshot-enhanced run in `checkout-modal-preview-browser/browser-results.json` passed **1112 assertions across eight responsive cases**, with zero runtime errors or external network requests. Synthetic UI screenshots were inspected locally. No real provider or proof upload was performed.

Reference handling: the parent inspected the two new user images and relayed the exact card/footer observations used here. This Windows executor could not inspect their original pixels: Library returned `/workspace/scratch/0cf5b4b7d08c/...` paths that are not local here; the official helper could not materialize that workspace-path-only transfer. No alternative raw-download workflow was used. The older user-supplied local mockup remains untouched.

Latest implementation files: `components/subscription/subscription-payment-view.tsx`, `components/subscription/checkout-dialog.tsx`, `components/subscription/payment-attempt-view.tsx`. Updated tests: `tests/manual-checkout-dialog.test.cjs`, `tests/buy-checkout-preflight.test.cjs`, `tests/payment-status-ui.test.cjs`, `tests/fixtures/payment-attempt-browser.entry.cjs`, `tests/payment-attempt-browser.cjs`. All older primary edits/backups and unrelated worktrees remain preserved.

## Completed locally

- Preserved all original primary edits before integration in a verified ZIP, binary patches and retained Git stash `1049f9741b71f3402bbd2b51b36f7fca7a5a566d`. Fast-forwarded from `1b04afc` and three-way restored the primary edits. The payment conflicts were duplicate older success/layout code already represented by the reviewed release; the current success guards, modal and expiry behavior were kept. Deletion API/dialog changes and the user image remain intact.
- Applied the supplied avatar v2 patch, SHA256 `ed1185d1627167c2cc52844b92321bd9c0c994953ee9dad718cc26a34168809b`, to primary. Its current-user-scoped avatar ownership remains independent of selected-thread keys.
- Buy now shows a busy spinner and runs existing authorized discovery while staying on Buy. Successful discovery opens Checkout with **no method preselected**. Selecting ABA PayWay or Manual reveals the appropriate confirmation/upload controls. Only explicit confirmation starts a PayWay attempt. Switching methods and closing the chooser make no financial cancellation or provider request. Existing saved attempts reconcile/resume their original identity without starting another provider checkout. Failures stay near Buy; retry reuses a known created workspace. Checkout has its own scroll container inside the bounded dashboard viewport.
- New PayWay attempts keep a server-saved ten-minute deadline. Existing attempts are not extended or backfilled. The P2 response-delay finding is fixed: server time is sampled at saved-status request entry, and the client conservatively includes request/response elapsed time. A delayed first response cannot start an inquiry after checkout expiry.
- The other P2 finding is fixed: expiry uses full-document history replacement to Subscription after the bounded final saved-status check, removing the body-mounted provider iframe and its scroll lock. Observed paid/active results win the deadline race. No cancellation, refund or license/history deletion occurs from expiry.
- The card shows amount, countdown, status, accessible X, and visible Workspace / Plan-term / Amount / Reference contents. Removed the **Payment details** heading/accordion and standalone **Test payment** label. Saved environment metadata, receipt/history/admin truth and sandbox success safeguards remain.
- Transient session-validation copy only now reads **We couldn’t connect** / **Please try again in a moment.** / **Try again**, with concise Khmer equivalents. Definite-expiry text, privacy, retry limits and auth behavior are unchanged.

## Checkout closure and Pending visibility

- **Cancel is implemented** by authenticated same-origin `POST /api/payway/checkout-session`. It writes only a versioned `checkout_session` boundary in existing JSON metadata with status+metadata compare-and-swap and three bounded retries. Repeats are idempotent; concurrent approvals win and observations are retained. It never changes financial status, releases a payment hold, calls provider Close, or modifies access/receipts. Existing metadata guards and late guarded approval were proved in isolated PostgreSQL. No new schema or flag is needed.
- The client stops its countdown/provider polling, makes a bounded final saved-state read and replaces the document with Subscription, removing the provider iframe and body scroll lock. Paid results win the close race. Closure survives reload/tabs through saved metadata. Failed requests show a retryable error. The top X remains dismiss-only.
- Active Pending hides only PayWay sessions with an explicitly saved expired deadline or closure. Six old sandbox attempts with no lifecycle metadata remain; no age limit is invented. Submitted manual proofs and received/disputed funds stay visible for reconciliation. This is a display projection; settlement/history records are retained.
- Customer Billing history excludes unpaid Pending projections, filtering PayWay/manual rows before result caps and deriving visible tab counts from visible records. Failed/refunded/rejected and paid history stays. Historical direct KHQR test/verified/review projections stay. Late pending-to-paid updates reappear with their saved receipts. Removed the requested introductory sentence, three USD summary metrics and Pending tab. Accounting calculations remain available to existing API/admin consumers.

## Remaining capability limitation

**Show QR code** remains explicitly disabled with an unavailable explanation for current saved checkout. This is an integration capability gap, not denied access. No provider QR/resume locator is saved. The official classic plugin's `checkout()` invokes `initPlugin()` and submits Purchase again. Its `closeCheckout()` clears the iframe or navigates/reloads, leaving no closed-popup iframe to safely show again. A CSS re-show cannot provide durable resume after reload. The current official Purchase reference documents duplicate transaction ID error code 4: https://developer.payway.com.kh/purchase-14530820e0 . No Purchase replay, invented URL, replacement transaction or reset deadline was introduced. A provider-supported saved QR/resume contract is required before enabling this action.

No real payment was cancelled, refunded, recreated or otherwise mutated by verification. No credentials, production flags, hosted migration or security policy were changed. `PAYMENT_CANCELLATION_ENABLED=false` and `KHQR_CHECKOUT_ENABLED=true` remain unchanged. Direct Bakong retirement is already deployed in `0361e357`; the earlier retirement rollout instructions are historical context, not a pending initial deployment or a new flag-change request. Only the later local changes remain unpublished. No flag change is requested or performed in this handoff.

## Local server and verification

Final checkout follow-up evidence is in `C:/Users/TUF/AppData/Local/Temp/tenh-primary-integration-backup-20261017-prmpvkf_`:

- `checkout-followup-final.txt`: **93 passed**. `checkout-followup-dto.txt`: **15 passed** including the added saved-closure read regression (14 overlap). `close-sql-history-ui.txt`: **10 passed**, including isolated PostgreSQL metadata-guard and late-settlement proof. Earlier failed fixture-expectation/debug logs remain retained; they are superseded by these passes.
- `checkout-followup-browser/browser-results.json`: **834 assertions passed in eight English/Khmer cases at 390/768/1024/1440px**, including native document replacement on Cancel/expiry, overlay/body lock removal, method choice, manual review and no horizontal overflow. Zero runtime errors/external network requests.
- `history-followup-browser/browser-results.json`: **816 assertions passed across six English/Khmer desktop/tablet/phone cases**, including hidden Pending rows/removed summary, historical receipt eligibility and isolated receipt printing.
- `checkout-followup-types.txt`: TypeScript no-emit passed. `checkout-followup-lint.txt`: focused lint passed with no errors/warnings. `checkout-followup-http.json`: localhost:3000 login **200** and anonymous Buy **307** to sign-in. No real authenticated payment action was clicked.
- `retirement-regressions-final.txt`: **58 passed**, covering stale/fresh direct Bakong rejection, historical settlement/receipts/reconciliation and PayWay/manual preservation.

Earlier primary integration checks, retained as historical evidence:

- Port 3000 originally belonged to Next server PID 28988 / launcher 12552. A later primary restart used 32912 / 30152. Only these identified app processes were stopped during integration. The final explicit launcher used `C:/Users/TUF/social-inbox` and existing `.env.local`, with no credential copying or worker startup; its process record is in the backup folder.
- Anonymous HTTP checks: `http://localhost:3000/login` returned 200; `/dashboard/subscription/buy` returned the expected 307 to sign-in. No authenticated Buy/payment action was clicked against the real app. An existing user browser continued its own ordinary app polling.
- A malformed generated `.next/dev/types` cache was moved recoverably to `generated-types-before-restart`, then regenerated by the identified primary dev server. Source and configuration were not altered to suppress type checking.
- Regular local suite: 255 passed, zero failed, one optional baseline comparison skipped. Additional request-entry-clock API file: 14 passed, including its new clock regression. Focused Buy/card/success/session suite: 66 passed before that additional server-clock case.
- Browser tests use mocked HTTP and synthetic records only, English/Khmer at 390, 768, 1024 and 1440px. They exercise explicit method choice, responsive scrolling, full-document expiry and absence of the old iframe/body lock. **824 browser assertions passed across eight cases**, including the bounded dashboard scroll container. `latest-primary-browser/browser-results.json` contains the final pass/count summary; representative rendered phone/desktop pixels were inspected.
- TypeScript `--noEmit --incremental false`, targeted lint and `git diff --check` results are saved in the backup logs. The focused changed-area lint has no errors; the broader touched-file lint retains existing debt, with zero added error delta versus `ae7908d` (48 errors in both broad baseline and current sample, largely old CommonJS/style rules).
- Extra RSC checks were rerun with their required `--conditions=react-server`: 12 pass, two existing Inbox performance assertions fail, six optional baselines skip. Both failures reproduce identically on untouched `ae7908d`: channel reads expected 1 / actual 2 and expected 2 / actual 5. They are not introduced by this integration; assertions were not weakened.

## Recovery and temporary checkout cleanup

Final read-only recheck: primary remains `main` at `ae7908d2ffc386b14d85c0509a17a16c8445ab01`, with 40 tracked modifications, 14 untracked files, and no staged files. Both task-owned original paths below are absent and unregistered; recovery folders and ZIP hashes were reverified, and both branch refs remain retained. No further removal was necessary. Unrelated/Facebook worktrees were left untouched. The supplied avatar v2 patch passes `git apply --reverse --check` in primary; its focused tests are recorded in `avatar-primary-final-check.txt`.

Backup root: `C:/Users/TUF/AppData/Local/Temp/tenh-primary-integration-backup-20261017-prmpvkf_`.

Both original temporary checkout folders were moved to recoverable trash and successfully detached from Git, with no permanent deletion:

- `C:/Users/TUF/AppData/Local/Temp/tenh-retire-direct-bakong` → `retired-worktree-trash/tenh-retire-direct-bakong` under the backup root. Branch `retire-direct-bakong`, commit `27e3cb5204473c94f644780bc5eed3d2081c025e`, and verified ZIP retained (2349 source/artifact files).
- `C:/Users/TUF/AppData/Local/Temp/tenh-payway-popup-20261017` → `retired-worktree-trash/tenh-payway-popup-20261017`. Branch `fix-payway-popup-lifecycle`, commit `ae7908d2ffc386b14d85c0509a17a16c8445ab01`, and verified ZIP retained (2388 source/artifact files).

Ignored dependency/build caches were excluded from ZIPs; the full folders, including their junctions, remain in recovery trash. Primary `node_modules/next/package.json` was checked unchanged after the moves. No other worktree/Temp folder was removed. Exact targets, ZIP checksums and successful detach outcomes are in `worktree-recovery.json` and `cleanup-outcomes.json`.

Original backup: `primary-edits.zip`, `combined.patch`, `manifest.json`. Later snapshots and source hashes are in the same backup root; final local source changes remain in primary for review. No permanent cleanup of these recovery records is authorized by this task.

## Exact local code/test changes relative to the integrated commit

- `app/api/account/delete/route.ts`
- `app/api/payway/checkout-session/route.ts`
- `app/api/subscription/billing-history/route.ts`
- `app/api/subscription/payment-status/route.ts`
- `app/api/subscription/pending-payments/route.ts`
- `app/dashboard/inbox/page.tsx`
- `components/customer-avatar.tsx`
- `components/dashboard/dashboard-session-boundary.tsx`
- `components/inbox/conversation-header.tsx`
- `components/inbox/conversation-list.tsx`
- `components/inbox/customer-facebook-avatar.tsx`
- `components/inbox/customer-profile.tsx`
- `components/profile/delete-account-section.tsx`
- `components/subscription/billing-history-view.tsx`
- `components/subscription/buy-subscription-view.tsx`
- `components/subscription/checkout-dialog.tsx`
- `components/subscription/custom-subscription-builder.tsx`
- `components/subscription/payment-attempt-view.tsx`
- `components/subscription/subscription-payment-view.tsx`
- `components/subscription/use-buy-checkout.tsx`
- `components/ui/confirm-action-dialog.tsx`
- `docs/local-primary-integration-20261017.md`
- `docs/payway-checkout-lifecycle-20261017.md`
- `lib/billing/payment-attempt.ts`
- `lib/payway/checkout-lifetime.ts`
- `public/images/payment-status-mockup.png`
- `scripts/test-customer-avatar-recovery.cjs`
- `tests/bakong-api.test.cjs`
- `tests/billing-history-ui.test.cjs`
- `tests/billing-payment-attempt.test.cjs`
- `tests/billing-receipts-server.test.cjs`
- `tests/buy-checkout-preflight.test.cjs`
- `tests/dashboard-session-copy.test.cjs`
- `tests/delete-account-browser.cjs`
- `tests/delete-account-dialog.test.cjs`
- `tests/delete-account-impact.test.cjs`
- `tests/fixtures/bakong-browser.entry.cjs`
- `tests/fixtures/billing-receipts-browser.entry.cjs`
- `tests/fixtures/payment-attempt-browser.entry.cjs`
- `tests/inbox-avatar-switch.test.cjs`
- `tests/inbox-entry-read-lifecycle.rsc.cjs`
- `tests/inbox-return-context.test.cjs`
- `tests/inbox-return-read-lifecycle.rsc.cjs`
- `tests/inbox-search-match.test.cjs`
- `tests/inbox-server-paging-sql.test.mjs`
- `tests/manual-checkout-dialog.test.cjs`
- `tests/payment-attempt-browser.cjs`
- `tests/payment-status-ui.test.cjs`
- `tests/payway-application-baseline.test.cjs`
- `tests/payway-checkout-session.test.cjs`
- `tests/subscription-pending-payments.test.cjs`
- `tests/tenh-seven/harness.cjs`


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
