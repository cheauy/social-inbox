# Inbox border, combined picker and left navigation follow-up

Subsequent local completion: tenh-bot-stage2-drafts.md documents all seven selected Stage 2 draft-only types and their NEW tests; queued/unimplemented descriptions below are historical to this earlier batch.
Later clarification: settings-panel-style-review.md supersedes this batch's global-rail visibility on Settings and records the pale borders/downward shadows and selected left pills. Historical validation below remains specific to this earlier batch.

Local changes after user-pushed b27e557; no assistant push, deployment, remote writes, migration application, real customer sends or Bot activation.

## Corrected border reference

The parent's actual pixel inspection of libfile_79868314c78c81918902382d4cc62be6 supersedes the earlier floating-panel interpretation. This executor used that review, not an independently materialized image. The final Inbox retains connected columns and shared seams: small responsive outer margin, thin slate outline/shadow, 16px shell corners, rounded list right corners, rounded chat-header top and a separate outlined 16px composer. Existing row colors, message bubbles, date-pill lines, All/Unread/Smart Views menus, paging and scroll containers remain. The earlier 12px internal gutters/24px floating cards were reverted before finalization. No sample contents, gradient theme or decorative animation redesign was copied.

## Emoji and stickers

One existing sticker entry point now opens a combined popup. Its header RIGHT contains a two-button Emoji | Sticker toggle, not a dropdown. Switching modes does not select/send content. Emoji uses the unchanged ReplyBox caret/selection insertion handler; native emoji rendering avoids additional remote emoji-image downloads. Existing Telegram sticker draft selection, Facebook explicit sticker sends, other-channel image attachment selection, per-conversation recent choices and authorized broken-preview recovery remain. Attachment restrictions block Sticker mode without blocking ordinary emoji text insertion. Escape restores trigger focus; outside pointer closes; the popup is positioned within the visual viewport and focuses its mode button when opened. Initial positioning is immediate rather than depending on a first animation frame; resize/scroll positioning stays coalesced.

## Settings and Admin

Old header navigation entries were removed. Gear and shield links use exactly /dashboard/settings and /dashboard/admin. The existing server isCurrentUserTenhAdminIdentity check now feeds the shared navigation provider; Admin is never inferred from workspace role or client storage. Destination server authorization/MFA checks are unchanged. Inbox uses the bottom of its existing rail; other dashboard pages use one compact shared left rail. Mount tracking prevents duplicate visible rails and keeps the shared fallback available if subscription gating prevents Inbox from mounting. Subscription-read error screens also retain navigation. Accessible labels, native tooltips plus focus/hover labels and nested active-route states are present. Other header menus remain.

Runtime files for this UI batch:

- app/dashboard/inbox/page.tsx
- app/dashboard/layout.tsx
- components/dashboard/dashboard-header.tsx
- components/dashboard/dashboard-utility-navigation.tsx (new)
- components/inbox/inbox-view.tsx
- components/inbox/conversation-list.tsx
- components/inbox/conversation-header.tsx
- components/inbox/reply-box.tsx
- components/inbox/tenh-sticker-picker.tsx

Prior album changes in MessagePanel and provider/media routes remain separate and intact.

## Validation

- 97 focused tests passed: actual server layout receives true/false existing admin identity, signed-out redirect, subscription failure access, actual caret insertion/selection replacement, albums, paging, realtime/background read safety, performance and sticker caches. Zero failures/skips. Tests: dashboard-utility-navigation.test.cjs and inbox-unified-picker.test.cjs (new), plus the existing regression suites. Log: Temp/tenh-ui-final-tests.txt.
- Desktop Chrome component fixture: 42 checks passed at measured 1384x905 CSS viewport. Small-window requested 390px was actually 500px and is not claimed as 390px evidence. DevTools CSS viewport override subsequently verified 390x844 and passed all 42 checks, including popup bounds, two-mode interaction, no send on switch, text retention, Escape/focus, reopen, outside pointer, authorized/unauthorized navigation, Settings/Admin active destinations and return to Inbox. The navigation transport is a fixture stub; no real Next router or credentials are used. Production-generated CSS is included. Logs: Temp/tenh-ui-bounds-1400x1000-result.json and tenh-ui-mobile-390-result.json. CSS viewport emulation uses mobile=false to prevent content auto-expanding the layout viewport; native touch/keyboard/OS browser behavior is not established.
- Existing actual Bot page/form/API/disposable-SQL browser regression passed with fixture authentication and zero Meta/customer sends. Temp/tenh-ui-shared-layout-browser.txt.
- Final TypeScript passed. Production build passed; the initial restricted-network attempt failed fetching existing Google Fonts, then authorized network-enabled local builds passed. Final log: Temp/tenh-ui-final-navigation-build.txt; type log: tenh-ui-final-typecheck.txt.
- Seven touched existing runtime files retain their HEAD lint baseline (11 errors/19 warnings combined), with no introduced findings. New navigation component is clean. Temp/tenh-ui-lint-comparison.json. Whitespace diff check passed.

The component fixture is not the complete authenticated customer Inbox. Exact seam/corner clipping, visual equivalence to the screenshot, full responsive Inbox horizontal navigation, real touch/keyboard behavior and deployed permissions still need staging review. The existing mobile column/scroll design was preserved rather than redesigned. Browser background visibility tests are simulated; no uninterrupted background execution claim is made. No UI validation proves live provider eligibility.

## Release and queued Bot work

The source manifest/snapshot includes this UI follow-up and the unpublished album work, separate from the parent's verified user deployment. No SQL is needed for this UI batch. The earlier paging RPC and optional index proposals remain unapplied. Stage 2 Bot drafts have NO code changes or new Stage 2 validation: Ads-specific reply, returning context, connection health, comment phone/spam hiding, first-level/exclusion filters, QR/ref flows and cancellable conditional follow-ups remain queued. Stage 1 synthetic draft checks in the browser are regression checks only.
