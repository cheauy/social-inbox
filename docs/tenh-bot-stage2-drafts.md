# Tenh Bot Stage 2: seven session-only proposal types

All seven selected types are implemented and tested as Facebook-only synthetic draft plans. No live execution, persistence, customer/provider sends, comment hiding/deletion, assignments, notifications, queue jobs, schedulers, migration application, push or deployment was performed. Existing worker flags/legacy comment controls and Tenh Bot safety changes are untouched. Unpublished album, Settings, Emoji/Sticker and Inbox changes remain intact.

The known user-pushed/parent-verified deployment remains b27e557ad17cb2ae14deaa85f3890e43a3142cdf. These Stage 2 changes are local differences from that commit. They reuse Stage 1's shared engine, session editor, Tenh Bot integration and existing guarded API rather than adding a parallel live sending system.

## Implemented/tested types

| Selected tool | Draft behavior | Verification boundary |
| --- | --- | --- |
| 8 AdsSpecificReply | Exact explicit numeric Ad ID from scoped simulated referral metadata, optional literal keywords, priority/cooldown and direct-window guards | Does not guess from PSID/text/product or claim real Ad ownership; trusted provider provenance remains unverified |
| 15 ReturningCustomerContext | Bounded previous-conversation count and prior last-seen timestamp; scoped context proposal and optional configured reply | Synthetic metadata only; no real customer/history query or generated summary |
| 21 ConnectionHealth | Read-only selected-channel recorded status, normalized to a safe enum | Server rereads owned active Page; client health/Page overrides ignored; not a live token/permission probe |
| 22 CommentPhoneSpamHide | ASCII phone-pattern plus configured spam keyword, or explicit phone-only opt-in; exclusions, first-level evidence, deleted checks and manual-review reason | Hide proposal only, never delete; heuristic is not a spam classifier; actual comment/provider permissions are unverified |
| 23 CommentKeywordExclusionFirstLevelFilters | Unicode-normalized literal include/exclude tests; first-level only when parent equals the explicit post; unknown/nested excluded | Filters constrain synthetic hide proposals even when explanation cooldown suppresses repeated output; existing live comment rules are not altered |
| 25 QRRefURLFlows | Exact public campaign ref matching and https://m.me/selected-public-Page?ref=campaign_word link/QR-payload proposal; optional direct-customer template | No private identifiers are appended, arbitrary redirect URLs rejected; QR image generation/export and real referral activation are unavailable |
| 26 CancellableConditionalFollowups | Up to five cumulative delayed template steps conditional on an unanswered direct conversation; configured timezone/hours, trigger/cancel keywords and scoped recipient cooldown | Prospective in-memory plan only; no timers/jobs. New customer/staff/operator/takeover cancels pending steps. No durable cancellation or multiworker ledger claim |

## Safety contract

- Rule mode must be draft, exact authenticated business/channel scope; Stage 2 sample events also require those identities. Active Facebook channel authorization is rechecked on POST. Unsupported providers return unavailable. Comments require selected public Page_post ownership in synthetic metadata; comment/referral entries never open a direct messaging window.
- Replies and follow-ups require the hypothetical direct-customer 24-hour window; no HUMAN_AGENT/comment extensions. Due times at/after the boundary are skipped. Past deadlines are skipped, never backfilled; out-of-hours steps are skipped rather than silently shifted. IANA timezones, overnight/DST conversion, whitespace normalization and midnight closing are validated; missing closing time is rejected.
- Per-recipient/per-rule cooldown spans sample conversations; scoped event IDs deduplicate independent of JSON key order. Conflicting duplicate IDs reject instead of choosing one recipient. Same-time staff/operator events preempt future follow-ups. Staff hold requires an explicit sample resume; resume never resurrects cancelled plans. Comment hide proposals also deduplicate the selected comment/rule identity across callback IDs. Cancellation does not affect another synthetic recipient.
- Maximum 20 rules, 100 sample events, five sequence steps, bounded strings/lists/templates, 256-KiB API payload and 500 plan items. Excess plans fail explicitly. These bounds and cooldowns are preview protections, not provider/durable global rate limits.
- Public ref labels are restricted static campaign labels; no dynamically appended business/channel/customer IDs, email, phone, credentials, fragments or external redirect URLs. The user must treat the chosen label as public. The helper does not certify arbitrary human-written text as nonsensitive. Flow payload uses the server-owned public Page ID, not a client-supplied URL or Page override.
- GET exposes only public Page metadata plus normalized recorded health and permitted staff. No token/error text is returned. POST only reads the selected channel and permitted staff; all evaluations are pure. No real conversation/contact/message history is read. Templates are operator-configured plain text, not generated business answers or executable markup.
- Drafts/results live only in the editor session and clear on channel/workspace changes, explicit removal/clear or unmount. They do not enter existing live rule tables, worker queues or global controls. The UI displays status, skip/cancel reason and public URL; it has no Stage 2 activation button.

## Files

Stage 2 runtime: lib/bot/draft-rules.ts, components/settings/bot-draft-settings.tsx, app/api/facebook/auto-reply/route.ts. New tests: tests/bot-stage2-drafts.test.cjs. The existing component browser fixture now exercises all seven editors. The separate narrow Inbox divider/message-fit work is documented in inbox-divider-message-fit-review.md and uses no Bot logic.

## Evidence

- **33 NEW Stage 2 tests passed independently**, zero failures/skips: Temp/tenh-stage2-only-tests.txt. Positive/negative coverage for every selected type, tenant/channel/Page/permission rejection, no forged health/Page override, no token disclosure, scopes, bounds, duplicate/out-of-order/same-time events, priority/cooldown, contact cancellation, human takeover/resume, expired/boundary/past-due windows and timezone/DST cases.
- **147 combined tests passed**, including those 33, 17 Stage 1 regressions and 97 existing Inbox/media/realtime/navigation/performance regressions. Temp/tenh-stage2-regressions.txt. Old performance tests are regression evidence, not Stage 2 implementation evidence.
- **66 browser checks passed** at measured desktop 1384x905 and verified CSS viewport 390x844. All seven actual editors create/test plans; follow-up cancellation, displayed QR payload, missing/midnight closing time and session clear are covered. Logs: Temp/tenh-stage2-complete-desktop-result.json and tenh-stage2-complete-mobile-result.json.
- The existing actual Bot page/form/API/disposable-SQL browser regression passed with fixture auth and zero Meta/customer sends: Temp/tenh-stage2-bot-browser.txt. It exercises legacy rule safety/permissions, not live Stage 2 automation.
- Final TypeScript and production build passed: Temp/tenh-stage2-final-typecheck.txt and tenh-stage2-final-build.txt. Build used authorized network access for existing Google Fonts, not deployment. The Stage 2 engine/editor/API and new Inbox layout module are lint-clean; compared existing Inbox files have no introduced findings (preexisting baseline retained). Temp/tenh-stage2-lint-comparison.json. Whitespace check passed.
- Browser tests use actual components/engine with synthetic fetch data and navigation/sidebar stubs. They are not full authenticated deployed Stage 2 flows, real customer transcripts, actual providers or native mobile touch/keyboard behavior. The 390px run uses CSS viewport emulation with mobile=false to prevent layout auto-expansion. No provider actions were attempted.

Two browser findings were corrected: the evaluator returned the public ref URL but the renderer initially omitted URL/reason fields; the fixture checkbox-label matcher then needed whitespace trimming. Final checks pass. The editor also now handles midnight closing without treating a missing time as midnight.

## Missing durable/live work

Meta's official m.me discovery, Messenger send and Graph Comment documentation returned HTTP 429 again during this stage; no current verified live capability contract was established. Existing local referral/comment handlers are contextual evidence only. Real Ad/ref ownership and provenance, Page/post/comment permissions, actual customer history authorization, live token health, provider messaging eligibility and provider rate limits remain unverified. Other-channel implementations and QR image export are unavailable.

Activation would require separately authorized design/tests for persistence/schema, tenant/channel/conversation/recipient authorization from trusted events, genuine Ad/ref metadata, durable human holds and per-recipient atomic claims/reservations, idempotent event versions, race-safe cancellation/reconnect/recovery, schedule/expiry/rate budgets, provider-specific window/permission enforcement and reconciliation of uncertain sends/hides. Reuse and extend existing safety ledgers/worker gates rather than bypassing them or creating a second live sending system. No new migrations are prepared/applied here, and none of this follows from a source deploy.
