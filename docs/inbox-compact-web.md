# Compact Inbox web implementation and verification

## Feature inventory before editing

The existing Inbox remains the owner of data, authorization, navigation and drafts. The reference is a layout guide; the requested hidden global header takes precedence over its active-chat illustration.

| Existing feature/source | Compact location |
| --- | --- |
| Dashboard logo, workspace selector, notifications, profile (`dashboard-header.tsx`) | List global header; menu before logo; hidden during active compact chat |
| Dashboard routes and channel permission gates | Global menu, using the same links/gates |
| All, unread, comments, pinned (`conversation-list.tsx`) | List view tabs; existing unread units unchanged |
| Channel/workspace selector, subscription restrictions | List bottom navigation on phone, rail on tablet; existing selector panel |
| Smart Views, default/saved views, create/edit/delete/reorder and tag/channel/status/time filters | Existing Smart View panel, bounded to phone viewport |
| Follow-up/reminders, Settings and authorized Admin | Existing rail controls retained in compact navigation |
| Search, status filters, mark all read, pagination, search matches, loading/error/empty states | List header and independently scrolling list |
| Avatars, platform/channel context, preview, timestamps, unread message badges, pins/tags | Existing conversation rows |
| Conversation identity/channel/status, assignment/presence, pin/unread/history/details | Compact chat header and expanded action area |
| Text, image/albums, video, voice/audio, documents, stickers/animation, location and message links | Existing message renderer and media viewer; links remain visible |
| Reply/quote, copy, pin/unpin, edit/delete and reactions, per-photo album targeting | Selected/long-pressed message actions; same eligibility and handlers |
| Facebook post/comment threads, nested replies, Like, Hide/Unhide, Delete | Contextual comment actions; provider eligibility unchanged |
| Older-message paging, jump/quoted targets, retries, send/delivery/error states | Existing message scroll and composer banners |
| Quick Reply, Tags, attachments/workspace files, emoji/stickers, voice record/review/send/discard | Existing compact composer and pickers |
| Customer edit/conflict recovery, contact IDs/channel profile, assignment/claim, tags, notes, history, reminders, files/links, block/spam | Single existing customer panel, compact modal sheet |
| Conversation selection, URL/deep links, Back/Forward, caches, submission ownership, per-conversation drafts | Existing Inbox handlers/hooks; compact Back also restores the retained list |

## Baseline and boundaries

- Root metadata had no manifest, Home Screen icons or Apple web-app metadata; only a favicon. No service worker is introduced.
- Dashboard already uses `h-dvh`, but Inbox columns enforce desktop minimum widths. The phone currently displays horizontally overflowing list/chat columns.
- Message toolbar explicitly stays visible on no-hover devices. Compact selection changes presentation only, not action eligibility.
- Compact web: width below 1024px, or a coarse-pointer tablet at up to 1366px. Single-panel below 768px and short coarse-pointer phone landscape viewports; wider compact tablets retain list/chat. Other desktop layouts and native `mobile/` are outside this change.
- Existing authenticated/authorized Inbox aggregate scope remains unchanged. No API, SQL, query, polling, subscription or sending implementation changes are planned.
- Manifest scope `/` includes login and internal OAuth returns. External provider authorization/links keep existing navigation behavior. Standalone launch cannot remove Safari chrome from an ordinary tab.

## Implementation

- Existing list and chat remain mounted. The hidden phone list keeps its original header-height geometry, preventing a near-bottom scroll position from being clamped while chat is open. Wide compact tablets retain both panes.
- Explicit compact Back retains an end-of-list anchor while restoring the global header; its next-frame scroll adjustment checks that the pane still exists and that another conversation has not superseded Back.
- Compact Back reuses the existing cache/abort/submission-retirement handler. It also closes the customer sheet. The URL hook clears only genuine bare Inbox URLs; browser Back to another route is never rewritten to Inbox. Desktop selection semantics remain unchanged.
- The global menu uses existing route links, permission gates and translations. Compact chat adds identity/avatar/Back/status/More; desktop does not mount the additional avatar.
- The original customer panel is the only details instance. It becomes a labelled modal sheet with Close, Escape, focus return and a bounded Tab loop. Existing nested dialogs retain their controls.
- A single presentation event handler selects messages by tap, keyboard focus or long press. Scroll/movement cancels a long press; a retired message cannot consume the next conversation's click. Photo context capture keeps existing album targeting; the following click is suppressed so holding a photo does not also open it. Selecting a parent comment does not reveal another nested comment's actions. Revealed controls scroll into view; existing pending/error/reaction-open controls remain visible when selection moves. Eligibility, actions, reactions and provider writes remain with the existing components.
- Headers/composer are flex anchors. VisualViewport sizing accounts for reduced keyboard height without changing layout under media pinch. Relevant panes scroll independently with overscroll containment. Inputs, including ported picker inputs, use 16px text in compact Inbox.
- Manifest: `/dashboard/inbox` start/id, `/` scope, `standalone` display, existing-logo regular/maskable icons and Apple touch icon. Root Apple web-app metadata and safe-area viewport settings are added. No service worker, private-response cache, auth implementation or external/OAuth navigation handler is added or changed.
- Standalone `gesturestart` cancellation is restricted to the Inbox surface and excludes the media viewer. It is a limited platform hint, not a promise of complete zoom suppression. Ordinary browser tabs retain pinch behavior; CSS does not hide Safari's toolbar.

## Feature verification checklist

“Preserved” means the existing implementation/eligibility remains in place. Browser results are isolated headless Edge results, not actual iOS results. No customer message or real provider operation was sent.

| Feature | Preserved | Tested | Untested / remaining gate |
| --- | --- | --- | --- |
| List search, all/unread/comments/pinned, previews, timestamps, badges, unread units | Yes | Real list at phone/tablet sizes; existing paging, search, unread and navigation regressions | All combinations of live production filters |
| Channel/workspace/subscription restrictions and Smart Views | Yes | Existing isolation/paging/navigation regressions; original selector and Smart View controls retained | Device interaction with every saved-view/channel combination; live authorization |
| Global logo/menu/workspace/bell/profile, Settings/Admin gates | Yes | Menu placement/open/Escape and original header in desktop/browser fixtures | Actual notification sounds, live profile/session/workspace switching |
| Phone full-screen chat, tablet split/single flow, deep links and browser history | Yes | Real Inbox Back/Forward, rapid URL switches, Back while details open, other-route Back guard | Physical device history and rotation |
| Message drafts, list scroll, cache/request ownership | Yes | Draft after Back/reselect; anchor and composer ownership regression tests; rapid-switch/failure/retry browser checks | Browser process termination/restart persistence beyond existing behavior |
| Header assign/presence/pin/unread/status/history/details | Yes | Existing action/status tests; visible labelled More controls; details open/Close and browser Back | Full provider/account write paths and each team-presence state in browser |
| Text, image viewer, quote/reply, reactions, copy, pin/edit/delete, albums | Yes | Existing message/media/reaction/sending regressions; actual image viewer; contextual actions; long press targeting/click suppression tests | Existing HEAD image-UI expectations fail (see baseline failures); every album/media action in a real device browser |
| Video, documents, voice record/review/discard/send, emoji/stickers/location | Yes | Existing isolated media/composer/picker ownership suites | Physical microphone/camera, playback/codec support, every picker interaction and real provider delivery |
| Facebook comment/nested replies, Like, Hide/Unhide, Delete | Yes | Existing isolated comment API/context tests; parent/child action isolation test | All comment actions in the browser and actual provider permissions |
| Quick Reply, Tags, attachment/workspace-file controls | Yes | Actual Quick Reply/Tags opening, bounded tag popover, 16px ported search; existing picker/storage/composer tests | Every category/tag/file selection and provider send in browser |
| Customer edit/conflict recovery, notes/reminders, claim/tags/files/links/block/spam/history | Yes | Single real customer sheet and Close/Back/focus support; existing underlying handlers untouched | Every field save/conflict, nested modal, notes/reminder mutation in browser; unsaved customer-form lifecycle remains the existing close behavior |
| Loading/error/empty/retry and zero unread states | Yes | Real isolated failed-message retry; existing empty/paging/loading tests | All error variants in physical devices |
| Fixed layout, scroll and input sizing | Yes | 320/390px phones, 844px phone landscape, 834px portrait / 1180px landscape tablets, 1440px desktop, reduced viewport, Khmer fixture | Actual iOS keyboard transitions, safe areas, pull-to-refresh, pinch, hardware rotation, VoiceOver |
| Home Screen standalone and authentication/OAuth returns | Configured locally | Manifest/icon assertions; emulated `navigator.standalone` signal and gesture exclusion | **Actual iPhone/iPad install/launch, browser-chrome removal, first-launch cookie/session behavior and OAuth return flows NOT VERIFIED** |
| Native app, desktop data behavior, TikTok and unrelated Integrations edits | Unchanged in scope | Desktop layout/controls and no compact event handlers; no TikTok/auth/API/SQL/native source edits | No live integration/provider validation attempted |

## Actual checks and evidence

- Focused final ownership/history/anchor/compact tests: **40 passed**. Includes seven compact tests covering native history route guarding, parent/child action targeting, scroll cancellation, retired long press, persistent pending/error controls, ordinary/standalone media zoom exclusions, desktop inert behavior, and manifest/icons.
- Additional isolated storage/authorization/mixed-send/album-target/reconciliation checks: **75 passed** (`additional-storage-send-tests.log`).
- Complete intended local Inbox/Messenger/comment/media suite: **564 tests, 526 passed, 38 failed**. An isolated untouched HEAD snapshot has **557 tests, 519 passed, the same 38 failures**. All 38 failure names match; no new failures in the final complete run. A previous run had one additional time-sensitive comment read-back failure; it passed individually and in the final complete run.
- Baseline failures: bulk-read source assertion (1), legacy HEAD reproduction extraction (1), image UI expectations (5), UI/source assertions (2), and Business Suite action harness expectations (29). These remain red; this is not a claim that all existing features are fully validated. See `evidence/inbox-compact-web/final-complete-tests.log` and `baseline-regression-tests.log`.
- ESLint across affected production TypeScript/TSX: **21 existing errors before and after; no introduced errors**, compared by file, rule, offending statement and message rather than shifted line numbers. The raw lint run is not green. `lint-comparison.json`, `baseline-lint.json`, `final-lint.json` retain the evidence.
- Final standalone TypeScript `--noEmit --incremental false` and production `next build --webpack` passed against the final source. The final build exited 0; `evidence/inbox-compact-web/production-build.log` and `production-build-path.txt` identify its isolated copy. Built manifest, icon dimensions and generated web-app metadata checks also passed (`built-manifest-check.json`). Next emits `mobile-web-app-capable` plus Apple title/status/icon metadata. These are configuration checks, not proof of physical Home Screen launch. Builds use new local copies and retain logs/artifacts; source `.next`, existing junctions and previous task evidence are not cleaned up.
- Browser assertions/screenshots and fixture traces: `evidence/inbox-compact-web/browser-results.json`. Headless Edge uses the actual Inbox components with mocked auth/data/provider traffic and blocks external DNS. More-open/close adds **zero requests and zero realtime subscriptions**; no layout interaction sends a message or refreshes the page. Customer details/pickers retain their existing on-demand loads. These are fixture observations, not hosted-cost measurements.
- Final browser run: **43 assertions passed**, including tablet end-of-list Back restoration and ported Quick Reply search sizing. The standalone screenshot uses an emulated iOS `navigator.standalone` signal; CDP display-mode emulation alone did not simulate installation and is not physical-device proof.
- Screenshots: `phone-list.png`, `phone-chat.png`, `phone-actions.png`, `phone-details.png`, `phone-telegram.png`, `phone-landscape.png`, `tablet-portrait.png`, `tablet-landscape.png`, `desktop.png`, `small-phone-khmer.png`, `reduced-viewport-keyboard-emulation.png`, `standalone-signal-emulation.png`, plus `before-desktop.png`, `before-phone-list.png`, `before-tablet.png`.
- No SQL, commit, push, deployment, real messages, provider authorization, hosting-access changes, service worker or new polling. Physical iOS and live/session/provider checks above are explicit completion gates.

## Changed files for this task

Production web files:

```
app/dashboard/inbox/page.tsx
app/dashboard/layout.tsx
app/globals.css
app/inbox-compact.css
app/layout.tsx
app/manifest.ts
components/dashboard/dashboard-header.tsx
components/dashboard/dashboard-mobile-menu.tsx
components/inbox/conversation-header.tsx
components/inbox/conversation-list-header.tsx
components/inbox/conversation-list.tsx
components/inbox/customer-tag-selector.tsx
components/inbox/inbox-channel-selector.tsx
components/inbox/inbox-view.tsx
components/inbox/inbox-web-shell.tsx
components/inbox/message-action-toolbar.tsx
components/inbox/message-panel.tsx
components/inbox/reply-box.tsx
lib/inbox/use-compact-web.ts
lib/inbox/use-url-conversation-selection.ts
public/icons/apple-touch-icon.png
public/icons/tenh-192.png
public/icons/tenh-512.png
public/icons/tenh-maskable-512.png
```

New isolated validation files: `tests/inbox-compact-web.test.cjs`, `tests/inbox-compact-browser-build.cjs`, `tests/inbox-compact-browser-check.mjs`, `tests/fixtures/inbox-compact-browser.entry.cjs`, `tests/inbox-compact-baseline.cjs`, `tests/inbox-compact-lint.cjs`, `tests/inbox-compact-production-build.cjs`. This report and `docs/evidence/inbox-compact-web/` contain evidence. Pre-existing Integrations changes and their tests/evidence were preserved.
