-- Pending approval: MAINTAIN-only correction on the five new Bot tables.
-- No data, ownership, role membership, default privilege or schema changes.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
 IF current_setting('server_version_num')::integer < 170000 THEN
  RAISE EXCEPTION 'MAINTAIN correction requires PostgreSQL 17 or later';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolsuper)
   OR pg_has_role('service_role','pg_maintain','USAGE') THEN
  RAISE EXCEPTION 'Service superuser or inherited pg_maintain access requires a separately approved role correction';
 END IF;
END
$guard$;
REVOKE MAINTAIN ON TABLE
 public.tenh_bot_rule_sets,
 public.tenh_bot_execution_controls,
 public.tenh_bot_recipient_state,
 public.tenh_bot_events,
 public.tenh_bot_execution_jobs
FROM service_role;
DO $verify$
DECLARE relation_name text; relation_id oid; privilege_name text;
BEGIN
 FOREACH relation_name IN ARRAY ARRAY[
  'tenh_bot_rule_sets','tenh_bot_execution_controls','tenh_bot_recipient_state',
  'tenh_bot_events','tenh_bot_execution_jobs'] LOOP
  relation_id := to_regclass('public.' || relation_name);
  IF relation_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM pg_class WHERE oid=relation_id AND relkind='r' AND relrowsecurity
  ) THEN RAISE EXCEPTION 'Unexpected table or RLS state: %',relation_name; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=relation_id
    AND pg_has_role('service_role',c.relowner,'USAGE')) THEN
   RAISE EXCEPTION 'Service table ownership requires separate review: %',relation_name;
  END IF;
  FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
   IF NOT has_table_privilege('service_role',relation_id,privilege_name) THEN
    RAISE EXCEPTION 'Required service privilege absent on %: %',relation_name,privilege_name;
   END IF;
  END LOOP;
  FOREACH privilege_name IN ARRAY ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   IF has_table_privilege('service_role',relation_id,privilege_name) THEN
    RAISE EXCEPTION 'Excess effective service privilege remains on %: %',relation_name,privilege_name;
   END IF;
  END LOOP;
  FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   IF has_table_privilege('service_role',relation_id,privilege_name || ' WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'Service grant option requires separate review on %: %',relation_name,privilege_name;
   END IF;
  END LOOP;
  IF has_any_column_privilege('service_role',relation_id,'REFERENCES')
    OR has_any_column_privilege('service_role',relation_id,'SELECT WITH GRANT OPTION')
    OR has_any_column_privilege('service_role',relation_id,'INSERT WITH GRANT OPTION')
    OR has_any_column_privilege('service_role',relation_id,'UPDATE WITH GRANT OPTION') THEN
   RAISE EXCEPTION 'Unexpected service column privileges require separate review: %',relation_name;
  END IF;
 END LOOP;
END
$verify$;
COMMIT;
