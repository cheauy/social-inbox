# Direct Bakong checkout retirement (local only)

Direct Bakong is removed from customer checkout and application new-attempt creation. ABA PayWay, including its QR checkout, and manual transfer are retained. Authenticated stale/fresh Bakong checkout POST requests return HTTP 410 with `BAKONG_CHECKOUT_RETIRED`; both general and pilot flags cannot re-enable issuance. GET discovery continues to locate saved attempts, and paid/unpaid attempts, receipts, evidence, cancellation history, and bounded customer/admin reconciliation remain available. The trusted SQL preparation function is retained with its existing service-role permissions; there is no application caller. No schema, permissions, credentials, production settings, or financial data are changed.

The primary checkout is untouched. This work starts from verified remote main `35b5fdd8a4b0cef942fda658506a0daa10b44e98` in `C:/Users/TUF/AppData/Local/Temp/tenh-retire-direct-bakong`, branch `retire-direct-bakong`. Publication is on hold for coordination with the Facebook release.

## Rollout action requiring approval

At the coordinated release, deploy the reviewed application change and set production `BAKONG_CHECKOUT_ENABLED=false` as defense in depth. The application retirement itself blocks new issuance regardless of flags. Before changing `BAKONG_PILOT_ENABLED`, inspect whether any issued pilot requires its existing bounded inquiries; switching that flag off blocks those inquiries. Preserve its current value until that reconciliation review is complete. Keep the Bakong credentials, authorizations, tables, settlements, history, lifetime inquiry limits and daily request budget. Keep `KHQR_CHECKOUT_ENABLED` as it is: it controls historical checkout lifecycle/cancellation and is not the issuance retirement switch. No SQL rollout is needed for retirement.

Only the primary local `.env.local` flag values were read: `BAKONG_CHECKOUT_ENABLED=true`, `BAKONG_ENVIRONMENT=production`; the pilot flag is absent there (defaults false). These local values are not proof of hosted production settings. No remote setting was read or changed.

## Verification

- 53 API/isolated PostgreSQL tests pass: stale/new POST rejection under every general/pilot flag combination, zero new financial rows/provider requests, preserved unpaid/paid discovery, receipt history, late settlement evidence, exactly-once activation, cancellation and bounded reconciliation.
- 17 React tests pass: retired option absent even with a stale enabled server response; PayWay/manual availability; existing automatic inquiry scheduling, shared cooldowns, exhaustion and admin verification behavior.
- 67 PayWay/manual/history/pending regression tests pass, plus the optional manual PostgreSQL migration test run separately with its installed PGlite dependency. Another 47 legacy KHQR-disabled/provider/display/core tests pass.
- Eight EN/KM viewport cases (390/768/1024/1440) pass 88 responsive browser assertions with synthetic data, zero provider requests and zero real payments. Screenshots are under `docs/evidence/bakong-retirement-20261017/browser/` and were visually inspected.
- `tsc --noEmit --incremental false` passes. Targeted ESLint has zero errors and four existing warnings (one translation dependency, three raw image elements). `git diff --check` passes.

On this Windows checkout, existing SQL fixture string matching requires LF text. `.codex/bakong-test-lf.cjs` normalizes SQL reads only in the test process; SQL files and database contracts are unchanged. React tests use the already-installed jsdom at `C:/Users/TUF/AppData/Local/Temp/tenh-bakong-test-deps/node_modules` through `NODE_PATH`. No dependency installation occurred. Detailed local logs are `.codex/bakong-retirement-*.txt`.

## Approved checking-payment mockup

The original Library helper blockers were resolved by the user supplying the reference at `C:/Users/TUF/social-inbox/public/images/payment-status-mockup.png`. The explicit local file was verified and its pixels inspected directly. The responsive PayWay/manual status implementation is recorded in `docs/payment-status-ui-20261017.md`. The reference was preserved and is not included in this branch as a production asset.
