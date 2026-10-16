# Local simulated Bakong checkout

Run from the TENH CHAT repository:

```powershell
node tests/bakong-browser.cjs --serve
```

Open http://127.0.0.1:3005/fixture.html. Use `?lang=km` for Khmer. Press Ctrl+C in the terminal to stop the demo.

1. Bakong is selected automatically. Click **Show QR**.
2. The fixture restores the exact saved attempt even though the first preparation response is deliberately lost.
3. Click **Check payment** to simulate confirmation. It shows **Test payment confirmed**, grants no subscription access and issues no receipt.
4. Reload to restore the fake attempt. **Restart demo** clears only this demo's session-storage records.

The amber banner identifies the demo. The QR encodes `TENH-LOCAL-DEMO-NOT-FOR-PAYMENT`, not a KHQR payment instruction. Do not send money. The example USD amount and workspace are fixtures, not a quote or customer workspace.

This test server binds only to loopback, loads no .env file or real credentials and serves only its allowlisted fixture assets. Auth, workspace and payment API calls are mocked in the browser; the demo's Content-Security-Policy also blocks outbound fetch/XHR, frames and forms. It cannot test bank settlement, real Auth, hosted schema compatibility or server-side quotas. The ABA/manual cards are retained for visual comparison; this interactive demo implements the Bakong path only. This flag is a test-runner option and creates no application API or production bypass.

## Why the normal local checkout is blocked

The inspected `.env.local` points at hosted Supabase, not a local database. Read-only probes returned `PGRST205` for `manual_payment_uploads` and `bakong_payment_attempts`, and `PGRST202` for `tenh_payment_application_guards_ready`. Existing manual requests remain accessible, but the prepared-upload recovery check cannot establish that another purchase is safe. The application therefore blocks all checkout methods.

Hosted migrations were previously requested to remain pending. They were not applied, and no safety check was bypassed. Actual checkout needs a separately reviewed database rollout or an isolated Supabase environment. Docker and a local Supabase configuration were unavailable on this machine during diagnosis. The required manual-upload, application-baseline and Bakong migrations also depend on the reviewed billing core; do not run isolated migration fragments without checking that contract. See [the rollout review](bakong-subscription-payments-20261015.md).
