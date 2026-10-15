# Compact web navigation review — October 12, 2026

Local redesign using the latest mockup. Desktop comparison baseline: `b89c828`. Phone/tablet/iPad Pro web uses the existing compact breakpoint (below 1024px, or coarse-pointer devices up to 1366px). Native apps, APIs, SQL, authentication, provider integrations and messaging handlers are untouched. No commit, push or deployment was performed for this task.

## Inventory and destination mapping

| Existing control/destination | New compact location | Preserved implementation |
| --- | --- | --- |
| TENH logo | Header, left | Existing logo and explicit Inbox refresh link; desktop styling retained |
| Switch workspace | Header, right, before Profile | Same `WorkspaceSwitcher`, full name in accessible label/popup, compact initials/chevron; long names cannot expand the control |
| Profile and sign out | Header avatar/menu | Same profile menu and actions; absent from More |
| Inbox / Analytics | First two bottom items | `DashboardNavLink`, existing return URL, route loading, prefetch defaults and active-page handling |
| Notifications / announcement badge | Third bottom item | One mounted `TeamNotificationCenter`; existing reads, sounds, unread logic, workspace handling and subscriptions |
| More | Fourth bottom item | Left modal drawer; close button, outside tap, Escape, forward/reverse Tab loop and focus restoration; navigation/Back/Forward dismiss it |
| Subscription / Integrations / Settings | More, in that order | Existing routes; Integrations retains `NavPermissionGate` for `channels:view` |
| Admin | Settings sidebar/card | Existing server-derived `isAdmin` identity context; compact card only visible to authorized identities; original desktop entry remains |
| Search / Filter / Smart View | Inbox header, in that order | Original search/filter/Smart View handlers; one copy of each control |
| All / Unread / Comments / Pinned | Directly below search controls | Original `selectView`, count calculations and selected states; no message/conversation count redefinition |
| Channel/workspace/channel-subscription selector | Inside Filter | Same mounted `InboxChannelSelector`; toggling Filter does not remount it |
| Reminders | Existing customer details | The old rail shortcut is already disabled (`showReminderRailShortcut=false`); its flag and underlying workflow remain unchanged |
| Tenh Bot / retired marketing entry | Existing availability unchanged | Tenh Bot remains unavailable; marketing was already absent from navigation. Neither is activated or reintroduced |
| Conversation, message actions, customer details and composer | Existing compact chat | Back and retained list/draft logic unchanged. Global header and bottom bar hide during compact chat; hidden phone list retains its header and footer geometry |

Admin navigation is a visibility convenience, not authorization. The destination still calls `requireTenhAdminPage()` in `app/dashboard/admin/page.tsx:53`, with the existing identity/MFA checks in `lib/admin/tenh-admin-auth.ts`. No authorization code was edited. Workspace switching still performs its existing POST and intentional reload/navigation to establish server-side scope; cookie, membership and combined Inbox semantics were not changed.

## Checks against the final working tree

| Check | Result / evidence |
| --- | --- |
| Navigation, draft ownership, anchors, return context, loading and header read lifecycle | **57 tests passed**, `evidence/compact-navigation-20261012/focused-tests.log` |
| Real navigation/Inbox/Settings components in isolated headless Edge | **100 assertions passed**, zero runtime exceptions; `browser-results.json` |
| Initial Inbox footprint, baseline vs final | Both have 11 mocked API reads and 7 subscriptions; `before-inbox-stats.json` / `browser-results.json` |
| More request/subscription ownership | 11 mocked API reads and 7 subscriptions before and after repeated open/close: **zero added** |
| TypeScript | `tsc --noEmit --incremental false` passed; `typecheck.log` |
| Focused lint on nine affected TSX files | Five existing errors on baseline and final; **none introduced**. Raw lint is not green; `lint-comparison.json` |
| Desktop Inbox and Settings at 1440×900 | **Zero changed pixels** against the untouched baseline for both fixtures; `desktop-pixel-comparison.json` |
| Fixture compilation | Installed webpack/TypeScript/Tailwind/PostCSS successfully built the actual components and CSS; no dependency changes |

Browser coverage: 320px and 390px phones, 844×390 landscape, 834×1112 and 1180×820 tablets, 1024×1366 and 1366×1024 touch iPad Pro emulation, and desktop. Checks cover four bottom destinations, original Profile route, More routes and active states, outside/close/Escape/Tab behavior, notification badges/panel clearance, long workspace names, one existing workspace-switch action, permitted/denied Integrations, authorized/unauthorized Admin, short-landscape Filter/Smart View/workspace-picker clearance, English/Khmer labels and custom primary colors. Notifications and More also clear the bottom navigation when the visual viewport shrinks independently of the layout viewport; this remains emulation, not physical keyboard proof.

Independent fixture expectations: All contains 45 conversations (existing bounded row window expands on scroll), Unread contains 8 conversations, Comments contains 1 Facebook comment thread, Pinned contains 1 conversation, and Assign to me contains 0. The 8 unread conversations have 36 unread messages; the tab's existing conversation count is preserved. Smart View selection and its empty population are checked. Conversation Back retains search, exact scroll position and draft; browser Forward restores the conversation and cannot leave More stuck as an invisible modal. Rapid menu returns retain the existing Inbox filter URL; clicking active Inbox adds no request, reload or history entry.

There are no new fetchers, polling loops or realtime subscriptions. Normal Next route prefetch behavior remains the existing link behavior. The fixture does not measure production RSC requests or hosted costs. Notification opening retains its existing refresh reads; explicit workspace switching retains its existing reload. Earlier harness-failure evidence is retained; the final result is `browser-results.json` and `browser-check.log`.

## Screenshots

All screenshots use synthetic customers/account data. [Phone before](evidence/compact-navigation-20261012/before-phone.png), [phone after](evidence/compact-navigation-20261012/phone-inbox.png), [More drawer](evidence/compact-navigation-20261012/phone-more.png), [notifications](evidence/compact-navigation-20261012/phone-notifications.png), [Smart View](evidence/compact-navigation-20261012/phone-smart-view.png), [chat](evidence/compact-navigation-20261012/phone-chat.png), [authorized Settings/Admin](evidence/compact-navigation-20261012/settings-authorized-admin.png), [regular Settings](evidence/compact-navigation-20261012/settings-regular-member.png), [tablet before](evidence/compact-navigation-20261012/before-tablet.png), [tablet after](evidence/compact-navigation-20261012/tablet-portrait.png), [iPad Pro](evidence/compact-navigation-20261012/ipad-pro-landscape.png), [short-landscape Filter](evidence/compact-navigation-20261012/phone-landscape-filter.png), [Khmer](evidence/compact-navigation-20261012/phone-khmer.png), [desktop](evidence/compact-navigation-20261012/desktop.png), [desktop Settings](evidence/compact-navigation-20261012/desktop-settings.png). Remaining screenshots are listed in `browser-results.json`.

## Changed files

Production web:

```
app/dashboard/settings/layout.tsx
app/inbox-compact.css
components/dashboard/dashboard-header.tsx
components/dashboard/dashboard-mobile-menu.tsx
components/dashboard/dashboard-navigation-label.tsx
components/dashboard/dashboard-utility-navigation.tsx
components/dashboard/team-notification-center.tsx
components/dashboard/workspace-switcher.tsx
components/inbox/conversation-list-header.tsx
components/inbox/conversation-list.tsx
```

Validation: `tests/compact-navigation.test.cjs`, `tests/compact-navigation-browser-check.mjs`, `tests/compact-navigation-lint.cjs`, `tests/fixtures/compact-navigation-app.cjs`, and the navigation option in `tests/inbox-compact-browser-build.cjs`. This report and its evidence directory are new. Earlier Inbox/Integrations evidence and source were preserved.

## Untested / limits

No physical iPhone/iPad was available. Keyboard coverage shrinks the browser viewport; safe-area coverage simulates reserved space. These are not proof of real iOS keyboard transitions, notches, Home Screen launch, rotation, gestures or VoiceOver. Standalone metadata and its existing limitations are unchanged.

Analytics/Subscription/Integrations/Profile/Admin destination content is represented by isolated route fixtures; Settings uses its actual navigation layout with fixture form content. Live sessions, production permission/MFA enforcement, real notification delivery, sign out, all settings saves and every customer action were not exercised. No real customer messages or provider operations were sent. The previous complete-suite failures remain documented in `docs/inbox-compact-web.md`; this task reran the focused relevant suite. A production Next build was not rerun for this navigation-only task.
