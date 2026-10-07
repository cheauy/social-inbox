# TikTok advertiser OAuth — disabled implementation draft

Current local closure-fencing and Owner-removal revision: see
`docs/tiktok-advertiser-account-deletion.md`. Its final suite supersedes the
historical validation counts below. Schema remains proposal-only outside the
approved disposable PostgreSQL fixture; both integrations remain disabled.

Prepared October 7, 2026. No credentials configured, SQL installed, provider
settings changed, connections enabled, push or deployment performed.

Proposed production redirect:
`https://app.tenhchat.com/api/tiktok/advertiser/oauth/callback`

Routes:
- `POST /api/tiktok/advertiser/oauth/connect`: authenticated, same-origin start.
- `GET /api/tiktok/advertiser/oauth/callback`: advertiser `auth_code`, not account-holder `code`.
- `GET /api/tiktok/advertiser/connections/[connectionId]`: safe metadata only.
- `DELETE /api/tiktok/advertiser/connections/[connectionId]`: revoke the complete
  provider token and clear its encrypted credential only after confirmed revocation.

The account-holder route `/api/tiktok/oauth/callback` is unchanged and disabled.
These are browser OAuth redirects, not webhook endpoints. No messaging,
advertiser data operations, channel-catalog changes or Billing integration exist.

## Separate approvals required before use

1. Confirm an actual advertiser integration is intended. Register the exact
   callback in TikTok's approved developer app and obtain its generated
   Advertiser authorization URL. Do not use a placeholder redirect.
2. Configure server-only `TIKTOK_ADVERTISER_APP_ID`,
   `TIKTOK_ADVERTISER_APP_SECRET` and `TIKTOK_ADVERTISER_AUTHORIZATION_URL`.
   The URL must be TikTok's `/portal/auth` URL with this App ID and exact
   `redirect_uri`. Never paste credentials into review reports or client code.
   Extra URL parameters are rejected to prevent secrets leaking in browser
   redirects. Confirm the deployment's Node runtime supports native JSON
   reviver `context.source` (the local Node 24 runtime does); older runtimes
   fail configuration validation before issuing a grant.
3. Approve persistent advertiser access explicitly. This narrow draft supports
   only `TIKTOK_ADVERTISER_TOKEN_MODE=long_term`; it never defaults to it.
   TikTok documents non-expiring long-term tokens. A short-term alternative
   needs encrypted refresh-token storage and a separately reviewed renewal
   lifecycle; it is rejected by this draft.
4. Review and manually approve the proposal
   `db/proposals/20261007_tiktok_advertiser_oauth.sql` after live schema preflight.
   It creates one server-only tenant-scoped table for pending attempts and
   encrypted grants, plus two service-only transaction functions for saving grants
   and claiming disconnect operations. It adds no browser grants/policies and does not extend
   `social_accounts`. Existing AES-256-GCM encryption is reused through
   `lib/channels/channel-token-crypto.ts`; do not rotate its deployed key here.
5. Review tenant deletion before activation: the proposal restricts deletion
   of a tenant with advertiser rows. Pending/failed rows must be removed, and
   provider grants reconciled before removing owned rows. Disconnected token
   fingerprints must remain reserved; the service role has no DELETE grant.
   Tenant removal therefore needs a separately reviewed tombstone/archive policy.
   No existing tenant
   deletion or Billing workflow has been changed.
6. Finish isolated SQL/security tests, build and controlled browser/provider
   review. Deployment and setting `TIKTOK_ADVERTISER_OAUTH_ENABLED=true` require
   separate approval. The flag is currently absent/disabled; no connect UI is added.

## Lifecycle and limitations

State is an encrypted, ten-minute envelope bound to the advertiser flow, user,
member, workspace, app and callback. A conditional database update consumes its
hashed nonce exactly once before any provider exchange. Grant saves and disconnect
claims share a transaction advisory lock on app ID/token fingerprint, followed by
the connection row lock. The unique fingerprint is a permanent ownership record,
including after disconnect; it is not the authorization to revoke. Provider
advertiser IDs are stored as verified grants; they are not treated as proof that
the advertiser owns a TENH workspace. Every tenant operation checks membership
and `channels/manage`; revocation remains possible after subscription expiry.

The draft has no direct logging of tokens, authorization codes, cookies or raw
provider errors, and excludes them from responses. Shared auth diagnostics and
hosting/access-log query redaction still need infrastructure review.
`AdvertiserGrantError` carries a token internally for reconciliation; never log
that error object. Unexpected
provider redirects are refused. Callback failure NEVER automatically revokes a
returned token: a failed/malformed attempt cannot prove exclusive ownership across
other in-flight attempts. `provider_cleanup_required` defers action to controlled
reconciliation. An ambiguous save is reported successful only when the exact
tenant-bound attempt is verified connected. An interrupted exchange also needs
reconciliation; a token may have been minted without a received response.

Disconnect atomically reserves a UUID operation owner and start time. Only that
owner contacts TikTok, after checking that the decrypted token hashes to the owned
fingerprint. There is no lease expiration or automatic takeover: a crashed owner
and a slow provider request are indistinguishable. Duplicate requests return 409
without another revoke. New saves cannot take the token during or after disconnect.

TikTok's inspected v2.0 revoke documentation defines success as code 0 and returns
the app ID and advertiser IDs whose access was removed. The draft requires that
success response and matching app metadata. The page does not document an
already-revoked error as equivalent success or guarantee retry idempotency. No
error, timeout, HTTP failure or malformed response is treated as revocation proof.

After verified remote success, the operation owner writes `revoke_confirmed_at`
before clearing ciphertext. It retries that local receipt write once, never the
provider request. A later DELETE with a durable receipt completes only local
cleanup, retaining the operation ID and fingerprint. Lost completion responses
are reconciled against that same operation. If no durable receipt exists after a
crash, timeout or storage failure, retries stay fenced with `reconciliation_required`.

Controlled recovery requires an operator to stop the original executor and verify
the exact app/token ownership across every connection and in-flight attempt. With
documented provider/support evidence of revocation, a separately approved recovery
procedure may record the receipt for the existing operation, then finish cleanup.
Without such evidence, keep the owner/fingerprint reserved; do not infer revocation
from invalid-token errors, delete the row, steal the owner, or blanket-revoke a grant
that another tenant may use. No recovery endpoint/worker or live SQL is included.
This manual recovery process must be approved and exercised before activation.

The proposal adds only `revoke_operation_id`, `revoke_started_at`,
`revoke_confirmed_at`, revised lifecycle checks, and the two transaction functions
to the original table draft. It revokes browser RPC execution and service-role
deletion. None of it has been installed. Default-disabled routes still return
before table/RPC access and need no advertiser migration or credentials; baseline
TENH Supabase configuration remains required by imports.

Pending/failed rows need retention cleanup before general availability, without
discarding owned fingerprints. Disabling the feature flag does not revoke grants
or permit disconnect: reconcile existing grants before disabling an active rollout.

No registration-only exemption was found in the official guides below. TikTok's
Business Messaging access guide requires an approved app and tells new
applicants to include Ad Account Management, CTX Events Management and Measurement
scopes. Any applicant-specific exemption needs TikTok's confirmation. Advertiser
OAuth alone does not confer Business Messaging access or activate account-holder
OAuth.

## Official sources inspected

- https://business-api.tiktok.com/portal/docs/marketing-api-authorization/v1.3
- https://business-api.tiktok.com/portal/docs/create-a-developer-app/v1.3
- https://business-api.tiktok.com/portal/docs/obtain-an-advertiser-access-token/v2.0
- https://business-api.tiktok.com/portal/docs/revoke-an-advertiser-access-token/v2.0
- https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3

## Local validation — October 7, 2026

- Original baseline before drafting: 7 existing TikTok tests passed; TypeScript passed.
- Baseline before the ownership fixes: 58 TikTok tests passed.
- `node --test tests/tiktok-advertiser-oauth.test.mjs tests/tiktok-account-holder-callback.test.mjs tests/tiktok-review-prototype.test.mjs`:
  80 passed (73 advertiser cases plus 7 unchanged account-holder/prototype cases).
  Regression tests model the SQL
  transaction contract and do not prove PostgreSQL lock/constraint/RLS behavior.
- `npx tsc --noEmit --incremental false`: passed.
- Targeted ESLint for the new routes, helpers and test: passed without diagnostics.
- `npm run build`: production webpack build passed, including all advertiser routes.
- Local production server, advertiser gate explicitly false in that process:
  POST start 503; GET start 405; callback 303 with the fixed production redirect
  and `integration_disabled`; metadata GET 503; disconnect DELETE 503.
- In-app browser navigation to the local disabled endpoint was blocked by the
  client. Browser validation is incomplete; no browser/provider approval flow
  was exercised.
- The initial review had no PostgreSQL environment. After explicit user approval,
  official EDB portable PostgreSQL 17.11 binaries were downloaded to a temporary
  folder and a disposable cluster was started only on `127.0.0.1:55437`.
  No Windows service, project dependency, production setting or credential was installed.
  Archive SHA256: `80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F`.
- `tests/tiktok-advertiser-postgres.test.mjs`: 12 passed, including the parent
  test and 11 database scenarios. The unchanged proposal was applied only to
  `tenh_advertiser_validation`, with synthetic tenant/member/user IDs and a
  marker checked before setup. Browser roles were `NOLOGIN`; the service role
  was `NOLOGIN BYPASSRLS`. No production Supabase SQL was executed.
- Actual `pg_locks` waits were observed between competing saves, competing
  disconnect claims, and a grant save competing with a disconnect claim.
  Terminating an isolated transaction owner rolled back its grant and released
  the lock so the competing tenant could save. A committed owner excluded the
  competing tenant. These checks use session names below PostgreSQL's length limit.
- The real DELETE handler ran through the existing TypeScript loader with a
  PostgreSQL adapter and mocked provider responses. A persisted receipt allowed
  storage-only recovery after clearing failed. No receipt, provider timeout or
  nonzero provider error preserved ownership and blocked another provider request.
  Disconnected fingerprints rejected late saves; physical tenant deletion failed
  with FK violation as expected; the service role could not delete rows.
- Isolated tests used a minimal `businesses(id uuid)` fixture and a native psql
  adapter, not Supabase Auth/PostgREST. Production schema/role compatibility and
  hosted transaction behavior therefore still require preflight in an approved
  non-production Supabase environment. Live provider behavior remains untested.
- The ownership fix changed five of the eight draft files. This task did not change
  account-holder or existing tracked source. Concurrent unrelated Inbox/navigation
  edits were left untouched. Both TikTok integrations remain disabled.

## Controlled reconciliation procedure — approval required before live use

1. Freeze new authorizations and operations for the affected tenant/app. Keep the
   integration disabled during this draft's review. Identify the connection,
   tenant, app and existing operation owner without copying tokens, ciphertext,
   authorization codes, state cookies or full callback URLs into logs/tickets.
2. Stop or drain the original executor and establish that it cannot issue another
   request. Age alone is not proof: neither a stale timestamp nor a client timeout
   shows that TikTok did not execute the request. Do not expire or replace the owner.
3. Inspect the exact connection/operation under a maintenance row lock. If a
   durable verified receipt already exists, finish only the local transition to
   `disconnected`, clear ciphertext, and retain the app/fingerprint and operation.
   The live route can perform this storage-only retry when otherwise approved;
   with the feature disabled, it returns disabled and must not be enabled just
   to run recovery. Any maintenance SQL needs separate approval.
4. Without a durable receipt, obtain authoritative, token-specific evidence from
   the provider's documented success response or an approved support/reconciliation
   process. Verify the exact app/token owner and every competing attempt/tenant.
   Invalid-token errors, an empty history search, disappearance from a nearby
   account screen, and generic app-wide revocation are not sufficient evidence.
5. If that evidence exists, an approved maintenance transaction may record the
   receipt for the same connection, business, app, fingerprint and operation ID,
   then clear ciphertext. If ownership or outcome remains uncertain, leave the
   reservation/credential intact and escalate. Never blanket-revoke a shared grant,
   transfer the fingerprint, replay the provider request, or mark success from an error.
6. Verify the terminal state and late-save exclusion. Keep an audit of nonsecret
   IDs, evidence source, approved actor and timestamps. No automatic reconciliation
   worker or provider-backed recovery endpoint is implemented in this draft.

The database tests exercise the handler's recovery states with provider mocks;
they do not approve this operational procedure or prove live provider evidence is available.

## Fingerprint retention and tenant deletion

- Retain app/token fingerprints after successful disconnect. Clear the encrypted
  token only after a verified receipt; retain operation ID and timestamps. There
  is no TTL, automatic ownership transfer, or assumption that a provider will never
  return the same token again. No service-role DELETE privilege is granted.
- Pending/failed rows with no fingerprint may be considered for retention cleanup
  only after their state/in-flight execution and any unknown-grant reconciliation
  are resolved. A failed status or absent fingerprint does not prove no grant was minted.
- For tenant offboarding, first prevent new tenant operations using the approved
  access/offboarding process, drain attempts, and reconcile/disconnect every owned
  grant. Retain the business identity record and its fingerprint rows. Do not delete
  ownership rows to make the business FK pass.
- Hard deletion is currently blocked: the one-table design ties permanent
  fingerprint reservations to `businesses(id) ON DELETE RESTRICT`. This was verified
  in PostgreSQL. No current procedure can both remove the business row and preserve
  those reservations in this schema.
- If physical deletion is required, separately review a provider-grant tombstone
  registry independent of the live business FK, its retention policy, and an atomic
  transfer that keeps every app/fingerprint reserved while saves/claims are frozen.
  Do not apply a cascade, drop the FK, or release fingerprints as a shortcut. No such
  registry migration is proposed or installed by this validation task.

## Logging and browser review

The advertiser handlers contain no direct logging. Unit/database tests capture
mock console output and assert no logs in failure/recovery cases. Built disabled
HTTP checks use a synthetic callback marker; local runtime output did not contain
that marker. Responses use generic reasons and no-referrer/no-store headers.
These headers do not redact the incoming URL in hosting/access logs.

Shared auth helpers still log raw Supabase error objects, and
`AdvertiserGrantError` contains an internal token property. Neither is proof of
global redaction; do not introduce error-object or request-URL logging here.
The existing usage helper records the pathname rather than the query. The checked
`vercel.json`/Next configuration provides no evidence of hosting log/drain redaction.
Vercel browser access was rejected by a saved user permission setting. That setting
was respected; no CLI, proxy or alternate browser was used to bypass it. Hosting
query/header/cookie redaction remains untested pending permitted access or a
sanitized configuration export. No real authorization code or credential was used.

The permitted local browser reached the login page without signing in. Direct
navigation to the advertiser metadata API returned `ERR_BLOCKED_BY_CLIENT`;
the same route passed the HTTP disabled check. No alias, proxy, policy change,
credential entry or security-control bypass was used. Advertiser browser-flow
validation remains untested; login-page availability is not OAuth-flow proof.

## Gate status

| Gate | Status | Evidence / limit |
| --- | --- | --- |
| Default-disabled routes and preserved account-holder flow | PASSED | 80 existing/mock tests; five built HTTP checks; unchanged runtime-source hashes |
| Migration and lifecycle constraints | PASSED | Exact proposal installed only in approved disposable PostgreSQL 17.11 |
| Actual advisory locks and concurrent save/claim ownership | PASSED | Observed waiters in `pg_locks`; commit/crash and cross-operation tests |
| Tenant/member/user RPC bindings | PASSED | Wrong-tenant/member/user calls rejected; server guard tests retained |
| Table/RPC privileges and actual RLS | PASSED | Browser roles denied; temporary SELECT still returned zero rows; service deletion denied |
| Crash recovery with/without persisted receipt | PASSED | Real handler + PostgreSQL; provider responses mocked |
| Fingerprint retention and deletion protection | PASSED | Late saves excluded after disconnect; business FK rejected deletion |
| Physical tenant deletion compatibility | FAILED | Permanent reservations still depend on business FK; independent archive design needs separate approval |
| Controlled live reconciliation | UNTESTED | Procedure documented; provider-specific evidence and operational approval still required |
| Production schema/roles and hosted PostgREST behavior | UNTESTED | Native local fixture cannot prove deployed Supabase compatibility |
| Local browser login availability | PASSED | Permitted browser loaded login without credentials |
| Advertiser browser OAuth flow | UNTESTED | API navigation blocked; no bypass or activation |
| Draft application logging | PASSED | Source review, mock error capture and synthetic disabled HTTP marker |
| Hosting/query-log redaction | UNTESTED | Vercel access blocked by saved permission; no settings changed |
| Live provider exchange/revocation | UNTESTED | All provider responses mocked; no live requests |

PostgreSQL validation is opt-in. Create a fresh disposable cluster/database and
`public.tenh_validation_marker(run_id uuid)` only after approval; use database
`tenh_advertiser_validation`, loopback port `55437` and owner `tenh_validation_admin`.
Set `TENH_ADVERTISER_TEST_PSQL` to that portable psql executable and
`TENH_ADVERTISER_TEST_RUN_ID` to the marker UUID, then run
`node --test tests/tiktok-advertiser-postgres.test.mjs`. The test does not download
binaries, load app environment files, accept a production connection URL, or
provision a database automatically. It expects a fresh fixture database/roles.
Stop the disposable PostgreSQL process after validation; no service/autostart is used.
