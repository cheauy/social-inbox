# Inbox interaction audit — second pass, 2026-10-17

Local patch and controlled verification are ready. The requested **actual per-function cold/warm visible-data timing audit is incomplete** because no browser tab is attached. Source counts and mocked frames below are not substitutes for real UI measurements. Nothing was committed, pushed, deployed or applied to a hosted database.

## Baseline and scope

Continues the first-pass [Inbox/Storage report](inbox-storage-performance-20261017.md) in the same isolated worktree, `C:/Users/TUF/AppData/Local/Temp/tenh-inbox-perf-20261017`, at released `35b5fdd8a4b0cef942fda658506a0daa10b44e98`. Read-only remote main recheck still returned that revision. The original checkout and separate Facebook, PayWay, auth recovery and Admin work remain separate. Independent review found no overlapping changed/new paths with the separate Facebook patch; runtime integration with those unreleased patches is not verified.

Read the supplied AGENTS and local installed Next client guidance before editing. Existing Ponytail, investigation, Supabase and React guidance remains applicable. No installs, junctions, production configuration changes, credential creation, real sends, live uploads/deletes or permission changes were performed.

## Additional finding and fix

`usePinnedMessages` is mounted with the selected conversation. Mount, focus, online and visibility restoration could each open another historical pin GET while a previous GET was pending. Ordinary unpinned message events also allocated a new empty/unchanged pins array, causing unnecessary state invalidation in the message panel.

The reader now owns one cancellable request and at most one trailing catch-up. Conversation cleanup aborts the retired transport; existing conversation, generation and request checks reject ignored-abort responses, including A→B→A. It uses the existing Inbox timeout, checks the composite signal after body parsing, retains retry errors and clears them after success. Realtime changes still override only their matching historical row. An event removing a pin not present in current pin state returns the existing state reference, while keeping the revision overlay needed to defeat stale reads. No new subscription, polling interval, completed-result cache or cross-user/workspace storage was added.

Repeat: `node tests/inbox-pin-performance-measure.cjs`. It evaluates actual released/current hook source with controlled Node lifecycle and transport doubles.

| Controlled source workload | Released | Current |
| --- | ---: | ---: |
| Mount + three focus events + visibility restoration: simultaneous pin GETs | 5 | 1 |
| Same burst, total GETs including trailing catch-up | 5 | 2 |
| 100 ordinary unpinned events: pin-state reference replacements | 100 | 0 |

These are request/state counts, **not React commit counts or real milliseconds**. First-pass measurements remain unchanged in their original evidence: cold selection transports 2→1, stable pager initializer serialization eliminated, and unchanged safety snapshots preserve references. First-pass synthetic batch milliseconds are not per-click speedups.

## Per-function coverage matrix

For **every row below**, actual cold and warm click-to-correct-visible-data ms, client request count and React commit count are **pending/null**. No production/server/provider latency was measured. The matrix identifies current source/fixture coverage and the checks still needed in a connected browser; it does not mark every function as optimized or fully audited.

| Function | Source or controlled-fixture evidence | Actual-browser check still required |
| --- | --- | --- |
| Inbox first entry, no selected thread | Server authorization/paging preserved; actual Inbox component fixture compiles | Cold/warm entry, completed rows/counts, request waterfall, hydration/commits |
| Deep link to selected conversation | Message ownership and fallback fixtures; pending selection read now shared | Selected header and newest messages, draft, unread/read effects |
| All | Existing scoped pager and view cache; real-pager fixture contract passes | Exact visible IDs/counts on cold/warm switches |
| Unread | Pager qualification/read barriers and arrival tests; teammate-read exclusions | Read transitions, bulk-read snapshot, zero-row view during incoming event |
| Pinned conversations | Existing server qualification and pager fixture | Correct pinned list, count and conversation selection |
| Smart Views | Server paging/view navigation tests; no cache relaxation | Each configured view; permission/error/empty state and saved-view changes |
| Facebook Messenger channel | Channel directory sharing/navigation tests | Every actual Messenger channel, cold/warm and rapid repeated switches |
| Facebook comments | Built-in comment qualification and navigation tests | Correct comment-only content and switching between comment/Messenger threads |
| Telegram channel | Shared channel/pager ownership; local channel fixture contract | Every Telegram channel, cold/warm and rapid repeated switches |
| Box/subscription switching | Existing selector access checks and History API preserved | Each accessible box, selection, stale requests, workspace isolation |
| Workspace switching | Existing cache/authorization identity guards; no new persistent cache | A→B→A with different permissions, drafts, old pending responses and realtime events |
| Conversation switching | First-pass cold newest-page request sharing; new pin cancellation tests | Cold/warm A→B→A, every channel, correct header/messages/draft and render count |
| Search and clearing search | Existing 150 ms settlement plus deferred rendering retained; pager/search tests | Correct matches through rapid typing, channel/view switches, empty/error/retry |
| Status filter | Existing optimistic destination and authoritative pager | All implemented statuses, correct counts and selected conversation |
| More conversation history | Existing keyset cursors, visited-window refresh and ownership tests | Cursor continuity, bottom anchoring, navigation during pending history |
| Older message history / jump to newest | Existing message ordering/read ownership/anchor fixtures | Scroll position, no duplicate/reordered messages or extra image requests |
| Incoming selected-thread message | Arrival/fallback/optimistic reconciliation fixtures; pin no-op fix | Correct bubble/count/commit/audio order, duplicate IDs, same provider timestamp |
| Incoming other-thread message | Existing scoped row updates; arrival list-commit qualification | Current list/filter accuracy without refetching unrelated active messages |
| Incoming during navigation | Paging generation and arrival-scope retirement fixtures | Old/new channel/box/workspace events and delayed/ignored-abort responses |
| Reconnect / focus / online / visibility | One trailing authoritative message read; coalesced/cancellable pins | Real subscription lifecycle, hidden/resume, two tabs, no missed event or alert |
| Pinned messages / pin/unpin / Retry | Seven saved hook lifecycle regressions plus policy tests | Correct historical pins, failure/timeout retry and no stale panel on fast switching |
| Composer text/draft/reply and optimistic sends | Existing ownership/reconciliation fixtures; DOM suites blocked by missing jsdom | Fixture-only send failure/rollback, per-thread drafts, preserved media/quotes |
| Assignment/claim, unread, conversation pin and status actions | Existing handlers retained; older success/source tests also fail on released source | Fixture-only success/error/rollback and correct selected thread after navigation |
| Customer details, notes, tags, reminders and activity | Mapped existing read owners; no speculative cache or router-refresh removal | Open/close/reopen and fixture-only edits, request duplication, stale response/error |
| Media, albums, voice and previews | Existing media recovery/expiry/order tests; some older UI doubles fail on baseline | Real decode/paint/scroll behavior and unchanged-image network counts |
| Storage opening/reopening, gallery/list | Identity-scoped request/cache tests; actual modal fixture compiles | Cold/warm open, right-workspace rows and real render/request counts |
| Storage search/category/favorite filters and pagination | Existing query ownership/cursor/rollback fixtures | Exact filtered rows, rapid switches, error/retry and retained selection/actions |
| Storage upload refresh | Existing normalized merge avoids full list reload; upload safety tests | Fixture-only upload, unchanged image identity/network requests, ambiguous retry |
| Storage signed media | Existing signed-URL expiry/recovery tests retained | Expiry/renewal/revoked access, no reload of unchanged valid media |
| Storage eight photos per row | First pass changed gallery and skeleton to `lg:grid-cols-8`; compiled CSS at 64rem | Desktop eight columns plus tablet/mobile visual and action checks |

Machine-readable pending cold/warm fields are in `docs/evidence/inbox-interaction-performance-20261017/coverage.json`. Browser-dependent items remain open even where source tests pass. In particular, no claim is made that server SQL, provider delivery, every configured Smart View/channel/box, notes, reminders or media decoding is now faster.

## Measurement fixture

Added an opt-in local fixture for the **actual Inbox components** with React Profiler commits and traced mocked API requests. The recorder waits for an explicit correct-visible-content predicate, rejects hidden tabs, and has an independent deadline even when animation frames pause. It records click→observed-correct-DOM and two subsequent frame opportunities. It explicitly sets `actualPaintMeasured:false`, `serverResponseMs:null`, `providerDeliveryMs:null`. Fetch duration ends when the fetch promise resolves (response availability), not server execution or body decoding. A development React build with mocked data cannot establish production latency.

Build in this isolated worktree (PowerShell):

```powershell
$env:TENH_INBOX_EVIDENCE='docs/evidence/inbox-interaction-performance-20261017'
$env:TENH_INBOX_ENTRY='tests/fixtures/inbox-interaction-performance.entry.cjs'
$env:TENH_INBOX_PERF_FIXTURE='1'
node tests/inbox-compact-browser-build.cjs
```

The compiled directory is recorded in `fixture-path.txt`. It can be served on loopback once a supported browser is connected; no local server was started or network binding changed while browser access was absent. Use actual visible button/link actions and exact row/message predicates with `window.inboxPerformance.measure(name, action, predicate)`. Separate fresh fixture loads from warm repeats; inspect the UI first. Reset opt-in environment variables before running unrelated fixtures. The legacy compact/navigation builds keep their default runner. The fixture currently supplies one workspace, two channels and built-in filters; saved views, multi-workspace/realtime and mutation timing scenarios still need appropriate doubles before measuring them. It never uses real customer data or sends.

Three independent-review findings in measurement tooling were corrected before handoff: conversation-page envelope mismatch, current channel access/name contract, and paused-frame timeout/visibility handling. The fixture response now passes through the **real pager** in a regression test across channel/unread/pin/empty transitions. This compilation/Node contract verification is not a browser run.

## Final checks

- Broad relevant run: **576 tests; 521 passed, 53 failed, 2 skipped, 0 cancelled** across 64 files. All 53 failure names and first-line errors match the released source reproduction. Existing failures include nine files missing jsdom, normalize-messages extensionless ESM import, two older Storage/bulk-read source assertions, five older image-component doubles, six success-alert extraction cases, two older UI source assertions, 22 mobile composer doubles and six mobile thread/API doubles. None were suppressed or rewritten to conceal them.
- Failure reproduction: **114 cases; 61 passed, 53 failed**. Existing test modules/dependencies ran against the clean release via read-only cwd/`TENH_TEST_ROOT`; baseline git status remained clean. The normalize direct ESM import's separate baseline reproduction is also preserved in first-pass evidence. Exact comparison/method is in `checks.json` and `baseline-failure-run.json`.
- Two SQL suites self-skipped because their optional already-installed PGlite engine was absent (`inbox-server-paging-sql`, `workspace-storage-lifecycle-sql`). No installation or live DB execution was attempted.
- Independent final review: **11/11** targeted saved pin/recorder/real-pager contract tests passed, all three tooling findings closed, no remaining concrete regression; reviewer changed no files.
- Full TypeScript: **passed**, `node node_modules/typescript/bin/tsc --noEmit --pretty false`.
- Changed application lint: **zero new findings**. Existing Inbox view/list have 7 errors/18 warnings; newly touched pin reader has the same 2 errors/0 warnings as released source. Other touched application modules are clean. All nine second-pass tooling/test files are clean with the existing CommonJS exception. Full-repository lint was not repeated.
- New interaction fixture and legacy navigation fixture compile. First-pass Storage fixture/CSS checks remain applicable. Actual browser/responsive/paint/audio checks did not run.
- Normal `npm run build` **failed again**: `ENOTFOUND fonts.googleapis.com` and `EPERM mkdir .next/server/app/api/conversations/[conversationId]/facebook-conversation`. No font, permission or security bypass was used.
- `git diff --check` passed; final incremental/full patch checks are recorded alongside their manifests outside the worktree.

Raw full lint output is retained outside the patch in `C:/Users/TUF/AppData/Local/Temp/tenh-inbox-interaction-raw-20261017`; committed-style evidence contains compact diagnostics, source count results and check logs only.

## Exact browser blocker and next step

After the user confirmed Chrome/Edge was open on ASUS, `cua.getState()` still returned `{"apps":[],"browsers":[]}`. A supported attempt to create a blank Chrome tab returned **Browser is not available: chrome**; earlier iab creation also returned unavailable. These actions failed explicitly, not uncertainly; no production tab was read or clicked. An open browser and an attached browser surface are different states. This session also exposes no `node_repl` native Windows tool, and native APIs in CUA are disabled. No alternate CDP/helper, installation, credential or security workaround was used.

The supported next input is a **browser-tab @-mention attaching the TENH CHAT tab to this task**, or a host-side Browser/Computer Use connection that then appears in inventory. No setup prompt/control is exposed to this agent, so an exact host UI button cannot be verified here. The attachment request is pending. Once attached, verify its host/locality, inspect the relevant tab read-only, open a local fixture, then fill the cold/warm timings/counts matrix. Production conversation selection can mark messages read, so those interactions require a test workspace or further authorization; use fixture mutations for sends/uploads/deletes.

This local phase is reviewable. The full per-function measured audit, real responsive check and successful production build remain unfinished.
