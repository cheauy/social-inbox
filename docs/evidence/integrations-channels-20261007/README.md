# Integrations channel styling follow-up — 2026-10-07

Removed the normal Messenger “Token valid” feature label. Expired/invalid token labels, authorization warnings, reconnect actions and underlying validation are retained.

Telegram now uses the same responsive six-column presentation as Messenger, with stacked rows below 960px of available panel width. Bot names, usernames, Bot IDs, existing status/webhook state and the existing row expansion are preserved. “Details” labels the same existing expansion action; all connection, activate, disable, disconnect, confirmation and permission controls remain in expanded details. No Inbox link or new provider action was invented.

TikTok uses the matching table header, spacing, borders and responsive empty/coming-soon panel. Existing availability, subscription explanations and disabled control remain. No connected accounts are fabricated, and neither TikTok integration was enabled. Instagram and WhatsApp panels retain their existing styling.

## Changed files

- `app/dashboard/integrations/page.tsx`: normal valid-token label removed; attention-only label retained.
- `components/integrations/telegram-channel-panel.tsx`: row/table markup and styling, existing detail markup/handlers preserved.
- `components/integrations/integration-workspace.tsx`: TikTok-only compact panel/header styling.
- Existing fixture/build/check files under `tests/`: baseline Telegram source pinned to `8c4870e`, isolated multi-bot/empty fixtures, mocked actions, layout screenshots and focused follow-up assertions.
- This evidence directory. Prior layout evidence is retained in `../integrations-layout-20261007/`.

## Actual checks

- Browser baseline: 69 passed. Final presentation: 73 passed. The four extra final-only assertions cover valid-label removal, matching Telegram/TikTok desktop headers and the available-width stacked layout.
- All 26 recorded mocked request/query/navigation traces match the baseline. Initial fetches remain two, with identical workspace/platform query filters. Telegram effects/callbacks/memo calculations and action functions are unchanged; no fetching or subscription was added.
- Telegram fixture checks cover live/disabled bots, selecting the second bot for webhook details, selected-bot confirmation, cancellation without deletion, mocked disconnect failure, disable/activate endpoints, successful disconnect retaining the other bot, empty state, password input/empty-token guard and view-only restrictions.
- Responsive screenshots/checks cover desktop 1440×900, tablet 834×1112 and mobile 390×844; inherited checks include 320, 1024, 1280 and 1920px widths plus narrowed desktop content. No page-level horizontal overflow was observed.
- Existing permission/TikTok callback/Personal guard suite: 107 passed, zero failures (`regression-tests.log`). No provider authorization or real messages/account operations were performed.
- Standalone TypeScript passed (`tsc --noEmit --incremental false`).
- Scoped lint has **two pre-existing errors and four pre-existing warnings**. Telegram's `react-hooks/set-state-in-effect` findings are at lines 171 and 175; the original Telegram source has the same two errors and its unused helper warning (`lint-telegram-baseline.json`). The workspace's three image warnings are unchanged. No new lint errors were introduced, and unrelated effects were not rewritten or suppressed.
- Final production build passed, including TypeScript and static generation (`production-build.log`). Source files match the isolated build copy byte-for-byte (`source-build-parity.json`).
- `git diff --check` passed, with only the normal LF/CRLF advisory.

## Screenshots

Actual Integrations components with synthetic data, within the existing panel frame; the full authenticated app shell is not rendered.

| Channel / viewport | Before | After |
| --- | --- | --- |
| Messenger / desktop | [Before](before-desktop.png) | [After](after-desktop.png) |
| Telegram / desktop | [Before](before-telegram-desktop.png) | [After](after-telegram-desktop.png) |
| Telegram / tablet | [Before](before-telegram-tablet.png) | [After](after-telegram-tablet.png) |
| Telegram / mobile | [Before](before-telegram-mobile.png) | [After](after-telegram-mobile.png) |
| TikTok / desktop | [Before](before-tiktok-desktop.png) | [After](after-tiktok-desktop.png) |
| TikTok / tablet | [Before](before-tiktok-tablet.png) | [After](after-tiktok-tablet.png) |
| TikTok / mobile | [Before](before-tiktok-mobile.png) | [After](after-tiktok-mobile.png) |

## Limits

Real OAuth/provider connection, webhook registration, production data, enabled Telegram Personal, physical touch devices, other browsers and full keyboard/screen-reader navigation were not exercised. Mocked mutation checks operate only on synthetic browser fixtures. Both TikTok flows remain disabled; hosting, SQL, credentials and deployment configuration were not changed. This is a layout-only follow-up, not activation approval.

No push or deployment. Existing source, dotenv files, databases, junctions, unrelated edits and prior evidence were preserved. Temporary isolated Edge profiles/build copies remain local; no cleanup deletion was performed.

Reproduce browser proof after running the existing fixture builder:

```powershell
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy node tests/integrations-layout-browser-build.cjs
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy node tests/integrations-layout-browser-check.mjs --channels --baseline
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy node tests/integrations-layout-browser-check.mjs --channels
```
