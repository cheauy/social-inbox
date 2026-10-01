-- PROPOSALS ONLY. Not applied. Execute each statement separately, outside a transaction,
-- only after reviewing existing equivalent definitions and bounded plain EXPLAIN plans.
-- Keep existing created_at and pinned_at indexes: other queries may need them.

-- Actual web history cursor uses platform time, not insertion time.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_platform_created_id
  ON public.messages (conversation_id, platform_created_at DESC, id DESC);

-- Candidate for a single-workspace Inbox order. Multiple workspace/channel scopes
-- may still require a sort; there is no verified live plan or measured speedup.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_business_inbox_order
  ON public.conversations (business_id, is_pinned DESC, last_message_at DESC NULLS LAST, id DESC);

-- Optional candidate: current Messenger webhook runs this global exact-ID lookup
-- concurrently with connected-Page resolution. Existing (business_id, platform_message_id)
-- uniqueness does not begin with platform_message_id. Review write/storage overhead first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_platform_message_lookup
  ON public.messages (platform_message_id) WHERE platform_message_id IS NOT NULL;

-- Read-only metadata (no customer message bodies).
SELECT tablename, indexname, indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND tablename IN
 ('messages','conversations','contacts','contact_tags','social_accounts','team_members','business_subscriptions')
 ORDER BY tablename, indexname;

SELECT relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
 FROM pg_stat_user_indexes WHERE schemaname = 'public'
 AND relname IN ('messages','conversations') ORDER BY relname, indexrelname;

-- Substitute authorized representative UUIDs; EXPLAIN only, never ANALYZE here.
-- EXPLAIN (FORMAT JSON) SELECT id FROM public.messages
-- WHERE conversation_id = '<conversation UUID>'::uuid
-- ORDER BY platform_created_at DESC, id DESC LIMIT 26;
-- EXPLAIN (FORMAT JSON) SELECT id FROM public.conversations
-- WHERE business_id = '<business UUID>'::uuid
-- AND social_account_id = '<channel UUID>'::uuid
-- ORDER BY is_pinned DESC, last_message_at DESC NULLS LAST, id DESC LIMIT 31;
-- EXPLAIN (FORMAT JSON) SELECT id FROM public.messages
-- WHERE platform_message_id = '<provider message ID>' LIMIT 2;
