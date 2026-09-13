# TENH CHAT — today-only connection import

The Conversations API import already existed. This update tightens the import window and adds persistent pagination so a limited pass can continue on the next background run. It also removes **Edit conversation link**, **Set conversation link**, and the manual link form from the inbox.

The requested rule is: when a Page is first connected or reconnected, import only messages from today's local calendar day, using small paginated batches and skipping messages already stored in TENH. Registering an account alone cannot import chats; a Facebook Page must be connected with the required access.

## Install

1. Apply `db/migrations/20260913_facebook_today_recovery.sql` in Supabase SQL Editor. It creates a server-only checkpoint table and a short worker lease. Apply this migration before starting the updated server, including when the ordinary background recovery job is enabled.
2. Merge the included files into your current TENH project, preserving their folders. This is a changed-files patch for the project after the Conversations Thread API update.
3. Restart Next.js and refresh TENH. Deploy the updated website when ready. No extension update is needed.
4. Ensure your existing scheduler invokes `GET /api/cron/facebook-connection-health` regularly, for example every five minutes, with the existing `Authorization: Bearer <CRON_SECRET>` header. Store the secret in the scheduler's secret configuration. The supplied project did not contain deployment scheduling configuration, so its live cadence could not be verified or changed. Each run performs another bounded batch; a daily-only schedule will leave most same-day imports unfinished.

Connecting a Page starts the first batch through the existing Next.js `after()` callback. There is no need to wait for cron for that first batch. The checkpoint and pending flag retain unfinished Messenger work for subsequent runs.

## Behavior

- The default timezone is `Asia/Phnom_Penh`. A valid `TENH_TIMEZONE` setting overrides it. The cutoff is exactly local midnight, including seconds and daylight-saving changes. Reconnection lookback arguments and the old reconnect lookback environment override cannot expand it to previous days.
- Conversation listing requests use a limit of **20**. Message listing requests use a limit of **up to 50**, reduced when less room remains in the current batch. One reconnect Messenger batch imports at most **50** messages, with at most six primary Graph operations and a 45-second budget checked between operations. Token recovery can make additional requests, and an in-flight operation may finish after that budget.
- The importer filters message timestamps before writing. It excludes previous-day, missing/invalid, and future timestamps. It checks that the Page and customer match the thread and each message.
- The database stores the Page's pagination checkpoint. Retried pages skip committed message IDs. An expiring lease prevents overlapping reconnect workers for the same Page. Provider paging URLs and Page access tokens are not stored in the checkpoint.
- The connection-day boundary remains after the pending flag clears. This prevents the ordinary recovery window from importing pre-connection history just after midnight. The existing rolling recovery window still covers short delivery gaps during ongoing use.
- A reconnect creates a fresh scan. An unfinished reconnect scan that reaches the next local day resets to that new day's cutoff; it does not continue importing the previous day's backlog. Completion therefore depends on a sufficiently frequent background schedule and Meta availability.
- The existing comment-recovery pass also uses today's cutoff on connection/reconnection, with at most 20 posts and 50 comment candidates. Comment recovery is bounded best effort; the resumable cursor in this update is for Messenger messages.
- Existing messages already saved in TENH are retained. The live webhook receive path is unchanged.

The importer uses `/PAGE_ID/conversations` and `/THREAD_ID/messages`, keeps IDs as strings, and uses Meta's returned cursors. It scans recent activity first and stops pagination when it reaches older activity. It does not download all historical conversations.

**View this conversation** and the thread lookup API remain available. Existing saved destinations are retained. Finding `thread_id` still does not establish that a legacy Facebook inbox link can select that customer in Business Suite. This patch removes the manual-edit controls; it does not solve the provider redirect limitation.

## Verify in your environment

1. Use a test Page with one message from yesterday and one from today, then connect or reconnect it. Today's message should import; yesterday's message should not be newly imported. Previously stored messages remain visible.
2. For a thread with more than 50 messages today, inspect the first pass and then the next scheduled run. Later batches should continue from the saved cursor without duplicating messages.
3. Reconnect again and verify that already imported message IDs remain unique.
4. Confirm the inbox has no **Edit conversation link** or **Set conversation link** controls.

Read-only checkpoint inspection:

```sql
select social_account_id,
       cursor->>'dayStart' as cutoff_epoch_ms,
       cursor->>'done' as messenger_complete,
       jsonb_array_length(coalesce(cursor->'queue', '[]'::jsonb)) as queued_threads,
       lease_until,
       updated_at
from public.facebook_today_recovery
order by updated_at desc;
```

Local validation completed: **116 tests passed**, covering calendar boundaries, bounded pagination, duplicate prevention, partial failures, lease overlap, reconnect flags, customer isolation, and the updated UI. **540 TypeScript files checked with zero diagnostics.** Tests used mocked Meta/database responses and JSDOM. The SQL migration and live Facebook import were not run against your deployment.

Core import regression command, using the project's installed TypeScript dependency:

```sh
node --test scripts/test-facebook-today-recovery.cjs
```

The included UI regression tests additionally require `jsdom` in the test environment.
