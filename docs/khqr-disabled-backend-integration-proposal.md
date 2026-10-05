# KHQR disabled backend and Billing integration patch proposal

Current implementation is a tested mock backend with real Next route handlers. It is not an enabled payment option: runtime registers no financial facade, all environment selections remain disabled, and no token/endpoint/QR SDK is configured. No existing PayWay, Manual, pricing, subscription UI, activation SQL or release installer file was edited. Stage-one design is retained as historical rationale; this document supersedes its proposed widening of billing_transactions.provider.

## Implemented ownership

| New file | Behavior |
| --- | --- |
| `lib/khqr/contracts.ts` | Tenant context, selection, intent, public reply, typed errors and the Billing-owned facade contract. |
| `lib/khqr/config.ts` | Explicit non-secret `TENH_KHQR_ENVIRONMENT` request; unknown defaults to unconfirmed; enabled/liveEnabled always false. No endpoint selection or secret read. |
| `lib/khqr/provider.ts` | Injected mock transport, bounded inquiry timeout/abort, server-bound MD5, strict mock verification; unique nonpayable payload generation. No fetch or bank SDK. |
| `lib/khqr/verification-policy.ts` | Promoted stage-one strict legacy-example parser for mock tests only. Unrecognized/current-v2 fields cannot activate. No invented payment timestamp. |
| `lib/khqr/service.ts` | Facade-mediated creation/idempotency, intent ownership/identity validation, deduplicated in-flight inquiry, observation/activation delegation and public response redaction. No copied price/date/activation logic. |
| `lib/khqr/http.ts` | Strict workspace auth, actual `billing` Manage permission, explicit workspace binding, JSON allowlist, idempotency key, no client payment proof, no-store and redacted failures. |
| `lib/khqr/runtime.ts` | Disabled composition boundary; `service: null` until coordinated Billing/contract review. No flag can create a live facade. |
| `app/api/khqr/readiness/route.ts` | Authenticated GET readiness; no-store. |
| `app/api/khqr/checkout/route.ts` | Authenticated POST checkout wrapper; runtime returns 503 KHQR_DISABLED. |
| `app/api/khqr/status/route.ts` | Authenticated POST intent verification wrapper; runtime returns 503 KHQR_DISABLED. |
| `tests/khqr-backend.test.cjs` | Real route/service/provider modules exercised through synthetic facade and transport; actual shared catalog used for simple mock prices. |
| `docs/sql/khqr-state-schema-proposal.sql` | Separate private intents/claims/observations, restricted privileges, uniqueness and expiry/state checks; review proposal only, never executed. |

Also KHQR-owned: this document and the three earlier prototype files. The original prototype policy stays historical; its 22 tests now exercise `lib/khqr/verification-policy.ts`. No production credentials or SQL executed. No dependency/lockfile edits, POS changes, deployment, payment request, payable QR or subscription change.

## Route contracts, as tested through injected mock wiring

`GET /api/khqr/readiness` authenticates the strict selected workspace and requires `billing` Manage. Returns provider, enabled=false, liveEnabled=false, requestedEnvironment and blocker codes. It does not expose merchant or credential data.

`POST /api/khqr/checkout`, JSON example (mock test only):

```json
{"purchaseBusinessId":"authorized-workspace-id","planCode":"mini","billingCycle":"monthly","renewSame":false,"customUpgrade":false}
```

Header `Idempotency-Key` is required, 16–128 letters/digits/underscore/hyphen. Optional connections/users are numeric in existing capacity bounds; optional extensionBillingCycle is none/monthly/3-months/6-months/12-months. Financial eligibility/quote semantics belong to the facade, not HTTP validation. Unknown fields including amount, receiver, token, QR, MD5, hash, paid/success are rejected. Same key+request returns the original intent; a changed request must be a 409 facade conflict. Keys are scoped to business/environment, never an unscoped global cache.

`POST /api/khqr/status` accepts only `{purchaseBusinessId,intentId}`. Reads the saved intent through the facade before provider inquiry; callers cannot submit provider evidence. A response includes payment.intentId/businessId/provider/environment/payable=false/amountMinor/currency/expiresAtMs/serverNowMs/state/invoiceId/mockPayload. The mock payload starts `TENH-NONPAYABLE-MOCK:` and is deliberately not an EMV/KHQR payment code. It is hidden after expiry or non-pending state. Amount, recipient, currency, full hash and server request binding are checked against the saved intent; exact expiry or later success goes to recovery, because no current authoritative paid-at contract is available.

Errors: 401 auth, 403 permission, 409 workspace/idempotency/conflicting purchase, 400 invalid request, 404 inaccessible intent, 503 disabled/unavailable. Runtime returns disabled before parsing/mutating checkout/status; tests inject a facade only into the module loader. An expired Owner can reach auth/permission, but eligibility remains owned by the approved Billing facade. The current route binds purchaseBusinessId to the strict selected workspace; the existing extra-workspace purchase flow needs the Billing owner to resolve intended-workspace membership without falling back to another workspace before this route is enabled.

## Exact Billing facade handoff

Implement `KhqrBillingFacade` in a **new Billing-owned file** `lib/billing/khqr-facade.ts` after review; do not insert new KHQR logic into PayWay provider modules. Do not connect the mock facade to Supabase subscriptions.

1. `prepareIntent`: reauthorize active member and Billing Manage for the intended business; acquire the same workspace lock/order as deployed Billing; reject pending/recovery purchases across KHQR, PayWay and Manual; use the existing `getTrustedSubscriptionQuote`, approved plan-change eligibility and `buildCustomUpgradeQuote` through one approved Billing quote seam. Save exact requester/selection, quote, pricing and paid-term baseline. Recheck under the lock; generate/persist unique intent/QR atomically. Idempotency conflicts compare immutable request fingerprints. The mock generator is pure/local; real QR generation must use a vetted SDK with decode/CRC/digest/reference/expiry validation. Never call provider HTTP while holding the financial transaction lock.
2. `getIntent`: tenant-scoped lookup; active member/permission recheck, exact intent/environment/config binding. Service verifies returned business/id as defense in depth. Durable inquiry lease/throttle and persisted reconciliation scheduling belong here; in-process deduplication alone does not coordinate server instances.
3. `observe`: append normalized/redacted evidence and preserve existing recovery/approval/cancellation holds. Not found/API errors cannot approve, cancel or downgrade a financial hold. Expired presentation is not authoritative nonpayment. Late money retains a recovery path.
4. `activateVerified`: service-only dedicated RPC reauthorizes, locks the workspace in the deployed order, locks/rechecks immutable intent, MD5/config/environment, current quote/baseline/expiry and cancellation/deletion state; globally claims (environment,full hash), then invokes the **approved provider-neutral activation core**, marks approved and issues one KHQR invoice in the same transaction. If no approved provider-neutral core exists, Billing owner must first provide one with preserved PayWay/Manual behavior. Do not call `tenh_activate_verified_payway_payment`, classify KHQR as Manual, or copy its financial body. Repeated approval returns the existing invoice; competing valid money/stale baseline is retained for recovery; invoice failure rolls back claim and all subscription effects.

The facade interface is implemented only by the synthetic tests now. A real facade and shared core cannot safely be fabricated without the Billing owner/deployed schema. This is an explicit remaining integration task, not a claim of completed real activation.

## Separate state schema decision

Use `tenh_khqr_private.intents`, `payment_claims`, `observations` from the separate review proposal. Do not add KHQR to billing_transactions or its payway-only CHECK. Global full-hash uniqueness and unique intent attribution prevent equal-price/race/replay credit across businesses. Per-business pending/recovery uniqueness protects KHQR creation; shared provider guards still need coordinated extension. Request/quote/QR identity and evidence require reviewed immutable/append-only guards. Draft starts with no service-role/table grants; service-only RPC access is a later approved migration. Financial references use restrictive deletion and retained requester snapshots, with exact schema/FK/retention review outstanding.

Invoice/current subscription source/provider checks still need a separate Billing extension. The SQL proposal does not author activation functions, grants, policies, shared guard changes or a runnable release migration; it ends with rollback and is never executed in this task. Existing Billing installers, captures, fingerprints and enrolled historical records remain unchanged.

## Shared UI/API patch proposal — NOT APPLIED

Owner: existing Billing writer. Patch only after facade/guard review; initial readiness remains false so no customer-facing KHQR selection appears. Proposed shared-file changes:

1. `components/subscription/subscription-payment-view.tsx`, anchor `type CheckoutMethod = "payway" | "manual"`: add `| "khqr"`. Add a separate KHQR card and isolated state only when server readiness says enabled. Preserve the existing PayWay/Manual state and handlers. Render a separately owned new `components/subscription/khqr-payment-panel.tsx` for that branch; no ABA plugin or Manual proof upload is reused. Bind panel state/key to exact purchaseBusinessId and quote selection, abort stale create/status requests when workspace/selection changes, and retain an unresolved intent while switching methods. Do not treat hiding/closing the panel as cancellation.
2. New panel: show server amount/currency, verified SDK-rendered payable QR only after real approval gates, server-derived expiry countdown, pending/recovery/approved/cancelled states, retry/recheck and existing authorized invoice link. Mock preview must say it cannot be paid and must never render a bank-scannable code. Generate one stable idempotency key per bound selection; retries reuse it. Send only selection+workspace for create and intent ID+workspace for status. Never send token/provider proof or activate from `?success=`. Await status reply from the server before refreshing subscription; countdown expiry hides QR and explains reconciliation without asserting nonpayment. Use current approved polling/backoff and continue reconciliation server-side after browser close.
3. `app/dashboard/subscription/payment/page.tsx`: preserve PayWay tran_id return handling. Add separate optional KHQR intent resume only through the facade's authorized saved-intent lookup; saved quote display comes from its immutable snapshot. Ensure extra-workspace membership resolution is explicit. No mixed interpretation of PayWay tran_id and KHQR intent IDs.
4. `app/api/subscription/billing-history/route.ts`, anchor `type PaymentSource = "payway" | "manual"`: add `| "khqr"`; append a third authorized facade history result. Keep existing provider=payway query and Manual query unchanged. KHQR source IDs, status, amount/currency and invoice mapping come from its own tables/RPC. No join by amount or reinterpretation of PayWay rows.
5. `app/api/subscription/invoices/[invoiceId]/route.ts` and corresponding UI source labels: accept the approved KHQR invoice source through the same ownership/permission guard. Existing invoice paths and numbering stay Billing-owned. Extend subscription current/readiness response only as required for provider presentation; entitlement and price calculations remain the approved shared behavior.
6. Billing schema/creation/approval/retention/deletion/expiry guard extension: include KHQR pending/recovery/paid evidence under the same workspace locks; add a source-aware invoice/core facade contract. Preserve exact PayWay/Manual branches and historical enrollments. Native three-provider race tests and existing Billing regressions are required before connecting runtime.
7. `lib/khqr/runtime.ts`: after approval, compose the vetted provider and approved facade. The existing mock-only types/parser must not be relabeled SIT/Production. Add a distinct live adapter with the confirmed current NBC schema/identity/timestamp contract. Read the secret only in that approved adapter setup. Explicit config/issuer/receiver verification is required; neither environment name nor public portal version enables Live. Keep the live flag off during mocked integration.

These are exact edit locations and data contracts for coordination; no patch to shared files has been applied and no customer UI integration is claimed. A mobile-specific option should use the same server/facade contracts only after the Billing owner requests that integration; no POS scope.

## Official contract gate

Rechecked [NBC SIT Docs](https://sit-api-bakong.nbc.gov.kh/document): no readable body via available web tooling. Obtain the **current NBC Open API v2.0.5 documentation/export for the issuer-confirmed environment**: transaction lookup request/response schema, success/failure/not-found semantics, MD5-to-unique-transfer attribution, receiver/currency/amount definition, full hash, authoritative paid-at/timezone if offered, unique reference lookup guarantees, auth expiry/scope and polling/rate limits. Do not infer `/v2`, fields, timestamps or success status from the portal version. The [official older Open API PDF](https://bakong.nbc.gov.kh/download/KHQR/integration/Bakong%20Open%20API%20Document.pdf) is used only to build synthetic legacy examples.

[NBC SDK guide v2.9, May 2025](https://bakong.nbc.gov.kh/download/KHQR/integration/KHQR%20SDK%20Document.pdf) documents generation/dynamic expiry, but package compatibility and merchant registration fields still need verified setup. No package or payable code was generated. User can later provide non-secret issuer environment/portal and merchant receiver/registration/currency details; token entry remains through secure setup after the concrete integration/configuration is approved.

## Verification and limits

`node --test tests/khqr-backend.test.cjs tests/khqr-prototype/verification-policy.test.cjs`: 41 mocked checks, including real handler parsing/auth/permission/workspace binding, nonpayable/idempotent intent, shared catalog reuse, wrong intent/tenant, inquiry deduplication/timeout/retry, evidence mismatches, late success, replay model, stale baseline, invoice rollback model, disabled config/runtime and redacted no-store replies.

The ledger/facade are synthetic models. No native database concurrency, live provider contract, bank settlement, real entitlement/invoice or production configuration proof is claimed. Remaining gates: readable current API contract, issuer-confirmed environment/receiver scope, non-secret merchant details, coordinated approved Billing facade/core/schema/UI patch, durable rate limiting/reconciliation and disposable native three-provider race tests. No production SQL or deployment.

Final validation passed: full repository TypeScript check `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false` (exit 0) and scoped ESLint `node node_modules/eslint/bin/eslint.js lib/khqr app/api/khqr tests/khqr-backend.test.cjs tests/khqr-prototype/verification-policy.test.cjs` (exit 0, no diagnostics). No application build or provider execution was performed. KHQR Live is disabled; existing provider configuration was not inspected or changed by this task.
