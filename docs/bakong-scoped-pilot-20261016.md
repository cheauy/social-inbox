# CHAT Bakong pilot preparation — local draft

Preparation is authorized. Production installation, deployment, enabling, authorization creation, provider inquiries and payment are **not authorized by that preparation approval**. Neither server flag nor any hosted data was changed.

## Exact scope

- Account `cheauy3@gmail.com`, user `6b84cd6d-deb5-4191-b1c6-0f3861eda892`.
- Workspace `[test] Pro Subscription`, `f79eeac0-db5e-4f3f-8783-2dfb9b818dd9`.
- Active Pro: 12 → 13 connections; 8 users unchanged; existing paid expiry `2027-08-21T10:03:56.418985Z` unchanged.
- Existing `custom-upgrade` pricing/validation/application path; target internal plan code `custom`. No catalog changes.
- Read-only quote at `2026-10-16T04:30:23Z`: USD 32.53. The draft has an absolute ceiling of 3253 cents. Approval must capture a fresh trusted server quote; checkout recalculates and may charge less, never more than that separately approved quote/ceiling. A changed baseline, capacity, renewal cycle, term, catalog price or larger amount fails closed.

## Gates and evidence

`BAKONG_CHECKOUT_ENABLED` remains false. New server-only `BAKONG_PILOT_ENABLED` defaults false. The latter alone grants no access: an explicit private authorization is also required. Normal capacity reviews stay empty; the pilot never writes or pretends to satisfy normal production eligibility.

The draft migration creates an **empty** private authorization table and append-only audit. Constraints restrict this experiment to the exact user/workspace and price ceiling. Each approval binds the current owner membership, credential fingerprint, recipient, canonical full subscription baseline, approved quote, deadlines, approver and human approval reference. It can consume exactly one saved attempt. Approval fields and consumed quote cannot be rewritten, extended, cleared or deleted; revocation cannot be reversed. No browser/API can create approvals. Even `service_role` receives no direct table/sequence/helper-function access; it can only call the limited status RPC and existing payment RPCs.

The issue window is at most 30 minutes. The inquiry deadline is at most one hour from authorization and at least 16 minutes beyond the issue deadline, covering the existing 15-minute QR lifetime. Expiry/revocation blocks new provider claims. It does not destroy an issued payment or revoke a QR that someone already copied.

At most **three lifetime additional inquiries** are claimed in the existing global-budget transaction, across customer and billing-admin paths. Every claimed request counts, including timeouts, provider errors and a crashed worker. The existing 60-second global cooldown, five-minute attempt cooldown, lease, shared rolling capacity/reservations, credential rejection and Retry-After handling remain. Resetting a browser or mutable display counter cannot restore allowance. The three-request ceiling is enforced again inside the database, regardless of app flags or normal capacity approval.

The declared 100-request/day quota and dedicated CHAT token use are **user-attested**. Provider commercial eligibility is recorded as **not independently verified**. Neither field is relabeled as provider-verified capacity. The pilot retains ten requests of shared daily headroom; this is a conservative local gate, not proof of the provider's actual remaining quota. The previously authorized one-off credential probe is outside this attempt ledger; it does not authorize another probe. This preparation made zero provider calls.

After the third inquiry, deadline or revocation, an unresolved attempt stays pending/review with its billing claim, original QR identity, observations and audit intact. The UI hides the QR/check control and says to seek TENH review and **not pay again**. A new purchase intent cannot create another pilot transfer. The pilot provides no fourth-inquiry override or fabricated paid status; further external reconciliation requires a separate explicit approval and review. Already verified evidence can retry the unchanged authoritative activation/invoice path without another inquiry, including after the pilot flag is turned off.

## Reviewed file scope

- `lib/bakong/config.ts`: separate default-off pilot flag; no secret/configuration values added.
- `lib/bakong/payments.ts`, `app/api/bakong/checkout/route.ts`: actor-scoped readiness, private status, fail-closed QR/check display and switch-off of pilot inquiries.
- `lib/bakong/types.ts`, `components/subscription/bakong-payment-view.tsx`: unresolved-payment status.
- `components/subscription/subscription-payment-view.tsx`: customer payment-choice and selected-method labels say KHQR; the user's saved logo displays at 56px wide with automatic height. The adjacent KHQR text supplies the accessible payment-choice name, so the logo is decorative. Underlying provider identity is unchanged.
- `public/images/khqr.png`: user-saved red/white KHQR logo, visually verified at 1248x514. Used in place without overwriting or re-encoding. Its saved PNG representation is 107281 bytes; byte identity with the earlier Library representation is not asserted.
- `db/migrations/20261016043734_bakong_scoped_pilot.sql`: empty private approval/audit structures; immutable attempt binding; contract-checked extensions of existing preparation/claim RPCs. Financial verification, settlement, application, PayWay/manual and invoice algorithms stay unchanged.
- `tests/bakong-pilot.test.cjs`: isolated PostgreSQL fixture and mocked provider regressions.
- `docs/config/bakong.env.example`: documentation-only false flag; this document.

## Production sequence — separate approvals required

1. Review the final diff/tests and approve the precise CHAT migration hash and code release. Do not include unrelated demo edits. Obtain authorized deployment visibility; existing Vercel access denials must not be bypassed. This draft is not committed or pushed.
2. In a coordinated short billing maintenance window, verify installed function bodies/owners/grants and capture the original prepare/claim definitions. The migration uses a two-second DDL lock timeout, preserves existing function OIDs/signatures and aborts transactionally on unknown contracts. Review `ALTER TABLE` lock acquisition on the actual PostgreSQL 17 project; local PGlite does not prove independent-connection contention behavior.
3. With explicit approval, install only the reviewed migration on CHAT `dvieoqprsmzydtepbxwn`, deploy the reviewed code with both flags false, and verify the actual deployed commit and database privileges. No authorization or capacity row is seeded by the migration.
4. Obtain **explicit pilot/payment authorization** for this exact owner/workspace, 13 connections/8 users/unchanged expiry, the freshly recalculated USD charge (never over 32.53), one QR obligation and at most three further inquiries. The approval must acknowledge that quota/dedicated use are user attestations and provider commercial eligibility remains unverified. Recheck active membership, full baseline, pending PayWay/manual/Bakong/upload conflicts, shared obligations and credential/recipient binding immediately beforehand. Preserve `Tenh Bussiness` and other workspaces.
5. Only then may an authorized database owner create one private authorization with the fresh validated quote, exact canonical baseline, specific deadlines, recorded approver/reference and honest attestations. No executable seed containing live recipient/fingerprint or approval row is included here.
6. Separately approve enabling only `BAKONG_PILOT_ENABLED=true`; retain global checkout false and normal capacity approvals empty. Verify every other account/workspace remains unavailable. The owner initiates the single approved payment. Keep credentials in the existing server secret store; never paste/log them.

## Stop / rollback

No destructive down migration is needed. Before issuance, leave the pilot flag false and approvals empty. After issuance, explicitly revoke the authorization and turn the pilot flag off to stop future pilot queries/issuance; an in-flight claimed request can still complete and its evidence must be retained. Keep the migration/cap enforcement and reconciliation-compatible code in place while any attempt is unresolved. Do not restore an old claim implementation that loses the lifetime cap, delete evidence, cancel a potentially paid obligation without authoritative resolution, or ask for another transfer. Valid verified evidence can still be applied exactly once under the original baseline/membership rules.

Structural removal is a later separately approved operation, only after authoritative terminal reconciliation and evidence preservation. It is outside this preparation.

## Verification limits

Tests use synthetic PostgreSQL fixtures (PGlite) and mocked provider observations; no hosted writes, real QR checkout, real transfer or provider request. Existing app tests cover CSRF, removed membership, safe errors and authoritative settlement validation. Independent native PostgreSQL connection races, live provider commercial rules/quota, Vercel secret equality and deployed behavior are not proven by local tests. Production remains blocked on the separate approvals and access above.
