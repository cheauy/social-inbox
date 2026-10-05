# Reviewed Inbox and conversation diagnostics candidate — 2026-10-01

Base: c8034190ebbe0b96dd77cb5f623831dc2e617cf9. Prepared and validated in an isolated Temp checkout before publication. The user assigned voice UI to a separate Codex session; voice changes and the reference-image wait are excluded from this release. The original checkout is preserved for that session.

## Included app updates

- Inbox success alerts appear only after successful server confirmation for mark unread, pin/unpin, assign/unassign, assign to me, and reminder creation. Failures do not report success.
- Alerts reuse the existing 4.5-second replacement timer and dismissal action. Success alerts have a green check, an accessible polite status announcement, and a specific dismissal label.
- CustomerProfile has an optional reminder-created callback, preserving its existing reminder-change event.
- The chat header and composer remove their own rounded corners so they meet the enclosing rounded Inbox shell cleanly. Message bubbles and transport/recording/send/retry behavior are unchanged.
- Added focused success-alert tests and the existing local dashboard-header availability-gate regression test.

Runtime files: components/inbox/inbox-view.tsx, components/inbox/customer-profile.tsx, components/inbox/conversation-header.tsx, components/inbox/reply-box.tsx.
Tests: tests/inbox-success-alerts.test.mjs, tests/dashboard-header.test.mjs.

## Approved Show details diagnostics

View conversation now offers a native, compact Show details disclosure. The server reports fixed-enum providerLinkState, providerRouteKind, directLinkRejectReason and actual cacheUsed. Missing/rejected links, retained legacy Page inbox/Messages routes, and required Suite routing checks are distinguished. The UI drops unknown or inherited values and renders fixed labels only; raw provider fields, identifiers, links and errors do not appear in this disclosure. Diagnostics reset on conversation changes and never run before the existing access/context checks. Existing destination normalization, provider selection and saved-link handling remain unchanged.

Additional files: app/api/conversations/[conversationId]/facebook-conversation/route.ts; components/inbox/companion-facebook-action.tsx; lib/facebook/conversation-navigation-diagnostics.ts; tests/facebook-navigation-diagnostics.test.mjs.

## Already in production

At snapshot time, the original checkout's shared audio/message player, photo loading and albums, unified emoji/sticker picker, Analytics workspace, dashboard header and loading infrastructure, Facebook conversation notices, Smart Views trimming, and false Bot availability gate match the verified production files. Their local historical commits need no wholesale republishing.

## Kept out of this candidate

- app/api/saved-reply-categories/route.ts and app/api/workspaces/create-subscription/route.ts: the old checkout re-exports route-local constants and makes the categories GET request optional. Those hunks would undo production's Next.js route typing fixes.
- app/dashboard/integrations/page.tsx: removes the optional Integrations companion card. Held because the current request excludes extension changes and this removal was excluded from the previous reviewed release.
- Dormant Bot editor redesign: components/bot/bot-messenger-preview.tsx, components/bot/bot-save-toolbar.tsx, components/bot/tenh-bot-workspace.tsx, components/settings/auto-reply-settings.tsx, components/settings/bot-draft-settings.tsx and associated tests/fixtures. This redesign adds grouped menus, a fictional Messenger preview, a shared save toolbar and unsaved-edit guards. It does not change the false availability gate or make the editor reachable. Its unfinished release scope needs a decision before inclusion; it is not required for voice styling.
- Production corrective docs/tests deleted only because the original checkout predates production, and unnecessary browser-fixture CSS-scanning simplifications. Production versions are retained.
- .serena, local tools, secrets, private backups, dependency/generated outputs, and all database/security/permissions changes.

## Validation

- Final combined candidate: 161 focused tests passed, including 34 new diagnostics tests for provider routing rejection, cache reuse, authorization/context boundaries, token/provider failures, unexpected values, secret suppression and native disclosure/reset behavior. The diagnostics test file was converted to ESM for repository lint compatibility and all 34 tests re-passed.
- Existing Messenger source/action tests remain green, including customer-panel View conversation, pending state, stale cancellation and validated navigation.
- The Next.js 16.2.12 production webpack build passed, including TypeScript and page generation, using synthetic Supabase values. The first sandboxed attempt failed solely on existing Google Fonts downloads; the network-enabled retry passed.
- git diff --check passed.
- Lint comparison against the exact production base: 38 findings on both versions across six touched runtime files (12 errors and 26 warnings), with no introduced diagnostic after accounting for shifted source frames. The new diagnostics helper and ESM test lint cleanly.

No live customer audio, chat/provider requests, SQL, activation, permissions, extension code, or production environment changes were used. Tests use local doubles. A full authenticated desktop/mobile Inbox session was not exercised. The separate voice task requires its own validation.

Browser proof: the real diagnostics action and native disclosure passed eight Chrome checks at a measured 1384px desktop viewport, using synthetic responses and production CSS. Screenshot and browser results are retained outside the source checkout. The original checkout now has active voice edits in message-panel.tsx and tests/voice-message-ui.test.mjs; neither is included here.
