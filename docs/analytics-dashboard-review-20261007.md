# Analytics dashboard and correctness review — October 7, 2026

The overview redesign and its SQL proposal are local. **The new overview is fixture-verified, not production-verified. All analytics are not certified correct.** Existing report formulas are retained with explicit scope/verification notices. The Channel report's lifetime-history/outgoing-first gaps and the legacy timezone grouping gap remain. No production SQL, deployment, push, real messages or provider operations were performed. Both TikTok integrations remain disabled.

## Implementation and deployment boundary

The overview renders one aggregate response. It does not mount reports in hidden panels, download message history, create realtime subscriptions or poll. The existing report components, chart approach (native SVG), navigation and loading ownership helper are reused. Current queue cards remain independent of date filters. Charts include keyboard-accessible exact values, three distinct channels, 24 hour buckets and local scrolling on narrow screens.

Runtime chain: `components/analytics/dashboard-overview-panel.tsx` → `lib/analytics/use-analytics-filters.ts` / `use-analytics-request.ts` → `app/api/analytics/overview/route.ts` → proposed `public.get_tenh_analytics_overview` in `db/proposals/20261007_analytics_overview.sql`. `lib/analytics/overview-metrics.ts` rejects missing, partial or non-reconciling results. Missing RPC/schema compatibility returns **503/unavailable**, with no misleading legacy fallback. Deploying the overview before installing and separately validating the approved proposal therefore leaves its metrics unavailable. The proposal is not an installed migration.

Rollback: revert only this analytics patch, retain existing report RPCs and all customer data. The additive overview function has no writers, triggers or new tables. If installed later, separately revoke/remove its function only after reverting callers; no data deletion is required. No rollback action was performed.

## Shared definitions

**O scope:** authenticated, active member's selected business; shared Facebook Messenger, Facebook Comments and Telegram. Conversation and social-account business/platform must agree. Spam, Telegram Personal and other platforms are excluded before aggregation. Historical response attribution accepts same-business member records, including now-inactive members, but excludes recognized automation (`auto_reply_job_id`, `tenh_bot_job_id`, `tenh_bot`, `facebook_auto_private_reply`). Other outgoing authors are unknown. This is a verified-attribution definition, not a claim that every provider reply carries complete human/bot provenance.

**P period:** `[start,end)`, using `coalesce(platform_created_at,created_at)` for message events; recorded `created_at` for status events. Today/yesterday use midnight in the selected IANA timezone, respecting DST. 7/30/90-day windows are rolling 24-hour days. Exact UTC bounds travel to drilldowns. O buckets use IANA `timezone()` explicitly. Maximum SQL window is 91 days. Duplicate provider delivery is excluded by the existing unique provider-event identity; the fixture tests redelivery under that constraint. Differently identified duplicate events cannot be inferred as duplicates by this read-only aggregate.

**C snapshot:** current stored open/pending state and unread counters at query time; outgoing/incoming cycles and reminder due times evaluated against the independent server snapshot timestamp. No historical-state reconstruction is implied.

**L legacy:** original deployed RPC/report definitions, each scoped to authenticated business. The web API rejects the whole RPC report **before aggregation** if hidden Personal accounts exist, because these deployed signatures cannot permission-filter their populations. This may make a report unavailable; it prevents hidden channels influencing totals. Channels and Workload apply visibility to their raw queries before calculation. Future shared-channel restrictions require revisiting the SQL allowlist; none are invented here.

Unique identifiers: conversations/comment threads = `conversations.id`; individual incoming/outgoing/system events = `messages.id` and provider identity; customers = saved `contacts.id`; reminders = `conversation_reminders.id`; members = `team_members.id`. Same display names across channels are not merged. A thread is never interchangeable with an individual comment/message. Counts have no percentage denominator unless one is explicitly listed below.

## Overview metric source and definition map

All rows use O scope. Sources are CTEs in the SQL proposal; runtime fields have the same names. Fixture expectations are independently hand-counted in `tests/analytics-rpc-audit.test.cjs`, not copied from the SQL response.

| Metric / field | Source, unit and distinct population | Window / denominator | Expected → actual | Status |
|---|---|---|---|---|
| Unassigned | `current_threads`; unique open/pending Inbox IDs with null `assigned_to`, includes comment threads | C; none | 6 → 6 | PASS local |
| Unread conversations | `current_threads`; unique open/pending Inbox IDs with `unread_count>0`, includes comments | C; not sum of unread messages | 8 → 8 | PASS local |
| Waiting beyond SLA | `current_cycles`; first incoming after latest verified human reply and reopening; bots do not end waiting, unknown replies exclude timing | C; elapsed strictly greater than target | 4 → 4 | PASS local |
| Unknown waiting coverage | `current_cycles`; unique waiting IDs with unverified outgoing authors | C; excluded from waiting SLA count | 1 → 1 | PASS local |
| Overdue | `conversation_reminders` joined to O; open reminder IDs strictly before snapshot, even when conversation is closed | C; reminders, not conversations | 3 → 3 | PASS local |
| Conversations | `received`; unique messaging IDs with any period incoming event; old conversations included, comments separate | P; none | 8 → 8 | PASS local |
| Comment threads | `received`; unique comment-thread IDs with incoming individual comments | P; none | 1 → 1 | PASS local |
| First responses | `responses`; first verified human outgoing at/after first incoming in P, reply also in P; unknown earlier/equal outgoing excludes sample | P; one sample per messaging ID | 4 → 4 | PASS local |
| Average first response | mean of the four conversation-level durations; no agent-median averaging | seconds; completed evaluable first responses | `(300+120+480+180)/4 = 270` → 270 | PASS local |
| SLA met | same first human response samples at/below target | P; count of eligible IDs | 4 → 4 | PASS local |
| SLA missed | evaluable human samples above target plus evaluable unanswered IDs overdue at **period end** | P; unknown and still-within-target unanswered excluded | 2 → 2 | PASS local |
| SLA denominator | met + missed | P; unique eligible messaging IDs | 6 → 6 | PASS local |
| SLA rate | rounded `100*met/denominator` | 4/6, not 4/8; null if denominator=0 | 67% → 67%; empty null → null | PASS local |
| Human timing coverage | evaluable / all received messaging IDs; unknown population separately counted | P; 7/8 evaluable, 1 unknown | 7 / 1 → 7 / 1 | PASS local |
| Resolved activity | `resolution_events`; first recorded closed/resolved event after cohort incoming, one per messaging ID; reopening does not double count | P; distinct recorded resolution IDs | 2 → 2 | PASS local; historic event completeness UNVERIFIED live |
| Daily received / resolved | `daily_activity`; bucket cohort first incoming / first resolution independently in selected IANA timezone | P; sums exactly 8 / 2 | 8 / 2 → 8 / 2 | PASS local |
| Incoming / outgoing volume | `period_messages`; individual incoming/outgoing events including comments; excludes system/other directions | P; 12 / 12, total24; each share denominator24 | 12 / 12 → 12 / 12 | PASS local |
| Human / bot / unknown outgoing coverage | attributed, known automation, other authors; automation remains bot even with member ID | P; partition of 12 outgoing messages | 9 / 2 / 1 → 9 / 2 / 1 | PASS local |
| Messenger / Comments / Telegram bars | `channel_counts`; messaging IDs / comment-thread IDs with incoming P activity | P; common denominator `8+1=9` Inbox threads | 7 / 1 / 1 → 7 / 1 / 1 | PASS local |
| Channel percentages | channel unique-thread count /9; 77.8%,11.1%,11.1% | comment thread ≠ individual comment | exact fractions → displayed rounded shares | PASS local |
| Busiest hours | `hours`; all incoming individual messages/comments, not first-incoming conversations; all24 buckets | P; IANA timezone; sum12 | UTC00=2,01=2,02=1,03=1,04=2,05=2,20=1,23=1; other16=0 → same | PASS local |
| Active customers | `customer_active`; unique allowed saved contact IDs with any P message event, including system events | P; no cross-channel identity merge | 10 → 10; extra system-only contact11 → 11 | PASS local |
| New contacts | `customer_scope`; FB/Telegram saved contacts created in P, may have no activity | P on contact creation; **not** subset of active | 4 → 4 | PASS local |
| Returning customers | older saved contacts with incoming P activity in O | P; **not** complement of new | 7 → 7 | PASS local |

New + returning =11 while active=10 is intentional: two newly created inactive contacts contribute to new. These are the verified existing definitions, shown as separate counts with explicit explanation; there is no fabricated partition/doughnut of active customers.

## Detailed report audit and fixture checklist

Actual deployed definitions, obtained by authorized metadata-only reads, are preserved in `docs/evidence/analytics-redesign-20261007/reviewed-rpc-definitions.sql`: Agent line4, Conversation line281, Customer line776, SLA line1068. Catalog evidence is `reviewed-catalog.json`. No customer rows were read. These copied definitions were executed in fresh in-memory PostgreSQL fixtures. Matching deployed labels/schema behavior was not inferred from a frontend name.

For metric-by-metric expected/actual summary rows, see `docs/evidence/analytics-redesign-20261007/metric-checklist.md` and `fixture-results.json`. PASS means the stated source definition was reproduced locally; it does not mean two different report populations are interchangeable. FAIL rows name the incorrect broader interpretation. UNVERIFIED rows lack adequate fixtures or live evidence.

### Team Performance

Chain: `sla-analytics-panel.tsx` → `/api/analytics/sla` → `get_tenh_sla_analytics`.

- Received = distinct period-incoming conversation IDs, excluding comments/spam but including Personal in deployed SQL. Responded = first outgoing after first incoming, human **or bot/unknown**, with reply permitted exactly at end (`<=end`). Waiting = received minus responded. Counts have no denominator.
- Mean/median first response are seconds across completed conversation samples (not agent summaries). SLA met includes completed replies within target; missed includes late completed replies plus overdue unanswered; SLA waiting is unanswered within target. SLA rate denominator met+missed. Web API now returns null for empty denominator instead of deployed SQL100%. Bots remain part of this explicitly different detailed report definition.
- Resolved and mean resolution seconds are inferred from current resolved/closed status timestamps after first incoming; reopening can erase a historical resolution from this result. They are **FAIL as complete resolution history**, disclosed.
- Daily rows use first-incoming dates and that day's response/SLA samples; attention rows are a capped subset, with per-conversation seconds/current elapsed time. Do not total capped attention rows to reconstruct the overall report.
- Fixture: received9, responded8, waiting1; durations `[300,120,60,120,60,3300,60,180]`: mean525, median120; met7, missed2, waiting-within-target0, rate78%; resolved1, mean resolution300. The new overview intentionally has8 received,4 human responses,67% human SLA,2 recorded resolutions.

### Agent Performance

Chain: `agent-performance-panel.tsx` → `/api/analytics/agents` → `get_tenh_agent_performance`.

- Outgoing volume = P message IDs; attributed = known same-business member attribution; unassigned author = other outgoing. Attribution rate denominator total outgoing; empty denominator now null. Counts include bots when attribution does not distinguish them; this is **not verified human performance**.
- First response populations use first outgoing after incoming (including bots/unknown, end-inclusive reply boundary). Total/attributed/unattributed first responses are separate populations. Summary mean and SLA apply to attributed first samples only. Labels now say “Attributed first responses” and “Attributed SLA met”. They must not be presented as overall human results.
- Per-agent first responses, mean/median seconds, met/missed/rate use that member's first-sample subset. Outgoing messages count member-attributed event IDs. Conversations replied count distinct member/conversation pairs (comments excluded); members may overlap. Resolved actions count that member's recorded resolution events, including repeated actions; not unique resolved threads.
- Fixture summary: outgoing13, attributed10, unattributed3, coverage77%; first responses8, attributed5, unattributed3; attributed mean `(300+120+120+3300+180)/5=804`, met4/missed1, rate80%. Human-only overview4 samples cannot be reconstructed by summing these counts or averaging medians.
- Member1: first3, mean1240, median300, met2/missed1/rate67%, outgoing6, conversations5, resolved actions3. Member2: first2, mean150, median150, met2/missed0/rate100%, outgoing4, conversations4, resolved actions0. Summing replied conversations gives9 while union has7; two threads have both agents. Recorded duplicate resolution actions intentionally count as actions here, once as a resolved conversation in overview.

### Conversation Reports

Chain: `conversation-reports-panel.tsx` → `/api/analytics/conversations` → `get_tenh_conversation_reports`, plus separate period-due reminder count.

- Received = distinct IDs with P incoming, including comment threads/spam. Resolved = first recorded resolution after received-cohort incoming, once per ID. Resolution rate denominator received IDs, not all open Inbox. Daily received/resolved sums match that cohort.
- Current open/pending/resolved/closed/spam status, unread conversations (`unread_count>0`), unassigned IDs and status bars are **period-received-cohort current state**. They are **FAIL as complete current queue**, explicitly disclosed.
- Incoming/outgoing messages are P event IDs across the business message population, including outgoing-only threads; total messages includes system events. They are not restricted to the received cohort. The overview also includes outgoing-only threads, but filters its three allowed shared channels and excludes spam before counting.
- Waiting is latest cohort incoming without later outgoing, still open/pending, overdue at end; bots end waiting. Capped waiting rows expose seconds/unread message counts, not complete queue counts.
- Channel rows are distinct IDs and P incoming events grouped Comments vs everything else as “messenger”, so Telegram is mixed into Messenger. Busy-hour rows count cohort **first-incoming IDs**, sorted to the top six, not all incoming messages. Both are **FAIL as separate three-channel/full-24-hour activity**, disclosed.
- Overdue reminders appended by the API use reminder due time inside P; they do not match the overview's all-date current overdue snapshot. Visibility applied before the reminder query. Reminder count error becomes null, not0.
- Fixture: received11, resolved2, resolution18%; open9,pending0,resolved-state0,closed1,spam1; unread6,unassigned3,waiting2; incoming14,outgoing13,total28 (one system event). Overview8 conversations+1 comment thread excludes Personal/spam; differences are intentional.

### Customer Insights

Chain: `customer-insights-panel.tsx` → `/api/analytics/customers` → `get_tenh_customer_insights`.

- Total = saved contact IDs in business. New = contact creation P, including inactive. Active = any P message on any saved contact; returning = pre-P contact with incoming P. Identity stays `contacts.id`. No assumption of cross-channel mapping.
- Inactive30days uses stored contact last-contact/creation fields, not a reconstructed message-activity ledger. Open customers = unique saved contacts with currently open/pending conversations. These are current/all-contact populations, not P message counts.
- Messages-in-period includes system events; incoming/outgoing are separate direction counts. New daily growth follows contact creation. Top customers are capped per-contact P message counts, incoming/outgoing counts and distinct conversation IDs; not a global customer population.
- Tag counts are saved contact/tag relationships (a contact can appear under several tags). They cannot be summed to unique customers. Nonempty tag fixtures are **UNVERIFIED** in this change; empty array is verified only.
- Channel rows count P messages/distinct contact IDs/distinct conversation IDs; Telegram is combined with Messenger. **FAIL as Facebook-only Messenger attribution**, disclosed. New+returning is **FAIL as an active partition**; UI explicitly explains that difference.
- Fixture: total18,new4,active12,returning9,inactive30days14,open14; messages28,incoming14,outgoing13. All-contact/privacy scope differs from approved overview O. Restricted channels prevent running this legacy aggregate through the web API; raw SQL fixture intentionally demonstrates the deployed risk.

### Channel Performance

Chain: `channel-performance-panel.tsx` → `/api/analytics/channels` → bounded/paged conversation queries + `read-channel-messages.ts`; no SQL RPC.

- Cohort = conversations **created** in P. Reads their entire incoming/outgoing histories server-side. Facebook comments separated from Messenger; accounts/platforms remain identity keys. Old conversations created before P are absent even if active now.
- Per-channel conversation count is cohort IDs. Incoming/outgoing are lifetime direction events in that cohort; newCustomers is distinct cohort contact IDs (not verified contact-creation-new customers). Current status, unread and assignment counts are cohort snapshots.
- Response uses earliest incoming and earliest outgoing; outgoing-before-incoming can mask a legitimate later response. Mean/median completed durations and answered/unanswered/SLA all inherit this limitation. SLA denominator answered, excluding unanswered; zero denominator null. These are **FAIL as period activity/overall SLA**, disclosed rather than silently redefined.
- Summary excludes comments from overall conversation/response populations; chart rows include them. Incoming/outgoing totals and per-day received/replied events can include history outside P. Previous period compares prior **created** cohort IDs; percent change denominator previous count, null if0/unavailable.
- Independent route fixture baseline: messaging conversations4,incoming6,outgoing5,answered2,unanswered2,mean125s,comment-thread1/mean75s. Added old incoming event: strict P expectation6, actual7. Added legitimate reply in outgoing-first thread: expectation3 answered, actual2. See `channel-fixture-results.json` for FAIL evidence. Exact drilldown bounds now reach its creation-cohort query unchanged.

### Team Workload

Chain: `agent-workload-panel.tsx` → `/api/team/workload` → paged current conversations/reminders; optional `get_tenh_live_workload`.

- Per-member open/pending counts = current assigned conversation IDs; active=open+pending. Unread sums unread **message counters**, now labeled “Unread messages”. Unassigned is workspace open/pending IDs with no member, separate from member sums. Overdue counts open reminder IDs due before now, by assigned member. These are C snapshots regardless of URL period.
- Reminder query now joins same-business conversations and filters hidden accounts before counting. Paged reads are complete or error, not silently truncated at1000. Fixture1001 assigned chats yields1001 active,5 unread messages,1 authorized overdue reminder; private/foreign reminders do not contribute. Failed reminder page returns error/no zero cards.
- `get_tenh_live_workload` is **absent from the inspected deployed catalog**. Optional live averages/SLA/waiting data are **UNVERIFIED/unavailable**, not reconstructed from per-agent statistics. Private-account scope blocks calling that unscoped RPC. Existing unrestricted call handles absence as unavailable.
- Current report coverage differs from O (additional authorized platforms may exist). Report totals omit unassigned work in member sums. Do not equate these samples with overview human-response/three-channel figures.

## Timezone, permissions and incomplete evidence

Legacy date/hour SQL subtracts a numeric offset from a timestamptz and casts to date/extracts hours without fixing the database session timezone. In the isolated +07 session with requested offset0, Oct5's received11 appears as Oct5=9/Oct6=2; after `SET TIME ZONE UTC` it becomes Oct5=11. The new overview remains unchanged. Production PostgREST's session timezone and DST handling are **UNVERIFIED**; URL timezone preservation alone does not establish bucket correctness. Correcting these deployed RPC definitions is a separate SQL proposal, not silently included here.

The fixture verifies active membership, workspace mismatch rejection before RPC, cross-tenant account/member identity, hidden-channel rejection before legacy RPC, unauthorized execute-role rejection, and request fencing. Runtime uses server-selected workspace, not a caller-supplied tenant. An old ignored-abort response cannot replace a new workspace/filter result. Real PostgREST transaction settings/RLS/grants and representative server query plans remain unverified.

## Verification and resource evidence

Evidence directory: `docs/evidence/analytics-redesign-20261007/`.

Final-tree checks: **174 tests passed, 0 failed, 0 skipped** in the complete focused analytics/visibility/TikTok regression suite; TypeScript passed; scoped lint passed with three existing image-element warnings; production webpack build passed with no source drift; `git diff --check` passed. Browser assertions and their individual outcomes are recorded in `browser-results.json`. SQL fixture, API tests, browser fixture and the generated checklist validate different layers; none substitute for live PostgREST or hosted cost evidence.

- Isolated PostgreSQL/PGlite executes the actual copied legacy definitions and the proposal, seeded with synthetic rows. Cases: old conversations with new messages; incoming bursts; human/bot/unknown and member-attributed bot; reopening; unassigned; multiple agents; provider redelivery; late/out-of-order storage; exact start/end; zero denominator; empty period independent of current queue; timezone/DST; system-only active contact; member/account cross-tenant IDs; function role grants. No existing database is opened.
- Actual React components with compiled Tailwind CSS in fresh headless Edge:1440px desktop,820px tablet,390px mobile; no page overflow, internal chart scrolling; keyboard exact values; date/timezone/workspace changes; rapid ignored-abort requests; drilldown exact bounds; Back/Forward; error/empty/verified zero states. These use verified SQL fixture JSON, **not hosted customer data**. Native app, real provider callbacks and production authentication were not changed/tested through this fixture.
- Measured isolated initial request count **3→1**, serialized response bytes **5560→1431**, two synthetic30-second interval ticks **9→1 requests**. These are fixture JSON bytes before compression and per-mounted-overview requests, not hosted billable traffic. No hidden report mounting/polling/subscriptions. Database compute/latency, hosted Supabase/Vercel spend and production-scale plans are **UNVERIFIED**; a smaller HTTP response does not prove lower SQL compute.
- Production build is performed from a fresh source copy with a node_modules junction, synthetic config, invalid external database hostname, TikTok flagsfalse and no `.env`, credentials or proposed SQL. First harness attempt compiled/type-checked but failed page-data collection because it omitted the required synthetic `SUPABASE_SECRET_KEY`; no real key was read. Final build result/source drift and logs are retained separately.
- `metric-checklist.md`, `fixture-results.json`, `channel-fixture-results.json`, `browser-results.json`, `regression-tests.log`, `lint.log`, `typecheck.log` and `build-results.json` contain actual outcomes. Screenshots: `dashboard-desktop.png`, `dashboard-tablet.png`, `dashboard-mobile.png`, `dashboard-error.png`, `dashboard-empty.png`, `dashboard-zero.png`.

Remaining gates: proposed RPC installation and PostgREST validation (separate approval), deployed function ACL/role check, representative query plans/current-queue scale, live provenance/event completeness, legacy RPC permission/timezone/formula remediation, nonempty tags and additional-channel fixture coverage, real authenticated browser date/workspace flow, and hosted request/cost measurements. No Vercel access restriction was bypassed. No claim of all-analytics correctness or integration activation readiness is made.
