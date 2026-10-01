-- Pending exact action-time approval. Existing rows and schema are untouched.
-- Revoke ONLY DELETE, TRUNCATE, TRIGGER, REFERENCES on these five tables.
-- If ownership, superuser status or role inheritance retains excess effective
-- access, fail and roll back; do not alter role memberships or global defaults.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE
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
  ) THEN RAISE EXCEPTION 'Unexpected table or RLS state: %', relation_name; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolsuper)
    OR EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=relation_id
      AND pg_has_role('service_role',c.relowner,'USAGE')) THEN
   RAISE EXCEPTION 'Unexpected service ownership/superuser access on %; no role repair applied.',relation_name;
  END IF;
  FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
   IF NOT has_table_privilege('service_role',relation_id,privilege_name) THEN
    RAISE EXCEPTION 'Required service privilege absent on %: %',relation_name,privilege_name;
   END IF;
  END LOOP;
  FOREACH privilege_name IN ARRAY ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege('service_role',relation_id,privilege_name) THEN
    RAISE EXCEPTION 'Excess effective service privilege remains on %: %. Check ownership/inheritance; no role repair applied.',relation_name,privilege_name;
   END IF;
  END LOOP;
 END LOOP;
END
$verify$;
COMMIT;
