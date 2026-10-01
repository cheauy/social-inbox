# Approved corrective release — 2026-10-01

Base: `09d312d5a96dea2c443fedc847e1bd3e01f7d448`. Publication was explicitly approved for the revised Coming Soon / Analytics / View conversation / panel-shell batch. Prepared in an isolated Temp checkout; the original `b27e557` dirty checkout and `.serena` are preserved.

- Tenh Bot has a source-level false availability gate, with no environment or administrator bypass. Web/mobile navigation hides configuration access; direct Bot pages show Coming Soon. The settings auto-reply alias still redirects to that page. All methods of rules/history/human-hold, legacy auto-reply configuration and both Bot cron APIs return 503 `TENH_BOT_COMING_SOON`. Stored execution, manual-reply Bot holds, both Bot transports and legacy auto-reply execution return before storage/provider activity; Facebook comment webhooks retain ingestion while skipping automatic execution. Code, rules and data remain preserved.
- Analytics has five accessible section icons in its own 60px far-left rail, replacing the wide reports sidebar. Settings/Admin remain contextual; Inbox choices stay in Inbox. Existing report URL selection and deep links remain.
- Messenger's desktop header displays View conversation. Customer-panel Other exposes the same action. Both share one provider request, pending state, context reset and explicit Page inbox fallback. The existing authorized provider lookup and destination validation remain unchanged.
- Analytics, Coming Soon, Subscription and Integrations use Inbox's responsive 6px/10px padding, 16px radius, light border and subtle shadow. Subscription and Integrations retain internal scrolling and existing business logic.

Three pre-existing Next.js generated-route typing blockers were fixed without runtime behavior changes: two unused constants are private to their routes, and saved-reply categories GET has the required request parameter type. No payment, connection or permission behavior changes. The unrelated saved removal of the Integrations companion card and unfinished Bot redesign were excluded.

Validation:

- 109 focused tests pass, covering API/worker hard pause even with flags enabled, direct Coming Soon, manual replies, provider navigation safety, shared pending state, Inbox live safety/paging and dashboard authorization.
- Real Chrome fixtures with production CSS pass 74 assertions at 1400px and 390px: compact rail, context isolation, shell geometry/scrolling, desktop/mobile label, both View buttons, fallback and stale-request cancellation. Report data/navigation and provider responses are synthetic. These do not prove live Meta destination availability or authenticated production behavior.
- ESLint runtime comparison against the exact base: 340 existing findings on both sides, no introduced findings. Mobile is excluded by the repository's web lint/type configuration; its route gates were reviewed, not device-tested.
- TypeScript and production webpack build passed with synthetic Supabase values. Webpack is used locally because Turbopack rejects the isolated checkout's dependency junction; production has a normal dependency install.

No SQL, credentials, environment files, grants, customer messages/hides, worker activation or schedules are included. No private backup artifacts were accessed or copied. Rollback is a normal revert of this corrective commit, preserving the base release; reverting would restore Bot configuration access and should be deliberate.
