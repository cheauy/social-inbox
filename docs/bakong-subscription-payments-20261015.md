# Bakong subscription payments — local implementation and rollout review

Production checkout remains disabled. No credentials were read/configured, no hosted SQL was applied, and no bank transaction was initiated. The user's credential eligibility, exact quota, shared use by other applications and expected customer volume remain **unverified**. Public documentation cannot establish those account-specific facts.

## Verified integration contract

References reviewed on 2026-10-15:

- [NBC KHQR SDK](https://bakong.nbc.gov.kh/download/KHQR%20SDK.pdf)
- [NBC Bakong Open API v1](https://api-bakong.nbc.gov.kh/Bakong%20Open%20API%20Docs%20v1.0.1.pdf)
- [Current documentation portal](https://api-bakong.nbc.gov.kh/document)
- [Current public registration](https://api-bakong.nbc.gov.kh/register)
- [NBC Bakong](https://bakong.nbc.gov.kh/)
- [Pinned JavaScript package](https://www.npmjs.com/package/bakong-khqr/v/1.0.20), whose repository points to NBC's `gitlab.nbc.gov.kh:khqr/sdk-javascript.git`.

The portal's public configuration advertised v2.0.4, API mode v1, mock=false and a daily limit of **100**. This is public-tier evidence, not verification of the customer's credentials. Use the explicit v1 MD5 contract only after NBC/the acquiring bank confirms it for this merchant. No undocumented webhook, payment link, provider receipt URL or recurring charge is implemented.

The implementation uses merchant KHQR, not individual-account QR: recipient/account ID, merchant ID, merchant name, city and acquiring bank are required. ASCII field limits are 32/32/25/15/32 respectively. An account ID alone never enables checkout. CHAT currently quotes USD; the QR uses SDK currency 840 and the exact saved decimal amount. KHR conversion is intentionally absent. Each QR has a unique 24-character bill reference and a 15-minute expiry in 13-digit milliseconds. Offline generation/decoding uses `bakong-khqr@1.0.20`; no SDK network helper is used. The SDK's transitive Axios is overridden to 1.20.0, although the integration's sole provider request uses native fetch.

The authenticated server calls POST `/v1/check_transaction_by_md5` with the immutable issued MD5. Settlement requires success plus the full 64-character transaction hash, matching recipient, exact decimal amount and USD currency. If an MD5 is echoed it must match. Otherwise correlation is the authenticated lookup of the saved MD5, as documented by this contract. Provider errors, malformed replies, timeouts and an unknown result remain unresolved. Returned evidence stores only these necessary verified fields, not the raw provider payload. The response is bounded to 32 KiB, has a 10-second timeout, rejects redirects and has no transport retry.

## Existing CHAT rules reused

- `lib/billing/subscription-purchase.ts` extracts the former manual-payment quote and immutable purchase snapshot builders. Manual proof preparation retains its own proof fields; prices and calculations are unchanged.
- Normal purchases, trial conversion, expired renewal, saved-price same-plan renewal and custom capacity/duration upgrades reuse those builders and the existing SQL activation algorithm.
- The migration adapts the installed trusted activation body with Bakong provider/evidence labels; it retains baseline guards, subscription locks, limits, period calculations and invoice coverage. Existing PayWay/manual activation bodies remain in place.
- Existing cross-method workspace pending-purchase guards also cover Bakong. A pending/verified/review Bakong obligation cannot be bypassed by selecting ABA or manual transfer. Other workspaces remain independent.
- The existing helper can quote an active same-plan purchase, while the installed SQL guard rejects it as already active for the paid period. Bakong preserves that rejection and issues no QR. Ordinary renewal tests cover expired periods; no early same-plan renewal policy is added.
- A pre-existing request inconsistency remains: manual's helper prioritizes customUpgrade when both it and renewSame are true; PayWay rejects that combination. Bakong rejects contradictory flags rather than introducing a new financial rule.
- CHAT has scheduled plan-change fields, but no supported paid-purchase scheduling contract was found. This feature does not introduce one or reinterpret scheduled changes as current paid access. That financial behavior would require a separate reviewed contract.
- The existing nonpayable mock KHQR service remains separate and unchanged. It cannot act as settlement evidence.

## Attempt lifecycle and recovery

The server binds every attempt to the authenticated user, active member, explicit authorized workspace, purchase intent, immutable selection, server quote/snapshot, recipient, environment, QR/MD5 and expiry. Client amount/currency/provider-status fields are rejected. Browser return values cannot approve a payment. Issued identity and verified evidence are immutable.

Preparation serializes under the workspace subscription lock and reuses the original intent or existing unresolved obligation. The browser saves the intent in its internal URL before preparation, reconciles a lost response by that intent and replaces checkout with the exact-attempt status view. Reload and old checkout links discover the saved attempt. ABA/manual conflict responses also route to that attempt. No cache/navigation failure authorizes another purchase.

States are `pending`, `verified`, `applied`, `review`, and sandbox-only `test_paid`. Verified evidence commits before a separate idempotent application attempt. An invoice/application failure preserves evidence and blocks another charge; Check payment or the admin panel retries application without calling Bakong again. Locks, existing baseline checks, the full-hash settlement ledger and invoice uniqueness prevent repeat activation. Current entitlement and issued invoice are read again for the result view; historical approval alone never means current access is active. Continue switches through the existing authorized workspace API.

Sandbox settlement never invokes paid activation or issues an invoice. History identifies it as a test and excludes it from confirmed production totals. Unknown/conflicting provenance also cannot count as confirmed revenue. Production receipts remain **TENH receipts**, with Bakong KHQR as the supported method; uploaded proofs remain separate.

Expiry removes the QR but does not declare the payment unpaid or release its purchase claim. Late observed settlement, changed subscription baseline, removed initiating membership, mismatched evidence and a reused hash go to review. The ledger retains any additional observed transaction, and audit events record transitions without tokens. No stale automatic activation, refund or credit policy is invented.

The admin payment-review page includes a role-protected, paginated Bakong reconciliation panel. Its action uses the same verification budget and application path. It cannot manually mark paid, override a stale plan or refund. Cases requiring bank-statement investigation remain pending review until a separately authorized reconciliation procedure resolves them. This deliberately favors duplicate-charge safety over reopening a checkout with an uncertain outcome.

## Shared quota and polling rules

- Quota is centralized in PostgreSQL by environment, across app instances, users, workspaces and token rotation. There is no process-local or browser-only request counter.
- Every claimed provider request consumes a rolling 24-hour slot, including network failure, malformed reply, 401/403 and 429. Unused/crashed leases are conservatively counted.
- Default allocation is 90 requests, leaving 10 below the documented public 100/day. Production uses the smallest of configured budget, reviewed allocation minus 10 and verified daily limit minus 10; it must also meet the reviewed expected demand.
- Preparation reserves three verification slots for each new unresolved obligation. A fresh QR is refused if capacity is reserved/exhausted or credentials are blocked. Existing attempts take priority.
- At most one provider request per environment per 60 seconds; each attempt waits at least five minutes. A 90-second lease deduplicates tabs/instances. Errors back off to one hour; provider Retry-After may impose a longer shared cooldown. Invalid credentials stop further issuance/checks until correctly reviewed replacement credentials are installed.
- Automatic checks occur no sooner than five minutes and stop after three. The saved provider check count survives reload/tabs; the mounted UI also bounds activation retries. Manual/admin checks cannot bypass the database limits. Reading saved status, countdown ticks, QR generation and activation retries make no provider call.
- Clock display uses server time plus monotonic elapsed time. Browser-clock edits cannot change saved expiry or quota. Hidden/offline pages pause automatic checks; returning online/visible reloads saved state without an immediate bank call.

At 90 allocated calls and three reserved checks per attempt, roughly **30 new three-check obligations/day** is an upper-bound illustration before further manual/error/reconciliation use, not a production-capacity promise. Unresolved attempts retain reservations until consumed/resolved. This public tier may be unsuitable for TENH CHAT customer volume. Never increase the budget merely to hide exhausted capacity.

Before enabling production, obtain written NBC/acquiring-bank confirmation of merchant eligibility, USD account/merchant fields, the exact API version and status semantics, credential quota/reset rules, concurrent/short-window limits, and any usage shared with other applications. Establish a dedicated or explicitly allocated merchant credential with sufficient quota for peak volume plus failures and late-payment reconciliation. Review the customer experience of delayed confirmation under that allocation. If adequate capacity or a supported merchant arrangement cannot be established, leave checkout disabled.

The MD5 lookup is not proven to enumerate every transfer to a QR. Although every observed additional hash is retained, exhaustive duplicate-payment detection requires a supported provider/merchant-statement reconciliation arrangement. This implementation does not claim the MD5 API alone supplies that guarantee.

## Configuration and rollout order — requires separate approval

1. Review the [non-secret example](config/bakong.env.example). Put real token/configuration only in the existing server secret manager, never source, NEXT_PUBLIC, logs or customer responses. The environment and exact allowlisted host must agree. Leave checkout=false.
2. Review hosted versions, source definitions, owners, privileges and triggers for coexistence, manual upload lifecycle, invoice/custom coverage and application-baseline prerequisites. The migration expects trusted postgres/supabase_admin ownership, text provider columns and known installed function markers; unknown contracts abort the entire transaction. Do not apply to a different schema by weakening these checks.
3. After approval, rehearse the new `20261015140343_bakong_subscription_payments.sql` on an isolated staging copy, including true multi-connection contention, mixed PayWay/manual operations and rollback. It adds service-only RPCs/table, private capacity/budget/ledger/audit tables, immutable guards and a Bakong invoice dispatch. No RLS/grant broadening to browser roles or historical backfill is required. Production migration/application deployment order is migration first, compatible code second, checkout still off.
4. Perform an approved SIT integration using isolated accounts, confirming SDK fields and the complete live response contract. Mocked tests are not this check. Sandbox must grant no real access.
5. Verify account-specific eligibility, actual quota, allocation and volume with NBC/bank evidence. A database owner must review a private `tenh_bakong_private.capacity_reviews` record bound to recipient and the token's server-computed SHA-256 fingerprint, including verified/allocated/required request counts, review reference, actor and UTC time. No approval row is seeded and there is intentionally no UI self-approval endpoint. Do not log the token to calculate its fingerprint. Token rotation requires a new review and never resets shared usage.
6. Only after separate approval configure the production environment/host and enable the flag. Validate one authorized production flow under the approved payment plan. No such test was performed here.

Rollback is additive: disable checkout, retain reconciliation access and the capacity budget, attempts, settlement evidence, pending guards, provider labels and invoice dispatch. Do not drop tables, rewrite old statuses or revert provider-aware readers while obligations exist. A destructive schema rollback needs a separately reviewed evidence-preservation plan. Existing issued QR images can remain on an already-open screen until its next authorized read; disabling new checkout alone cannot revoke a QR already seen by a bank app.

## Verification boundaries

Local tests use offline QR generation, fake time, isolated PostgreSQL/PGlite fixtures, mocked Supabase identity/permissions and mocked bank transport. Browser fixtures exercise the actual React components in English/Khmer at 390, 768, 1024 and 1440 px with reload, pending recovery, stale workspace responses, revoked identity, countdown and bounded checks. They do not verify deployed Next routing, real Auth, bank settlement or true separate PostgreSQL connections. See `docs/evidence/bakong-20261015/checks.json` and browser artifacts for actual final gate results.

Private QR content is delivered as inline PNG data, with no external QR-image request. No egress saving is claimed. Existing billing-history pagination/limits and historical data quality remain outside this focused provider addition. No hosted migrations, account approvals, bank calls, real proof uploads or production settings were changed.
