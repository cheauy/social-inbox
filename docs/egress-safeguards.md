# TENH traffic safeguards and rollout

## What this release changes

- Web Inbox: collaboration fallback 3s → 30s while Realtime is healthy. Active-thread fallback 2s → 30s. When any workspace loses Realtime, fallback speeds up to 5s/3s. Focus/reconnect still resynchronizes. Hidden tabs do not poll these routes.
- Mobile: messages/conversation changes request only affected conversations, at most 50 IDs per request. Room changes refresh rooms separately. Message and room refresh revisions are separated. Bursts are debounced and full/targeted requests serialized, so an initial full list cannot be replaced by one row. Workspace and alert fallback polls run once per minute only in the foreground; Realtime access/subscription notifications remain enabled.
- Request-scoped memoization reuses authentication and subscription lookups within selected API requests and server renders. No user/permission decisions are cached across requests.
- Private avatars: authenticated server-side cache (5 minutes), 256px WebP thumbnails, existing private browser cache. The original stored objects are preserved. This avoids downloading the original from Supabase on every cache miss in each browser. Missing images can still recover through the existing Facebook repair flow.
- Media/voice library entries no longer preload media metadata. Full playback remains user-initiated. Private room/quick-reply uploads declare cache lifetimes.
- Existing message pagination remains 25 messages; existing web row rendering remains 40 rows. **The initial conversation index is still loaded in full to preserve global counts, instant statuses, tags, and saved Smart Views. This release does not implement full server-side conversation pagination.** Do not claim it does, or certify capacity for 1,000 tenants from these changes alone.

## Deployment order

1. Run the tests and build listed below. Deploy to staging first.
2. Apply `db/migrations/20260911_tenant_usage_safeguards.sql` to staging. It adds three service-role-only tables and three functions. It does not change any customer record or subscription.
3. Set `TENH_USAGE_MODE=database` on staging. Without it, measurements go only to structured server logs (`tenh.request_usage`). `off` disables persistence and logging.
4. Open **Administration → Usage**. Confirm that traffic from two workspaces is attributed independently and that ordinary members cannot read the admin API or usage tables.
5. Test status/tag filters, pinned and unread counts, merged workspaces, revoked membership, subscription expiry/reactivation, incoming/outgoing messages, reconnect, photo recovery, voice playback, and room membership changes on web and mobile.
6. Run a bounded staging load test with realistic test accounts. Compare API latency, actual Supabase egress, database CPU, and failed requests. Do not generate load against the customer production project.
7. Deploy web and mobile changes. Apply the migration to production, then enable database monitoring. Keep `TENH_ENFORCE_READ_BUDGETS` unset initially.

Migration and production deployment are separate operational steps; local changes alone do not affect your hosted app.

## What the measurements mean

The covered API routes record database request count, decoded database response bytes, storage responses passing through these routes, and successfully uploaded bytes for instrumented uploads. The requesting active workspace owns the measurement, even for a merged-workspace read. Request dates use UTC calendar months, which may differ from your Supabase billing cycle.

Coverage: mobile bootstrap, web live-state fallback, workspace loading, room listing, room uploads, and quick-reply uploads. Direct browser-to-Storage downloads, Realtime, Auth, unwrapped endpoints, and server-rendered initial Inbox queries are not counted. Do not use this estimate for invoicing customers or as an exact global egress cap. Supabase's Usage page remains the billing source of truth.

Measurements persist after the response with one small upsert RPC, so the monitor does not hold up chat. Retain aggregates as needed; no cleanup is automatic. Logs deliberately exclude cookies, tokens, customer names, messages, and signed URLs.

## Budget warnings and optional enforcement

The Usage page highlights a workspace at 80% and 100% of its configured observed-data target. Initially there are no policies and nothing is blocked. There are no external email notifications configured by this release.

After measuring normal traffic, a TENH administrator can configure a policy in SQL:

```sql
-- Use a real workspace UUID and measured values. NULL means no target/limit.
insert into public.tenh_usage_policies
  (business_id, monthly_observed_bytes_budget, read_requests_per_minute, enforce_read_limit)
values ('WORKSPACE-UUID', null, null, false)
on conflict (business_id) do update set
  monthly_observed_bytes_budget = excluded.monthly_observed_bytes_budget,
  read_requests_per_minute = excluded.read_requests_per_minute,
  enforce_read_limit = excluded.enforce_read_limit;
```

Only after setting measured per-workspace read limits, set `TENH_ENFORCE_READ_BUDGETS=true`. Each policy must also have `enforce_read_limit=true`. Limits are atomic across server instances, per active workspace and UTC minute. Covered reads return 429 with Retry-After; a limiter/database failure returns a retryable 503 when enforcement is enabled. No incoming webhook or message-send route is wrapped by this limiter. The fixed window allows a burst at minute boundaries; this is refresh-abuse protection, not a strict byte quota.

Recovery: unset `TENH_ENFORCE_READ_BUDGETS` to disable rate enforcement. `TENH_USAGE_MODE=log` stops database writes while retaining log observations. Keep the additive tables; no data deletion is needed.

## Validation and load test

```powershell
node --test scripts/test-egress-safeguards.cjs scripts/test-customer-avatar-recovery.cjs
npm run build
npm --prefix mobile run typecheck
```

Create a private JSON file **outside the repository** containing staging actors:

```json
[{"cookie":"STAGING_SESSION_COOKIE","businessId":"WORKSPACE-UUID","conversationIds":["CONVERSATION-UUID"]}]
```

```powershell
node scripts/load-test-inbox.mjs --base=https://YOUR-STAGING-HOST --allow-staging --actors=C:/private/tenh-test-actors.json --concurrency=5 --requests=100 --seconds=30 --out=traffic-test.json
```

The test performs only Inbox reads, checks response workspace ownership, and reports response bytes, HTTP failures, and latency percentiles. It accepts up to 1,000 actors, caps concurrency at 100, duration at five minutes, and requests at 10,000. Start small; increase only while database CPU, errors and egress remain acceptable. A successful mock or localhost run is **not** evidence that production supports 1,000 simultaneous businesses.

## Capacity planning before selling at scale

Use actual Supabase Usage data over representative operating days. Measure low-, medium-, and media-heavy workspaces separately. Multiply observed per-workspace traffic by active businesses and agents, add headroom, and compare it with infrastructure cost and plan revenue. Configure provider billing/usage alerts separately. A spend cap protects eligible charges but may interrupt service; it is not an availability guarantee.

The next architecture step is server-side conversation pagination together with server-side Smart View/search/count queries. Do not simply add `.limit(50)` to the shared loader: that would silently hide matches and give incorrect unread/status counts. Keep this as a separate rollout with parity tests on all existing filters.
