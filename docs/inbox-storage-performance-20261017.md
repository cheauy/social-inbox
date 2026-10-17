# Inbox and Storage performance audit — 2026-10-17

Local review patch only. No commit, push, deployment, production database operation, customer send, live upload/delete, migration, configuration change or credential creation.

## Baseline and isolation

`git ls-remote origin refs/heads/main` verified released main at **35b5fdd8a4b0cef942fda658506a0daa10b44e98**. Work was isolated at `C:/Users/TUF/AppData/Local/Temp/tenh-inbox-perf-20261017`, detached at that revision. Original checkout `C:/Users/TUF/social-inbox` was initially clean and its HEAD remains **1b04afc92f532c49eb61da4dbcfc630ebee7e854**. Unrelated concurrent account/payment/UI edits appeared there during final verification; this task did not modify or include them. The older auth recovery and Admin overview worktrees were not modified.

Read the supplied/root AGENTS.md and installed Next 16.2.12 client/server component guidance. `.agents/skills` was absent; used the permitted Ponytail, Investigate-first, Supabase and React skill sources. Earlier repository audit documents were historical context, not current production measurements. No relevant standalone local memory file was found. Dependencies were physically copied into the isolated worktree; no junctions, package changes or credential copies were used.

## Audit map and findings

| Path | Finding and result |
| --- | --- |
| First Inbox load | Scope authorization precedes data access; team data and conversation work overlap; selected messages start only after authorization. Existing 30-row server paging and missing-RPC-only compatibility fallback retained. No new first-load request/cache was introduced. |
| All / Unread / Pinned / Smart Views; Messenger / comments / Telegram filters | Existing History API navigation, scoped six-view/30-second cache, server qualification, stale-response cancellation and 30-row keyset paging retained. Pager eagerly serialized all loaded contacts in ref initializer arguments on every render. Initialization is now lazy; initial lookup and warm-scope validation use Maps instead of repeated linear scans. |
| Channel / box / conversation / workspace switching | A cold conversation selection's newest-page request and the active-thread fallback used separate transports. Fallback now joins the already-owned selection/prefetch promise. Own cancellation/generation checks remain; a new scope never consumes an obsolete result. |
| Incoming messages / reconnect | A recovery event arriving during a newest-page read was discarded by `inFlight`; the next healthy safety poll can be 60 seconds away. Events now coalesce into one trailing authoritative read after the current snapshot settles. Unrelated-thread events and retired scopes do not schedule it. Existing healthy/unhealthy polling cadences, hidden-tab policy and realtime subscriptions remain. |
| Message rendering | Identical safety-net responses recreated messages and conversation previews. Unchanged results now preserve state references. Changed content, metadata and signed-media URLs still update; normalization, optimistic correlation, delivery receipts and ordering remain in their existing owners. |
| Sound before messages | All four arrival sources played directly before React committed the corresponding update. They now enqueue into one mount-local, scope-owned ledger. The selected foreground thread must contain the message; unscoped All/Unread list arrivals wait for a committed displayed row/version, including server paging qualification. Active/off-page threads use their bubble. Unread arrivals already read by a teammate can alert after the current read-state transition instead of waiting for an excluded row. Search/channel/box/Smart View exclusions and background tabs retain legitimate alerts. No arbitrary delay was added. |
| Notification deduplication | Timestamp-only suppression lost distinct incoming IDs sharing a provider timestamp. Real IDs deduplicate independently; a conversation fallback claims at most one real arrival. Queues/history are bounded to 1,000 entries and retired on member/workspace/access-scope changes. Own outgoing messages never enqueue. Existing No sound, volume and desktop notification preferences remain. |
| Storage list / gallery / filters / upload refresh | Existing identity-checked, query-owned 30-row paging, mutation rollback and normalized upload merging already avoid full-list reload after upload. Existing file IDs, unchanged object identity and valid signed previews remain. Explicit refresh still covers the loaded cursor window. No upload/renewal/security logic was rewritten. |
| Storage layout | Gallery and loading skeleton now use eight columns at `lg` (64rem), five at `md`, four at `sm`, three from 390px and two below. Existing preview, Favorite, selection, category, Draft and Send Now actions remain. |

Exact application files:

- `components/inbox/inbox-view.tsx`
- `components/inbox/conversation-list.tsx`
- `lib/inbox/use-conversation-pages.ts`
- `lib/inbox/use-arrival-notifications.ts` (new)
- `components/inbox/workspace-storage-modal.tsx`

Regression/measurement files: `tests/inbox-arrival-notifications.test.cjs` (new), `tests/live-message-fallback/polling.test.cjs`, `tests/inbox-server-paging.test.cjs`, `tests/inbox-performance-measure.cjs` (new), and `tests/fixtures/workspace-storage-browser.entry.cjs`.

## Measurements

Repeat with `node tests/inbox-performance-measure.cjs` from this worktree. It compares actual baseline/current pager and fallback code using Node VM/hook doubles. It does **not** measure browser rendering, realtime transport, hosted SQL, production latency or end-to-end milliseconds.

| Synthetic workload | Released baseline | Patch |
| --- | ---: | ---: |
| Cold selection, total newest-page transports including the existing selection read | 2 | 1 |
| 200 unchanged pager renders with 1,000 loaded contacts: contact serializations | 200,000 | 0 |
| Same 200-render batch, median of five alternating samples | 551.8209 ms | 1.6985 ms |
| Four identical safety-net reads: message state changes | 4 | 0 |
| Four identical safety-net reads: conversation preview object changes | 4 | 0 |
| Four identical safety-net reads: transport count | 4 | 4 |

Raw numbers are in `docs/evidence/inbox-storage-performance-20261017/measurements.json`. These ms figures cover the entire synthetic 200-render batch; they are not savings per real chat switch. Actual browser event-to-visible/audio time remains unmeasured. Arrival tests establish ordering: no alert while the selected message or required displayed-page response is missing, then one alert after commit acknowledgement. Changed signed URLs still cause an update.

## Verification

- Initial focused baseline: **94 passed, 0 failed, 0 skipped**.
- Final broad relevant run: **354 tests; 345 passed, 9 failed, 0 skipped/cancelled**. All nine failures were reproduced on the untouched released baseline: six files require missing `jsdom`; `lib/inbox/normalize-messages.test.mjs` fails on its extensionless ESM import under Node 24; two old source assertions expect the pre-shared-request Storage fetch and pre-snapshot bulk-read call. No test was disabled or changed to hide these failures.
- Final arrival/recovery suite: **23/23 passed**, including two distinct IDs at one timestamp, fallback/INSERT races, held pager qualification, teammate read exclusion, stale read versions, selected off-page/Unread thread, scope retirement, hidden/filter/search behavior, No sound, outgoing silence, joining pending reads, recovery batches and renewed signed URLs.
- Existing regression coverage exercises rapid A→B→A and Back/Forward, stale/ignored-abort responses, filters and complete counts, pagination, unread/read barriers, drafts/composer ownership, optimistic reconciliation, reconnect, Storage identity isolation, upload retry/ambiguous finalization, partial deletion, cache overlap and signed URL expiry. These are controlled fixtures; the missing-jsdom DOM suites did not run successfully.
- Final full TypeScript: **passed**, `tsc --noEmit --pretty false` (exit 0).
- Changed application lint: **zero new findings**. Existing `inbox-view.tsx` retains 4 errors/15 warnings and `conversation-list.tsx` retains 3 errors/3 warnings, matching baseline rule/message counts. Pager, new arrival hook and Storage modal are clean. New tests/measurement script are clean with the repository's CommonJS exception; two pre-existing touched-test warnings remain. Full-repository lint was not repeated.
- Actual full Inbox component fixture and actual ReplyBox/Storage fixture compile successfully with local webpack/Tailwind harnesses. Compiled CSS confirms `lg:grid-cols-8` under `(width >= 64rem)`; the fixture expectation is updated. No browser layout run occurred.
- Independent read-only review: initial 141-case targeted regression set passed; final arrival/recovery 23/23 passed. Review found and then verified fixes for hydration-before-page-qualification and selected/teammate-read Unread cases. No concrete findings remain. Review changed no files.
- `git diff --check` passed.

## Blockers and practical limits

Normal `npm run build` **failed**: Google Fonts DNS (`ENOTFOUND fonts.googleapis.com`) and Windows `EPERM` creating `.next/server/app/api/customers/[customerId]/files`. No font/security workaround or denied-operation bypass was used. Final type checking and isolated component compilation passed; a full production build is still required in a working environment.

Browser inventory contained no browser surfaces; creating an in-app browser returned **Browser is not available: iab**. Thus no attached local ASUS browser, authenticated production UI, real responsive screenshots, physical paint/audio/autoplay test or real upload/media network measurement was available. A React commit acknowledgement proves state/DOM ownership, not painted pixels or audible playback. Background and No sound behavior are tested with doubles; actual browser autoplay remains a release check.

No hosted database/EXPLAIN or production latency measurement was made. Existing database index proposals and backend/provider latency remain unproven candidates, not applied fixes. Signed-media expiry/permission and upload behavior were preserved and tested through mocks; real multi-tab and live Storage media-transfer behavior need an approved browser/staging verification. No production requests or Vercel 403 bypass were attempted.

In a foreground unfiltered list, an alert whose required read fails waits for successful recovery or tab backgrounding; it is not played before unavailable content. Queue/history bounds retain the existing bounded recent-message design rather than adding cross-tab or persistent customer-data caches.

Evidence: `docs/evidence/inbox-storage-performance-20261017/`. Complete scratch logs are retained separately at `C:/Users/TUF/AppData/Local/Temp/tenh-inbox-performance-raw-20261017`. Review the patch against released **35b5fdd**; do not apply it blindly to the older original main checkout.
