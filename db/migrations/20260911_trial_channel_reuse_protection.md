# Trial protection rollout

1. Run `20260911_trial_channel_reuse_protection.sql` in Supabase SQL Editor as the database owner, before deploying the matching application code. It uses one transaction and backfills retained Facebook Page / Telegram Bot history. It does not delete messages, channels, customers, or subscriptions.
2. Deploy the onboarding and channel connection changes together. The new connection preflight fails closed if its database function is missing.
3. On a staging project, check a verified fresh signup receives the original 7-day trial, 3 channels, and 1 seat. Retrying onboarding must preserve the same expiry.
4. Connect a test Page during a trial, then disconnect/delete that test workspace. A different trial workspace must be unable to connect the same Page. Repeat for a Telegram Bot. A paid workspace with sufficient channel capacity may connect it, subject to existing channel ownership rules. Test only with your own test assets.
5. Check trial reconnection within the original workspace still works before expiry. Expired trials must not connect channels. Existing paid workspaces must still connect normally.

Application regression checks: `node --test scripts/test-trial-security.cjs`.
These mock database responses; they do not replace the staging database tests above.

The channel ledger has no foreign keys to deletable accounts/workspaces, and clients have no access to it. Keep both trial claim tables when cleaning account data. Previously deleted channel rows cannot be reconstructed by the backfill. SQL owners/service administrators can still override protections deliberately.

The existing two-claims-per-IP/30-days limit remains and is also serialized at the database boundary. Shared office networks can hit that limit; cookies/IPs are supporting signals, not proof of a person's identity. New emails, devices, networks, and entirely different Pages cannot reliably be identified as the same person. The permanent channel ledger specifically prevents repeat trials for the same Page/Bot.

Preserve the existing trial HMAC secret. Do not replace it with a fresh value without a migration strategy: existing email/device hashes must remain comparable. Verify email confirmation, signup rate limits, and CAPTCHA settings separately in the production Supabase dashboard; those hosted settings were not changed by this patch.
