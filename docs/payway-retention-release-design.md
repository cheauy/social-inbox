# Billing account retention release — local review candidate

Not installed or deployed. The prior FED8 SQL artifact is superseded by this changed core and must not be used to approve this release. Installation alone leaves all six historical Sandbox payments pending and held; it never calls the operator-release function.

## Actual lifecycle and scope

User-supplied lifecycle results on 2026-10-03 establish team_members.user_id → auth.users.id ON DELETE SET NULL. Auth deletion retains the member row and payment requester UUID. Payment/manual requester FKs point to members with SET NULL, while business payment FKs cascade. The retained-payment guard continues to reject member deletion that clears the requester, and physical business deletion that cascades financial history. The application already stages profile cleanup and deactivates access while retaining workspace rows.

The owner-only tenh_billing_private.release_account_deletion authorizes account Auth unlink only under preserve_member_reference_redact_member_profile. PUBLIC, anon, authenticated and service_role cannot call it or access its private audit. No customer API performs operator release. It does not delete Auth, members or businesses; change payments, invoices or subscriptions; approve payment; or settle a financial case.

An operator must supply a unique release reference, opaque operator reference, and an exact review for every affected retained payment: immutable identity fingerprint, actual status, explicit disposition, authoritative case-review evidence reference and SHA256, plus actual JSON booleans acknowledging account-unlink-only scope and financial preservation. Pending cases can be explicitly reviewed as retain_unresolved_recovery: their financial recovery stays pending. No age, provider not-found, ordinary error or customer assertion automatically releases an account. Terminal cases require the existing authoritative resolution audit. Approved cases require the guarded approval audit and a paid receipt matching payment, workspace, amount and currency. A checksum pins supplied evidence; it does not establish its truth.

## Locks, replay and limited lifetime

New grants lock all affected subscriptions, then payments in deterministic UUID order, and reread the exact affected membership/payment snapshot and competing unresolved PayWay/manual purchases. Partial, duplicated, mismatched or extra evidence fails. Newly committed competing purchases block release. Identical concurrent release calls reread the reference after waiting and return the same immutable grant. Different inputs with an existing reference fail.

Permission expires 30 minutes after release. Expiry, new conflict evidence, changed payment state/membership, or a competing unresolved purchase makes the grant ineffective. Exact replay cannot renew expiry or refresh a stale snapshot; a new operator review and reference are necessary. The audit remains append-only after expiry and Auth unlink. It retains Auth/member/workspace/payment identifiers and operator/evidence references, not an additional name/email copy; these identifiers remain pseudonymous. The lifetime limits authorization, not audit retention. Audit retention/deletion requires its own reviewed policy.

The account route checks the service-only read-only hold before ownership changes, closure, membership staging and Auth deletion. Supabase Auth and application staging are separate requests. Preflight is not an atomic guarantee through Auth deletion. Tests prove the specified database lock paths and preservation, not immunity to arbitrary concurrent privileged changes outside that workflow. Deployment requires a verified write pause and lifecycle review.

## Paid access and financial preservation

Operator release does not permit premature workspace closure while payment recovery remains pending. The subscription trigger rejects cancellation, clearing or shortening a saved expiry, and transitioning to expired/suspended before a future paid expiry. Ordinary expiry after the paid term passes is allowed. Owner transfer or another continuing owner can permit account unlink without ending unresolved workspace access. Financial dates, capacity, amounts, quotes, provider IDs and receipts remain unchanged by release.

Auth unlink retains the member ID and payment requester. Profile staging does not invalidate the grant because its snapshot excludes name/email/active fields. It does not anonymize invoice customer details or provider/reconciliation payloads, nor promise legal retention compliance. Those data need a separately reviewed policy; immutable financial evidence cannot silently be erased.

## Evidence and validation

The user-supplied FK/DELETE-trigger metadata shows only internal RI DELETE triggers on the selected lifecycle tables; no application DELETE trigger was present. All reported constraints are validated. Money metadata confirms three columns are numeric(12,2). These are user-supplied observations, not independently fetched live. Their semantic summaries are retained privately; do not claim a full byte capture for the FK/trigger messages. The original capture and all twelve PostgreSQL fingerprints remain unchanged.

Dedicated PGlite checks cover actual SET ROLE restrictions; invalid, partial and wrong-user evidence; immutable grant/audit; pending case review without financial mutation; Auth SET NULL preservation; hard member/business deletion guards; replay/stale replay; expiry; authoritative terminal audit and receipt mismatch; and paid-access closure. The targeted native harness covers changed release/creation/closure/Auth-unlink wait paths and reports actual PostgreSQL blockers and deadlock counts. Local Python syntax validation is not a native execution. Current review-packet logs identify exactly which checks were run and their remaining gates.

Production SQL/settings, payment operations, deployment and historical resolution remain separately controlled by the parent review and exact-artifact approval process. No new feature, TikTok or Bot work is included.
