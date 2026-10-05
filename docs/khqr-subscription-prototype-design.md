# TENH-CHAT KHQR subscription option: isolated prototype and handoff

Historical stage-one record. The subsequent disabled backend and separate-table proposal are documented in `docs/khqr-disabled-backend-integration-proposal.md`; that document supersedes this file's initial ownership list, runtime status and billing_transactions constraint-extension option. PayWay/Manual and shared Billing release files remain untouched.

Status: MOCK ONLY; no live adapter, credentials, payable QR, runtime route, migration execution, POS change or deployment. KHQR is an additional provider (`khqr`); ABA PayWay's existing `abapay_khqr` remains PayWay. Only the three new files listed below belong to this prototype. Shared Billing work belongs to the existing Billing writer.

## Evidence and unknowns

Read repository AGENTS.md and installed Next 16.2.12 route-handlers guide before code. No nested AGENTS.md was found under app/lib/db/tests. Existing seams:

- `app/api/payway/checkout/route.ts`: strict workspace/member validation, Billing Manage, trusted plan/capacity quotes and pending checkout safeguards. These policies need coordinated reuse; do not copy its PayWay hash/close/config behavior into KHQR.
- `lib/payway/finalize-payment.ts`: exclusively selects `provider=payway`, queries the provider server-side, and calls `tenh_activate_verified_payway_payment`. Never send KHQR through this RPC.
- `app/api/subscription/billing-history/route.ts`: source union currently `payway | manual`. Invoice function in the local DDL review rejects other source types. Reviewed coexistence guards map billing_transactions to PayWay, and preserve unresolved historical PayWay/Manual purchases. Widening a provider CHECK alone would bypass or misclassify billing invariants.
- The payway-only `billing_transactions.provider` CHECK is supplied task context. This worker did not query production or locate its complete current table DDL; synthetic native fixtures do not prove that constraint. Its exact name/definition, invoice/subscription checks, triggers, ACLs and deployed Billing release must be confirmed by Billing's owner before any migration is written.

Official sources checked 2026-10-03 (documentation facts below total fewer than 200 derived words per PDF):

1. [NBC Open API PDF v1.0.2](https://bakong.nbc.gov.kh/download/KHQR/integration/Bakong%20Open%20API%20Document.pdf), sections 5/6: server POST paths `/v1/check_transaction_by_md5` and `/v1/check_transaction_by_hash`, Bearer authorization, JSON request; MD5 lookup accepts the QR digest. Success examples contain responseCode 0 and data.hash/toAccountId/currency/amount. Not found uses responseCode 1/errorCode 1; failed uses errorCode 3. The examples lack paid-at timestamp and QR MD5 echoed in the response. This older PDF is not proof of the current API contract.
2. [NBC KHQR SDK guide](https://bakong.nbc.gov.kh/download/KHQR/integration/KHQR%20SDK%20Document.pdf), changelog 2.8 dated 2025-02-24, pages 13–15 and error catalogue: dynamic QR requires expirationTimestamp, 13-digit milliseconds. Merchant fields include BakongAccountID, MerchantID, AcquiringBank, MerchantName; merchant city is available. SDK generates QR plus MD5; it documents `bakong-khqr` for JavaScript. Some JavaScript samples omit expiry although newer tables/errors require it. Exact installed package/API compatibility needs verification; no SDK was installed.
3. [NBC QR integration guide](https://bakong.nbc.gov.kh/download/KHQR/integration/QR%20Payment%20Integration.pdf), pages 4–5/8–9: transaction ID unique per QR generation; merchant defines expiry, QR timeout at most ten minutes; server polls MD5. Older registration guidance separates SIT and Production and documents a 90-day token lifecycle. Its hosts use nbc.org.kh, so they are historical references, not configured endpoints.
4. [Current NBC SIT public portal](https://sit-api-bakong.nbc.gov.kh/) reports v2.0.5 and [its Docs link](https://sit-api-bakong.nbc.gov.kh/document). [Production Docs page](https://api-bakong.nbc.gov.kh/document) is reachable through web tooling but exposes no readable body. Current request/response schemas, timestamp/reference behavior, polling limits and endpoint binding remain unverified. A direct PowerShell public-document read was blocked by sandbox socket permissions; no escalation or API inquiry was attempted.

## Reliable environment identification and secure setup gate

Do not identify an environment from token spelling, decoded JWT content, an account suffix, a successful request to a guessed host, or PayWay's existing environment. Never try a credential against multiple environments. The fact that a token exists is not evidence of which system issued it or permission to use it.

Require non-secret issuing-portal URL/environment label and NBC issuance/registration confirmation. Obtain NBC confirmation of the current approved API base URL, credential environment, project/account scope and access to the intended receiver. Record an explicit immutable merchant/environment configuration version. Unknown environment disables QR generation, inquiry and activation. Current public portal visibility alone does not bind this user's token to it.

After the concrete implementation/test configuration receives user approval, the user enters the token only through the approved server secret setup. Separate test/production stores and explicit enable flags; no `NEXT_PUBLIC_` token, client request, log, snapshot, QR, repo file, SQL or chat secret entry. Do not decode/read the token during this mock stage. Expiry/renewal handling must follow the approved current NBC contract; avoid assuming the old 90-day value applies. No credentials were supplied to or used by this worker, and `.env.local` was not read or modified.

Non-secret inputs needed: merchant versus individual KHQR registration type approved for TENH subscription collection; receiving Bakong ID; merchant display name/city; merchant ID and acquiring bank if merchant type; approved MCC and optional store label/phone if required; supported collection currency; approved environment/base URL and configuration version. Confirm that the token can inquire on this receiver; an account-exists response alone does not prove account ownership or inquiry scope. Do not request bank passwords, OTPs or private keys.

## Quote, QR and verification design

Initial proposed currency is USD, matching existing server quote cents; this is a TENH design choice, not an NBC limitation. KHQR can represent KHR but KHR acceptance needs an approved exchange-rate source, saved rate/rounding policy, integer riel pricing and receiver support. Do not reinterpret USD cents as riel or silently convert provider results.

Server owns authenticated workspace, requester, Billing Manage, plan/cycle/capacity selection, quote amount, pricing version and complete subscription baseline. No client amount, recipient, QR, MD5, provider hash, paid flag or success return determines approval. Renewal for an expired eligible Owner must follow existing Billing policy without granting operational access prematurely.

Create a saved immutable intent before exposing a QR. Proposed TTL: five minutes (local design, below the older guide's ten-minute ceiling). Save UTC created/expiry instants and feed the same expiry milliseconds to the vetted SDK. Encode the exact quoted amount and currency, approved receiver and a unique opaque billNumber (within SDK limits) per intent. Retried creation with the same scoped idempotency key returns the same intent/QR; changed selection with that key returns 409. A new intent needs a distinct billNumber/QR/digest even for identical recipient, amount and generation millisecond. Validate SDK output by decoding amount, currency, receiver, reference and expiry and recomputing its MD5; uniqueness collision fails before presentation. Timestamp or amount alone cannot distinguish purchases.

Status/reconcile only accepts an intent ID belonging to the authenticated workspace. Server loads its saved MD5 and environment, calls the confirmed provider endpoint, parses a strict contract and compares exact receiver, currency and integer minor-unit amount; require full transaction hash. MD5 is a lookup key, not authentication or the full transaction identifier. Bind the result to the actual server request; the old response does not echo MD5. No browser-supplied full-hash/short-hash lookup or matching by amount/time/description. Current NBC MD5-to-payment attribution guarantees must be established before enabling automatic activation; if insufficient, require a currently documented unique-reference query and response rather than assuming billNumber is returned.

HTTP 200 alone is insufficient. Missing/malformed data, contradictory status/error, receiver/currency/amount mismatch, API outage, token failure, unknown status or ambiguous attribution cannot activate. Not found is pending while unexpired; expiry disables presentation and marks unresolved reconciliation, not proof of nonpayment. Late success is retained for recovery; this prototype cannot prove paid-before-expiry because the legacy response lacks an authoritative paid-at field. Do not throw away money evidence or auto-cancel/reopen on timeout. Cancelled/deleted accounts and existing review holds never auto-reactivate.

Server status checks use no-store, bounded timeout, deduplicated per-intent inquiry, throttling/backoff for 429, redacted error handling and current NBC-approved polling cadence. A worker reconciles when the browser closes; UI countdown uses server expiry. No provider webhook is assumed from the available documentation; if NBC supplies one, use it only as a prompt for authoritative server inquiry until its signature/replay contract is separately verified. Deep links are optional and cannot prove payment.

## Separate schema extension proposal (no SQL authored/executed)

Create a separately reviewed KHQR extension after the deployed Billing release is known. Do not modify or regenerate existing Billing installers/SQL, enrolled old records, PayWay or Manual functions. Billing owner owns this extension because existing shared triggers and invoice/activation invariants must be reconciled.

Minimal proposed persisted shape:

| Object | Required fields/invariants |
| --- | --- |
| Existing billing transaction extension | Permit `provider=khqr` only after the exact provider constraint/trigger review. Use opaque prefixed intent ID for provider_transaction_id; retain trusted plan/cycle, amount/currency, requester, target limits, pricing snapshot and baseline. Keep existing PayWay fields/rows unchanged. |
| New `tenh_khqr_intents` | billing_transaction_id PK/FK; immutable environment, merchant_config_version, receiver, currency, amount_minor, quote/baseline fingerprint, idempotency_key, request fingerprint, bill_number, qr_payload, qr_md5, created_at, expires_at; status and verified/activated timestamps. Positive minor amount; expiry after creation; scoped unique (business_id, idempotency_key), unique billNumber and unique (environment, qr_md5). |
| New `tenh_khqr_payment_claims` | PK (environment, full_transaction_hash), unique intent FK, verified receiver/currency/amount, observed_at, authoritative paid_at if contract supplies it; append-only evidence. Same provider transfer can credit only one intent globally within its environment, across all workspaces. |
| New `tenh_khqr_observations` | Append-only intent, inquiry request binding, normalized response/error/time and recovery reason; bounded/redacted evidence, no token or unnecessary payer data. |
| Atomic activation RPC | Service-only `tenh_activate_verified_khqr_payment`, fixed search_path, no browser execute/table write grants; proof claim, trusted quote/baseline checks, subscription change, approved state and invoice insertion in one transaction. |

The exact tables/columns are a proposal, not a claimed deployed schema. Use FK/RLS/ACL patterns approved by the Billing owner; QR/evidence reads must be tenant-scoped, writes service-only and immutable financial identities protected. Extend invoice/subscription provider/source checks only after complete schema capture. Issue invoice source `khqr` exactly once (unique source/payment identity); do not pretend it was Manual or PayWay. Preserve cancelled-account/retention handling and immutable quote/paid-term lineage. Pricing and date arithmetic must use Billing's approved semantics, including paid-term optional extension; no independent subscription-calculation fork.

Activation lock order must match the deployed Billing release. Every provider creation/approval must serialize on the same workspace coordination lock and re-read the subscription and conflicting financial intents after obtaining it. Provider inquiry occurs outside that database transaction; immutable bound evidence is rechecked inside. Global full-hash uniqueness prevents two-workspace replay, and baseline comparison prevents a late KHQR approval from overwriting a Manual/PayWay activation. A competing legitimate payment still requires recovery/refund handling; it is not simply discarded. Unique constraints arbitrate check-then-insert races. Invoice errors roll back the entire claim/activation so a retry can succeed once.

Critical integration constraint: a new KHQR-only guard cannot make unchanged PayWay/Manual writers observe KHQR pending/recovery state. Existing coexistence code explicitly assumes two providers. Therefore enabling KHQR requires a coordinated shared Billing extension; separate routes alone cannot prove cross-provider safety while shared flows remain untouched. This initial task intentionally stops at mock proof and design. Do not enable even a test-backed runtime UI until that ownership/locking/guard decision is resolved.

## Exact ownership

Created and owned by this KHQR prototype task:

- `tests/khqr-prototype/verification-policy.ts` — pure mock contract/policy, no runtime consumer.
- `tests/khqr-prototype/verification-policy.test.cjs` — synthetic lookup and atomic-ledger model tests.
- `docs/khqr-subscription-prototype-design.md` — design/ownership/evidence handoff.

Proposed later KHQR-owned new files, after coordination (not created/reserved by this task):

- `lib/khqr/config.ts`: server-only approved configuration/readiness, no environment guessing.
- `lib/khqr/provider.ts`: vetted SDK generation plus current NBC transport/response adapter.
- `lib/khqr/verify-payment.ts`: saved-intent inquiry, validation and dedicated activation RPC.
- `app/api/khqr/checkout/route.ts`: authenticated strict workspace checkout creation.
- `app/api/khqr/status/route.ts`: authorized POST status inquiry, no-store, no client proof.
- `components/subscription/khqr-payment-panel.tsx`: separate QR/countdown/reconciliation presentation.
- `tests/khqr-provider.test.cjs`, `tests/khqr-routes.test.cjs`: mock adapter/auth/route contract proof.

Proposed Billing-owner deliverable: `docs/sql/khqr-billing-extension-draft.sql` only after exact shared schema/design review; separate later migration name assigned by owner. Shared payment page/view, Billing history/invoice/current consumers, activation/creation/retention/expiry guards, plan quote reuse and mobile subscription flow stay Billing-owned. No existing runtime, package manifest, lockfile, SQL or shared test file was edited here. No route/credential configuration/UI selection has been enabled.

## Mock proof and remaining tests

Run `node --test tests/khqr-prototype/verification-policy.test.cjs`. Current suite: 22 passing checks. Pure policy handles strict decimal minor units, valid inquiry, mismatched recipient/currency/amount/hash/environment/digest, failure/contradictory status, existing hold, not-found/expiry, late success, outage/auth/rate limits, cancellation/idempotency and same-price intent separation. Synthetic atomic ledger exercises concurrent completion exactly once, cross-workspace full-hash replay, stale cross-provider baseline and invoice rollback/retry.

The ledger is synchronous in-memory modeling; Promise.all does not prove PostgreSQL concurrency, isolation, deadlock freedom or database atomicity. The code is not an actual NBC adapter, valid QR generator or deployable billing implementation.

Focused verification also passed: `node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target es2022 --module commonjs tests/khqr-prototype/verification-policy.ts` and `node node_modules/eslint/bin/eslint.js tests/khqr-prototype/verification-policy.ts tests/khqr-prototype/verification-policy.test.cjs`. No full application build was needed for this disconnected test-only prototype.

Further isolated tests after contract/ownership resolution:

1. Vetted SDK decode/CRC/MD5/expiry/reference tests; equal amount/time distinct intents; rounding and KHR policy if approved.
2. Real route auth stubs: stale/deleted workspace, outsider/role, requester change, expired Owner renewal, client amount/recipient/MD5/hash injection; status ownership and no-store; double-click idempotency and changed-body conflict.
3. Transport fixtures for the confirmed current API: timeout, 401/403/429, token expiry, malformed/contradictory data, verified identity/reference mapping and late-paid reconciliation. No network/secret use in these tests.
4. Disposable native PostgreSQL with two independent connections: KHQR/KHQR creation, same hash across workspaces, repeated activation, KHQR/PayWay/Manual creation and competing approval, waiting-session visibility, stale baseline, cancellation/deletion and invoice failure rollback. Synthetic compatibility fixture first; approved schema parity later. No production SQL or credentials.
5. Billing-owner regression gates for existing PayWay/Manual behavior, historic recovery/retention, invoice source, plan/capacity pricing and paid-term duration; UI expiry/retry/worker reconciliation and browser close. These have not been run as part of the mock-only task.

Blockers before an enabled provider: issuer-confirmed environment/base URL and receiver scope; readable current v2.0.5 contract and attribution/timestamp/rate-limit semantics; non-secret merchant registration/receiver details; coordinated Billing schema/locks/guard/invoice/activation ownership; native concurrency proof. Token secret setup requires the user's approval of the concrete implementation/configuration, followed by secure entry. Real payments, production SQL and deployment remain outside this task.
