# Advertiser account-deletion restriction and closure fencing

Local implementation, October 7, 2026. Both TikTok integrations remain disabled.
Database changes are SQL-proposal only and tested in disposable PostgreSQL. No
production schema change, archive, retention period, credentials or deployment is
approved by this change.

## Existing deletion paths

- `app/api/account/delete/route.ts` is the only application caller of Auth
  `admin.deleteUser`. It stages membership redaction/deactivation; it can transfer
  an Owner or expire subscriptions and disable all workspace memberships/channels.
  The application keeps business identity and shared history. Its final channel
  release covers Facebook/Telegram, not TikTok advertiser reconciliation.
- No application business DELETE or advertiser-row DELETE was found. The draft
  advertiser disconnect clears ciphertext after verified revocation; it retains
  the fingerprint, business binding and operation receipt.
- The advertiser proposal has a business FK with `ON DELETE RESTRICT`; its
  `user_id` and `member_id` are plain UUIDs, not Auth/member FKs. Deleting a grant's
  creator therefore does not itself delete the reservation or prevent a surviving
  authorized workspace member from managing the grant.
- The concrete application risk is removing management access to unresolved
  advertiser work. This can happen when closing a last-owner workspace, or when
  deleting the last active authorized Owner, including an expired workspace.
  A remaining agent with `channels/manage` does not replace an Owner. Mere
  membership in a workspace with retained rows is not a
  blocker.

## Scoped behavior

The additional check runs only when `TIKTOK_ADVERTISER_OAUTH_ENABLED` is exactly
`true`. Disabled account deletion makes no advertiser-table requests and requires
no advertiser migration. Existing Billing retention checks retain precedence.

DELETE checks before any destructive staging. It derives workspaces from the
authenticated user's active memberships and the existing server-derived Owner
decision, never from a submitted workspace/user ID. A valid Owner-transfer path
uses the existing eligibility validation and preserves management access. For
ordinary deletion, surviving active authenticated members must have effective
`channels/manage`; workspace closure also affects those managers unless another
Owner causes the existing closure routine to skip the workspace.

DELETE additionally calls service-only `tenh_begin_tiktok_advertiser_account_deletion`
before staging. It reserves operation/user-bound business fences atomically for
workspaces losing their last Owner, using the authenticated user and server-derived
closure/transfer choices. A surviving Owner or validated transfer preserves access.

Affected workspaces with pending, exchanging, connected, failed or revocation-pending
advertiser rows receive a generic 409 blocker. Failed/empty-grant attempts may have
unknown provider outcomes and are not assumed safe. Confirmed disconnected rows
do not block access-only deletion: their reservations and business FK remain intact.
Read failures return generic 503 responses with no raw logging, credentials or
record identifiers. Both responses are no-store. GET checks immediately deletable
accounts, while keeping the existing Owner-decision UI available when transfer
could preserve access; DELETE performs the decision-specific check.

## Coordination contract in the SQL proposal

- Attempt insertion, exchange commencement, closure reservation and direct Owner
  removal share the business row lock. Attempt-first means closure sees unresolved
  work and refuses without setting any fences. Closure-first commits a durable fence
  and denies new attempts or exchange commencement before provider work.
- Saves retain their existing app/fingerprint advisory-lock and attempt-row order.
  Pending/exchanging/failed rows cannot be retired by closure; therefore even an
  uncommitted save leaves visible unresolved work that blocks closure. Saves also
  reject a fenced business. Fingerprint uniqueness and disconnect ownership remain.
- A team-members trigger rejects deletion, deactivation, demotion, loss of user
  binding and reassignment of the last active Owner while work is unresolved.
  Promoting a replacement Owner first permits subsequent removal. Concurrent Owner
  removals serialize and cannot both remove the final authorized Owner.
- `app/api/subscription/usage-management/route.ts` maps that specific database
  rejection to a clear non-secret 409 for member-role and member-access changes;
  unrelated database errors keep their existing behavior.
- A business trigger prevents browser table grants from clearing/setting fences;
  a committed fence cannot be cleared or replaced even by ordinary service writes.
  There is no lease expiry or automatic takeover. The original operation may retry
  its reservation; an interrupted operation remains fenced for controlled review.
- Failed account staging retains existing snapshot restoration, but a committed
  advertiser fence remains pending. Ambiguous reservation results do not proceed
  to staging. There is no recovery endpoint or automatic unfreeze in this change.
- SQL triggers operate whenever the proposal is installed, even if the application
  flag is later disabled. Existing retained grants must not lose protection when a
  rollout is disabled. The proposal is not installed in production.

## Limits and remaining gates

- This is an application preflight, not a proof of production deletion semantics.
  Auth-to-business/member FKs, delete triggers and their transitive effects have
  not been verified. The check cannot certify an Auth deletion against an unknown
  cascade or trigger. RESTRICT remains unchanged, including for disconnected rows.
- The account-deletion saga and Auth API remain separate transactions. Fences and
  database Owner guards protect the declared application paths, but do not certify
  arbitrary production Auth cascades/triggers, Auth identity existence, or storage
  cleanup. Existing trigger interactions, service-role identity/privileges and
  PostgREST execution semantics need permitted non-production preflight.
- Disabled bypass is for the unpublished draft. Disabling a future active rollout
  must still follow the existing reconciliation procedure; disabling the flag does
  not revoke grants or prove that deletion is safe.
- Tests use isolated route doubles and actual disposable PostgreSQL 17.11, synthetic
  tenant/member IDs and mocked providers. Actual locks, ordering, rollback, fencing,
  transfer/removal, role privileges and RESTRICT are exercised. No real account
  deletion or provider call occurs. This is not production Auth FK/trigger proof.
- Browser interaction, hosted log redaction and live provider reconciliation are
  unverified. Vercel access remains restricted; no bypass was attempted.

No fingerprints are released, no CASCADE is introduced, and no 30-day retention
or archive/tombstone policy is implemented.

## Test inventory and final command

The original 80-test baseline comprises 73 advertiser OAuth cases, four account-holder
callback cases and three review-prototype cases. The 77-test command omits the three
prototype cases; it is a narrower run, not a deletion of regressions. Both commands
were rerun locally to establish that difference.

The complete intended suite includes all three baseline files plus account-deletion,
actual PostgreSQL and existing Billing deletion hold/release tests:

```powershell
node --test tests/tiktok-advertiser-oauth.test.mjs tests/tiktok-account-holder-callback.test.mjs tests/tiktok-review-prototype.test.mjs tests/tiktok-advertiser-account-deletion.test.cjs tests/tiktok-advertiser-postgres.test.mjs tests/payway-account-deletion-hold.test.cjs tests/payway-account-deletion-release.test.cjs
```

PostgreSQL requires the existing opt-in psql path and fresh disposable database/run
marker. Never substitute a production connection. Broader logging sanitization is
separately scoped; shared authentication helpers remain unchanged.
