# Integrations layout verification — 2026-10-07

Only the Integrations presentation was changed. Desktop uses the reference's compact Page / Account, Channel, Status, Features, Page ID and Actions columns. The layout switches to stacked rows when the available panel width is below 960px, including when the existing app sidebar reduces desktop space. Tabs remain horizontally scrollable on small screens. Account names and provider IDs wrap rather than overflow. Native account menus remain unclipped and have an accessible account-specific label.

## Application files

- `app/dashboard/integrations/page.tsx`: responsive account rows, column labels, existing status/features/actions repositioned, smaller spacing, decorative Messenger mark, visible mobile Page ID and accessible native-menu label.
- `components/integrations/integration-workspace.tsx`: compact title, subtitle, Add Connection button and tabs; a CSS container for available-width layout.

All server auth/permission/subscription checks, selected-business query/filter, account filtering, link destinations, disconnect component/props, notices and warning conditions are retained. Client state, effects, summary fetching, cache options, callbacks, Telegram panels and modal handlers are unchanged. Main app navigation, other pages, SQL, package dependencies and TikTok code/configuration were not edited. The reference's search control was not added: account search would add behavior beyond this layout-only request.

## Verification files

- `tests/fixtures/integrations-layout-browser.entry.cjs`: isolated synthetic accounts, permission/subscription modes and mocked APIs/navigation.
- `tests/integrations-layout-browser-build.cjs`: builds the actual Integrations server/client components and the baseline at commit `8c4870e` using existing Next/TypeScript/Tailwind dependencies.
- `tests/integrations-layout-browser-check.mjs`: runs the interaction and viewport checks in an isolated headless Edge profile.
- This evidence directory: results, screenshots, request comparison, lint results, source hashes and build/test logs.

No new dependencies or real customer/provider fixtures were introduced. External hostname resolution is blocked for the fixture browser; only its own localhost server is allowed. Disconnect is mocked. Its Edge child and localhost server are stopped; temporary profiles/build copies are retained, without deleting or moving existing files or junctions.

## Screenshots

These screenshots render the actual Integrations page and its panel frame with synthetic data. They do not include the full authenticated app shell. The existing navigation was not edited; a narrowed desktop pane separately tests available width.

| Web viewport | Before | After |
| --- | --- | --- |
| Desktop, 1440 × 900 | [Before](before-desktop.png) | [After](after-desktop.png) |
| Tablet, 834 × 1112 | [Before](before-tablet.png) | [After](after-tablet.png) |
| Mobile, 390 × 844 | [Before](before-mobile.png) | [After](after-mobile.png) |
| Mobile with disabled/expired fixtures | [Before](before-attention-mobile.png) | [After](after-attention-mobile.png) |

## Results against final source

| Check | Actual result | Evidence |
| --- | --- | --- |
| Original layout baseline | 48 checks passed | `before-results.json` |
| Redesigned layout | 49 checks passed; the extra check verifies the new container-driven stacked layout | `after-results.json` |
| Server/API/navigation parity | All 18 scenario traces are identical: 38 mocked requests across the recorded scenarios; 2 initial requests in each layout; same server query and selected-business/platform filters | `request-comparison.json`, before/after results |
| Permission/OAuth/disabled-feature regressions | 107 passed, 0 failed | `regression-tests.log` |
| TypeScript | `tsc --noEmit --incremental false` passed | `typecheck.log` (empty successful output) |
| Scoped ESLint | 0 errors; 3 pre-existing `no-img-element` warnings in `integration-workspace.tsx`; no warnings in added fixtures or page | `lint-results.json` |
| Final production build | `next build --webpack` passed, including TypeScript and static generation | `production-build-final.log` |
| Source/build copy parity | Both changed application files matched the final build copy byte-for-byte | `final-source-hashes.json`, `build-location.txt` |
| Whitespace | `git diff --check` passed; only Git's LF-to-CRLF advisory was printed | Local check |

Viewport checks also cover 320 × 740, 1024 × 768, 1280 × 800 and 1920 × 1080, plus a 900px desktop pane. Existing rows, focusable native menus, menu bounds, long names/IDs and Khmer labels were checked for horizontal overflow.

Interaction checks cover Add Connection instructions and Escape dismissal; native account menu; page-specific Inbox URL; disconnect confirmation/history notice, cancellation, mocked failure and success with unchanged router replace/refresh; Telegram tab and existing connection; Telegram Bot/disabled Personal options; coming-soon Instagram/WhatsApp/TikTok panels; return to Messenger; view-only restrictions; Billing restriction; no-access early return without channel queries; empty connect form; disabled/expired actions and notices; callback success/warning notices and read-error state.

The 107 existing regressions came from `facebook-oauth-workspace-binding.test.cjs`, `tiktok-account-holder-callback.test.mjs`, `tiktok-advertiser-oauth.test.mjs` and `telegram-personal-visibility-guard.test.cjs`. These use isolated mocks; no provider authorization occurred. Both TikTok features remain disabled: the local dotenv file has no enable flags, advertiser defaults to disabled, and account-holder remains hard-disabled. No flag or credential configuration was changed.

## Limits and untested flows

- No real Facebook/Telegram OAuth, bot-token connection, webhook registration, provider disconnect, production database or hosted-browser operation was exercised. Existing route/action code was preserved; navigation/disconnect assertions use isolated fixtures.
- Active Telegram Personal authorization/chat flows were not exercised; disabled Personal availability and access-guard regressions were tested.
- Native touch devices, non-Edge browsers and screen-reader navigation were not tested. Responsive checks are web viewport checks, not native-app tests.
- The headless Enter-activation attempt did not open the native summary on the original baseline either. It is not counted as a passing keyboard-activation test. Menu focusability, click activation, Escape dismissal and visible bounds pass; full keyboard activation remains unverified.
- Request equality covers mocked application fetch/query/navigation traces, not real provider latency, production traffic/cost or every browser asset request.

The first production build passed before the available-width refinement; the final build was rerun after that refinement. All final browser/lint/type/build results apply to the final application files. Changes are local and uncommitted; nothing was pushed or deployed.

## Reproduce

From the workspace, prefix test/build commands with the project's RTK executable:

```powershell
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy node tests/integrations-layout-browser-build.cjs
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy node tests/integrations-layout-browser-check.mjs --baseline
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy node tests/integrations-layout-browser-check.mjs
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy node --test tests/facebook-oauth-workspace-binding.test.cjs tests/tiktok-account-holder-callback.test.mjs tests/tiktok-advertiser-oauth.test.mjs tests/telegram-personal-visibility-guard.test.cjs
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy npx tsc --noEmit --incremental false
& 'C:\Users\TUF\AppData\Local\Headroom\headroom\bin\rtk.exe' proxy npx eslint app/dashboard/integrations/page.tsx components/integrations/integration-workspace.tsx tests/integrations-layout-browser-build.cjs tests/integrations-layout-browser-check.mjs tests/fixtures/integrations-layout-browser.entry.cjs
```

The production build was run from the isolated copy recorded in `build-location.txt`, with `NEXT_TELEMETRY_DISABLED=1`. Its `node_modules` junction points to the existing installation; the source checkout's `.next` was not replaced. Local dotenv files were copied only within the local isolated build and their contents are not included in review evidence.
