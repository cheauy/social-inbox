# Customer payment references

Each saved manual, ABA PayWay or Bakong payment receives one globally unique eight-character customer reference (for example `T7K9M2XP`). The alphabet excludes ambiguous I/O/0/1. References are random identifiers, never authorization credentials.

`customer_payment_references` maps `(source_type, payment_id)` to an immutable unique reference. The service-only, security-invoker batch RPC checks the original saved payment or prepared manual upload. Authorized server readers allocate references lazily, including historical payments; there is no bulk backfill. A manual upload and its finalized payment share the same ID/reference. Existing provider IDs, QR bill numbers, invoice numbers, proof paths, amounts, statuses and entitlement data are unchanged.

The server generates candidates with cryptographic random bytes. The database unique constraint handles collisions across methods and concurrent callers. Only collided records retry, with a maximum of eight attempts. Concurrent allocation of the same payment returns the winning saved reference. History uses bounded batches rather than one request per row.

Apply `db/migrations/20261017122923_customer_payment_references.sql` through the normal separately approved migration process **before** releasing these callers. No Auth settings, grants to human clients, payment functions or provider configuration change. Existing versions continue to work during rollout. If allocation is unavailable, the payment remains valid and the UI says `Unavailable`; it never truncates a provider ID or fabricates a reference. Reload/ordinary saved-status refresh retries allocation without another payment.

Roll back the application first, then revoke execution of `public.tenh_claim_customer_payment_references(jsonb)` from `service_role` if allocation must stop. Retain the ledger and original identifiers for support and reconciliation. Do not drop or rewrite issued references as routine rollback. Existing references survive payment archival.

Local verification uses isolated PostgreSQL, mocked APIs and synthetic UI data. Embedded-database parallel requests exercise idempotent claims; real multi-connection/hosted concurrency and provider payments are not exercised. Do not apply hosted SQL, modify real payments or deploy as part of this local change.

## Verification

- 172 passing tests across two focused runs, including seven new reference tests, existing receipt authorization, payment status, manual review, cancellation/expiry UI and PayWay returns.
- TypeScript passed; scoped ESLint had zero errors and two existing `no-img-element` warnings. Whitespace checks passed.
- Synthetic browser checks showed all eight characters at 390/768/1440px. The admin waiting queue and review dialog both show `Reference`, without ellipsis or horizontal overflow in the constrained app-shell fixture.
- Mocked clipboard tests verify the exact eight-character write and denied-clipboard feedback in English/Khmer. Browser write feedback succeeded, but the browser tool's clipboard readback was empty; actual clipboard end-to-end verification remains unconfirmed.
- The separate Bakong API suite is blocked during its existing fixture migration setup by `Review the installed Bakong intent replay clause` in `20261016093000_bakong_checkout_lifecycle.sql`, before reference code executes. That migration/fixture was not changed here.
- No full application build, hosted migration, production payment, commit, push or deployment was performed for this change.

## Changed code

New: the reference migration, `lib/billing/customer-payment-references.ts`, `components/subscription/customer-payment-reference.tsx`, and `tests/customer-payment-references.test.cjs`.

Wiring: `app/api/subscription/{payment-status,billing-history}/route.ts`, `app/api/subscription/invoices/[invoiceId]/route.ts`, `app/api/manual-payments/admin/route.ts`, `lib/bakong/{payments,types}.ts`, `lib/billing/{payment-attempt,payment-display}.ts`, `components/billing/manual-payment-admin.tsx`, and the subscription payment-attempt, Bakong, success-card, submitted-help, history and receipt views. Updated fixture expectations in `tests/{billing-payment-attempt,payment-success}.test.cjs`. Unrelated concurrent checkout/admin work remains intact.
