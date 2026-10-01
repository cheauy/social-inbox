-- SELECT-only checks for Supabase project dvieoqprsmzydtepbxwn.
-- Confirm the SQL editor project before running. No RPC invocation, message bodies,
-- DDL, EXPLAIN ANALYZE, credentials, or data mutations are included.
-- Missing RPC rows mean paging is not installed; the app retains legacy loading.

SELECT current_database() AS database_name, current_user AS inspecting_role;

WITH expected(signature) AS (VALUES
  ('public.tenh_inbox_filter_matches(jsonb,jsonb,uuid)'),
  ('public.tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)')
)
SELECT e.signature, p.oid IS NOT NULL AS exists,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer, p.provolatile AS volatility,
       p.proconfig AS function_settings
FROM expected e LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature);

-- Expected: service_role execute=true, anon/authenticated/public execute=false.
WITH expected(signature) AS (VALUES
  ('public.tenh_inbox_filter_matches(jsonb,jsonb,uuid)'),
  ('public.tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)')
)
SELECT e.signature, r.rolname,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege(r.oid,p.oid,'EXECUTE') END AS can_execute
FROM expected e CROSS JOIN pg_roles r
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
WHERE r.rolname IN ('anon','authenticated','service_role')
ORDER BY e.signature,r.rolname;

SELECT n.nspname, p.proname, a.privilege_type,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
WHERE n.nspname='public' AND p.proname IN ('tenh_inbox_page','tenh_inbox_filter_matches')
ORDER BY p.proname,grantee;

-- Inspect definitions, including equivalent indexes with different names.
-- Candidates are not evidence of a measured improvement; no indexes are created.
SELECT t.relname AS table_name, i.relname AS index_name,
       x.indisvalid, x.indisready, pg_get_indexdef(x.indexrelid) AS definition
FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid
JOIN pg_class i ON i.oid=x.indexrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN
  ('messages','conversations','team_members','business_subscriptions','social_accounts','contacts','contact_tags')
ORDER BY t.relname,i.relname;

-- Expected history ordering candidate: conversation_id, platform_created_at DESC, id DESC.
-- Existing created_at index supports a different ordering; retain it.
-- Conversation candidate: business_id, is_pinned DESC, last_message_at DESC NULLS LAST, id DESC.
-- Optional global duplicate lookup candidate: platform_message_id WHERE NOT NULL.
-- Missing candidates alone do not justify applying DDL without plan review.
SELECT relname,indexrelname,idx_scan,idx_tup_read,idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname='public' AND relname IN ('messages','conversations')
ORDER BY relname,indexrelname;

SELECT pubname,schemaname,tablename FROM pg_publication_tables
WHERE schemaname='public' AND tablename IN ('messages','conversations')
ORDER BY pubname,tablename;

-- One dependency check for paging and disabled durable rule storage. SELECT only.
WITH expected(table_name, columns) AS (VALUES
 ('team_members', ARRAY['id','business_id','user_id','is_active','created_at']),
 ('business_subscriptions', ARRAY['business_id','status','current_period_end','trial_ends_at','created_at']),
 ('conversations', ARRAY['id','business_id','status','unread_count','is_pinned','last_message_at','updated_at','assigned_to','source_type','last_message_text','social_account_id','contact_id']),
 ('social_accounts', ARRAY['id','business_id','platform','platform_account_id','is_active','telegram_token_status','facebook_token_status']),
 ('contacts', ARRAY['id','business_id','full_name','phone','platform_user_id']),
 ('contact_tags', ARRAY['contact_id','tag_id']),
 ('tags', ARRAY['id','business_id','name']),
 ('messages', ARRAY['id','business_id','conversation_id','platform_created_at'])
), required AS (SELECT table_name,unnest(columns) AS column_name FROM expected)
SELECT r.table_name,r.column_name,c.column_name IS NOT NULL AS exists,c.data_type,c.udt_name
FROM required r LEFT JOIN information_schema.columns c
 ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
ORDER BY r.table_name,r.column_name;

-- Inspect every overload and definition before CREATE OR REPLACE; no invocation.
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 p.prosecdef AS security_definer,p.proconfig,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('tenh_inbox_page','tenh_inbox_filter_matches','tenh_bot_save_rule_set') ORDER BY p.proname,p.oid;

SELECT to_regclass('public.tenh_bot_rule_sets') AS existing_bot_storage;
