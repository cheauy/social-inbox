# Inbox API performance pass — 2026-10-17

Local source diagnosis and review patch only. Continues the unchanged [first pass](inbox-storage-performance-20261017.md) and [interaction pass](inbox-interaction-performance-20261017.md). No commit, push, deployment, hosted database query/migration, real message/send/upload/delete, credential creation, permission change or production load test was performed. Existing v2 patch artifacts are immutable; the API pass is delivered separately and in a new cumulative patch.

## Evidence and attribution

The parent directly inspected the user's Chrome screenshots. This worker uses those reported observations, rather than claiming to have inspected pixels or an attached production browser.

- The long Network capture covered about 170 seconds with Preserve log enabled, cache enabled and no throttling. Small HTTP200 responses included workspaces 2.44–3.16 s, notifications 2.62–3.38 s, live-state 3.14–4.52 s, messages 3.54/4.41 s and conversation-page 3.73–5.64 s. Repetition over that long capture does not establish simultaneous duplicate browser requests.
- The later selected-request Timing image showed queueing 1.32 ms, stalled 0.59 ms, request sent 0.37 ms, waiting for server response **5.39 s**, content download **456.61 ms**, total **5.84 s**. It followed the request to select conversation-page, but the endpoint name is cropped: that attribution is contextual. No Server-Timing metrics are visible.
- About 92% of that one request is in response waiting. It includes network/server work, and does not identify database time, cold starts, regions or any particular query. The download interval also cannot be attributed to JSON parsing or bandwidth from this image alone. The earlier INP13 ms and multi-navigation45.93 s recording remain separate evidence.

This evidence prioritizes the API dependency chains; it does not prove that the changes below eliminate the production5.39 s wait. Actual production before/after latency and actual per-function browser timings remain unmeasured.

## Findings and implemented fixes

1. **Conversation-page repeated its active-membership read.** `getInboxConversationScope` loaded active business memberships, then the page adapter loaded the same user's active memberships again for Smart Views/member IDs. A shared server-only helper now reads `id,business_id` once per verified user and request/render. The page still filters rows to operational `accessibleBusinessIds`, retains all active membership IDs for private-view ownership, and maps duplicate memberships in the scope's existing ascending-created order. Its effective per-business page member is consequently the latest-created row. This makes the former unordered page lookup deterministic; duplicate-membership regression coverage records that choice. Selected/strict workspace authorization remains with the unchanged `getCurrentMember`.
2. **Live-state loaded identical raw active-channel metadata twice.** Discovery loaded it directly, then full row hydration loaded the same projection again. The existing request-local canonical cache now has one shared owner, keyed by sorted/deduplicated business IDs. Distinct/subset business sets remain distinct. Each caller retains its existing platform predicate; user-specific Telegram Personal visibility is still separate and keyed by user. No completed response survives the request/render.
3. **Hydration serialized independent metadata reads.** After successful current-member authentication, subscription metadata, active-channel metadata and Personal visibility now run together. Every gate must succeed before the conversation query, row callbacks, tags or response. The SQL RPC's independent membership/subscription/channel checks are unchanged.
4. **Notifications waited until the entire reminder/read pipeline finished before starting independent privacy metadata.** Those two authorized branches now overlap. An all-settled join waits for both branches even on error, preserving notification failure priority and preventing reminder writes from outliving the handler after a privacy failure. Within its branch, reminder creation still completes before the notification SELECT, so newly due notifications are returned in the same response. The two final hidden-conversation/contact lookups are independent read-only operations and run together. These paths were exercised only with in-memory fixtures, including an explicitly opted-in simulated upsert.

Application changes:

- `lib/inbox/get-active-inbox-memberships.ts` — new request/render-local membership owner.
- `lib/inbox/get-active-inbox-channels.ts` — extracted raw channel metadata owner.
- `lib/inbox/get-conversations.ts` — shared reads and authorized metadata overlap.
- `lib/inbox/get-conversation-page.ts` — reuse and operational filtering of memberships.
- `app/api/inbox/live-state/route.ts` — reuse channel metadata; preserve503 behavior and channel rules.
- `app/api/team-notifications/route.ts` — overlap privacy safely with the preserved reminder/read pipeline.

## Shared-path audit and retained behavior

| Path | Verified source relationship / decision |
| --- | --- |
| API proxy | `proxy.ts` returns through the API branch before its dashboard/Auth `getUser` checks. This code does not support a claim that both proxy and handler independently authenticate every API request. |
| Server Auth | Server `getUser` validates the user and calls session policy validation. The policy verifies the exact session token/claims and invokes `tenh_inspect_session_policy`. Fresh checks remain; there is no new cross-request auth/member cache or substitution of unverified session claims. Their actual production durations are unknown. |
| Request scope | Existing `getCurrentMember`, subscription and privacy deduplication were already request/render-local. The new helpers use that same boundary; rejected helper reads remain retryable. API guards and optional read-budget logic remain unchanged. |
| Workspace list | After auth and memberships, lifecycle RPCs finish before latest subscription/usage reads; five metadata reads already overlap. This GET can write through lifecycle synchronization. Billing/quota/expiry behavior was retained, and it was never invoked against production for this audit. |
| Message newest/older page | Resource authorization includes membership, subscription and Personal access, followed by the route's scoped conversation reread. That reread is retained. Newest/older ordering, cursor pairs,25-row default, reaction hydration and versioned legacy channel repair are unchanged. Fixture measurements of this unchanged route are a control, not a claimed fix. |
| Page SQL | `tenh_inbox_page` rechecks active memberships, subscriptions and channels before complete counts and bounded hydration. No SQL, indexes, schema or RPC contract was changed. The production deployed definition/query plan/index state is unverified. |
| Live-state | Discovery cursor/overlap, known-row rotation, snapshots, hydration/tag reads and reconnect behavior remain. Later snapshot reads can observe newer state than earlier hydration; they were not removed as superficially redundant. |
| Client scheduling | Existing directory sharing, active-request ownership, trailing catch-up, healthy/unhealthy polling and notification producer cadence pass focused tests. The170-second preserved log does not justify deleting those recovery reads. |
| Response | Bounded JSON response and count/data completeness remain intact. No streaming/spinner/error-suppression change was made. Local serialization is separately recorded to avoid treating the whole handler wait as JSON cost. |

## Reproducible controlled measurements

Actual server source runs against in-memory query/auth doubles, with an artificial **20 ms delay per transport**, five alternating fresh-process samples per revision. The data includes30 page rows and25 messages. Native fixture `Response.json` construction and fixture body decoding are recorded separately. A fixed application clock and SHA256 checks require identical response bytes across all baseline/current samples, without masking timestamps, ordering or fields.

The `createClient` double supplies the validated `getUser` boundary; real SDK/Auth/JWT/session-policy operations are **excluded**. Standard fixture budget enforcement is off; usage telemetry is stubbed. Database counts below mean PostgREST/RPC calls observed under that explicit fixture boundary, not a complete production network inventory. The workspace lifecycle RPC is an explicit fixture-only no-op, not a hosted write. Default mutation operations throw unless the reminder test specifically opts into an in-memory upsert.

| Fixture route | Database calls before → after | Maximum overlapping transports before → after | Median handler ms before → after | Response bytes, identical across all10 samples |
| --- | ---: | ---: | ---: | ---: |
| Conversation page | 10 → 9 | 1 → 2 | 344.75 → 275.78 | 28,188 |
| Live-state | 11 → 10 | 1 → 1 | 366.93 → 344.37 | 39,321 |
| Notifications | 5 → 5 | 1 → 2 | 180.08 → 147.09 | 202 |
| Messages, unchanged control | 5 → 5 | 1 → 1 | 182.96 → 181.05 | 9,888 |
| Workspaces, unchanged control | 8 → 8 | 5 → 5 | 158.24 → 148.12 | 595 |

Each route retains one mocked validated-user lookup per request. Native fixture JSON construction for the28,188-byte page had medians0.907 ms before and0.860 ms after. This local fixture does not measure production Next/hosting serialization/compression or client download/decoding.

These local milliseconds include Node/Windows scheduling and the artificial latency. They are not a prediction of production savings. Unchanged messages and workspace handlers are controls; their timing variation must not be presented as optimizations. Per-query timelines, all elapsed samples, payload sizes/hashes and measurement labels are in `docs/evidence/inbox-api-performance-20261017/measurements.json`.

Repeat from the isolated worktree in PowerShell:

```powershell
$env:TENH_API_BASELINE_ROOT='C:/Users/TUF/AppData/Local/Temp/tenh-login-release-20261017'
$env:TENH_API_RAW_DIR='C:/Users/TUF/AppData/Local/Temp/tenh-inbox-api-raw-20261017-repeat'
node tests/inbox-api-performance-compare.cjs
```

No Supabase credentials, production data or external requests are required. The baseline checkout is read-only; dependencies come from the isolated current worktree. Do not compare these fixture times directly with the5.84 s browser total. Single-run measurements from before editing and the initial four red regression cases are also preserved; final comparisons use identical fixture instrumentation for both source revisions.

## Verification

- Focused API/privacy/paging/notification/read-scope checks: **111 passed, 0 failed**. The 12 new API acceptance cases also passed independently, including after the final formatting-only edit.
- Actual React/Flight cache checks: **6 passed, 0 failed, 3 optional historical-artifact comparisons skipped**.
- TypeScript: **passed**. Standard lint for all six API application files: **0 errors/warnings**. The four CommonJS fixture/measurement files pass with `--rule "@typescript-eslint/no-require-imports: off"`, following the prior pass harness convention. An unadjusted tooling invocation flags 11 CommonJS `require` imports; no application errors. Two existing unused-variable warnings remain in older test fixtures. No lint rule/config file was changed. The cumulative UI lint baseline is retained in the preceding interaction evidence.
- Broad run across 65 files: **588 tests, 533 passed, 53 failed, 2 skipped**. All 53 failure names and first error lines exactly match the prior set reproduced on the released baseline. There are no additional failures in this pass; this is not an all-green repository test run. Missing optional test dependencies and existing stale assertions are documented in the preceding evidence.
- Normal production build: **failed**, with `ENOTFOUND fonts.googleapis.com` and Windows `EPERM` creating `.next/server/app/api/contacts/[contactId]/telegram-avatar`. No network, filesystem or compiler bypass was attempted.
- Independent read-only review: **no remaining concrete findings**. It independently passed the 12 API acceptance cases and the actual React/Flight checks, and confirmed zero changed/new-file overlap with the separate Facebook/PayWay patches. Combined integration remains unverified.
- `git diff --check` passed. Exact summaries and logs are in this evidence directory. No commit, push, deployment, hosted database query/write or production customer mutation was performed.

Saved acceptance tests cover canonical/subset tenant keys, coalesced reads, concurrent distinct users, next-request revocation, duplicate memberships and expired workspace filtering, auth/forbidden scope, transient retry, channel/subscription/visibility failures, no content/callback before gates, original Facebook/Telegram predicates, notification overlap and waiting for simulated reminder writes after a privacy failure. Existing notification and visibility suites cover due reminders and preservation of read/realtime behavior.

The React/Flight fixture now labels the shared active-membership query accurately, and distinguishes raw channel metadata from the legitimate separate Personal visibility query. It retains its once-per-scope assertions. Three optional comparisons still require unavailable external historical baseline artifacts; none were fabricated or disabled for this pass.

Read the local AGENTS and installed Next route/cookie guidance before editing; used the existing investigation and Supabase guidance. Official Supabase select documentation was checked; changelog Markdown retrieval was unsupported by the browsing tool. No new Supabase API, auth convention or schema feature was introduced.

## Exact production gaps and release prerequisites

The screenshot supplies client total/TTFB/download timing only. It does not separate browser↔hosting transport, routing/queueing, validated Auth lookup, JWT/session-policy validation, membership/subscription checks, paging RPC execution, channel/privacy metadata, row/tag hydration, serialization or response transfer. The local timelines identify unnecessary dependency edges; **no stage is assigned the production5.39 s**.

Next verification needs a controlled test/staging environment with the same deployed code and scoped per-stage timing, plus targeted read-only query-plan/index inspection by an authorized operator where needed. Keep metrics coarse and free of tokens, IDs, contacts, SQL parameter values or message contents. No broad production log query or load test was performed. Index/RPC proposals require the actual deployed function definition, existing index inventory, a representative bounded EXPLAIN plan and migration/rollback review; this pass provides no evidence to apply an index blindly. Separate Facebook safety SQL was neither merged nor applied.

Before release, integrate the patches on the intended checkout with the independent Facebook/PayWay/auth work, run a normal production build in a working environment, and verify real test-workspace channel/box switches, reconnect/privacy revocation and notification materialization. Actual browser/render/network-before-after measurements and the original30-function cold/warm matrix remain open. Nothing in this pass authorizes publication or production customer mutations.

## Reviewable patch delivery

The cumulative `tenh-inbox-storage-performance-20261017-v3.patch` applies to released35b5fdd. The smaller `tenh-inbox-api-performance-20261017-incremental.patch` applies after the immutable full v2 performance patch. Both are saved in the local Temp directory with SHA256/file manifests and separate apply checks. Earlier patches, reports and evidence remain intact. Use one applicable path; the cumulative patch already contains the earlier Inbox/Storage and interaction changes.
