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

-- One read-only verification result after successful commit.
-- Read-only. Run AFTER the approved installer succeeds, in the same project.
-- One JSON result; no credentials, customer records, sends, activation or writes.
WITH expected_tables(name) AS (VALUES
 ('tenh_bot_rule_sets'),('tenh_bot_execution_controls'),
 ('tenh_bot_recipient_state'),('tenh_bot_events'),('tenh_bot_execution_jobs')
), expected_functions(signature) AS (VALUES
 ('public.tenh_inbox_filter_matches(jsonb,jsonb,uuid)'),
 ('public.tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)'),
 ('public.tenh_bot_save_rule_set(uuid,uuid,bigint,jsonb)'),
 ('public.tenh_bot_record_event(uuid,bigint,jsonb)'),
 ('public.tenh_bot_claim_jobs(integer)'),
 ('public.tenh_bot_reserve_job(uuid,uuid)'),
 ('public.tenh_bot_finish_job(uuid,uuid,text,text,text)'),
 ('public.tenh_bot_set_human_hold(uuid,uuid,boolean)'),
 ('public.tenh_bot_recover_jobs(integer)'),
 ('public.tenh_bot_execute_internal(uuid,uuid)'),
 ('public.tenh_bot_pending_event_ids(integer)')
), tables AS (
 SELECT e.name,c.oid,c.relrowsecurity,
   NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS no_public_grants,
   NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid) AS no_client_policies,
   (SELECT jsonb_object_agg(role,privileges) FROM (
     SELECT role,(SELECT jsonb_object_agg(privilege,has_table_privilege(role,c.oid,privilege))
       FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege) privileges
     FROM unnest(ARRAY['anon','authenticated','service_role']) role) rights) AS effective_privileges
 FROM expected_tables e LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||e.name)
), functions AS (
 SELECT e.signature,p.oid,p.prosecdef,p.proconfig,
   NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0) AS no_public_grants,
   (SELECT jsonb_object_agg(role,has_function_privilege(role,p.oid,'EXECUTE'))
    FROM unnest(ARRAY['anon','authenticated','service_role']) role) AS effective_execute
 FROM expected_functions e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
)
SELECT jsonb_build_object(
 'database',current_database(),'role',current_user,'server_version_num',current_setting('server_version_num'),
 'service_role_superuser',(SELECT rolsuper FROM pg_roles WHERE rolname='service_role'),
 'service_inherits_pg_maintain',CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pg_maintain') THEN pg_has_role('service_role','pg_maintain','USAGE') ELSE false END,
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',name,'present',oid IS NOT NULL,
   'rls',relrowsecurity,'no_public_grants',no_public_grants,'no_client_policies',no_client_policies,
   'effective_privileges',effective_privileges,
   'service_grant_options',(SELECT jsonb_object_agg(privilege,has_table_privilege('service_role',oid,privilege||' WITH GRANT OPTION')) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege),
   'service_any_column_references',has_any_column_privilege('service_role',oid,'REFERENCES'),
   'column_acl',(SELECT jsonb_agg(jsonb_build_object('column',a.attname,'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,'privilege',x.privilege_type,'grantable',x.is_grantable)) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=tables.oid AND a.attnum>0 AND NOT a.attisdropped),
   'service_maintain_grant_option',CASE WHEN current_setting('server_version_num')::integer>=170000 THEN has_table_privilege('service_role',oid,'MAINTAIN WITH GRANT OPTION') ELSE NULL END,
   'service_maintain',CASE WHEN current_setting('server_version_num')::integer>=170000 THEN has_table_privilege('service_role',oid,'MAINTAIN') ELSE NULL END,
   'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=tables.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT jsonb_agg(pg_get_constraintdef(k.oid)) FROM pg_constraint k WHERE k.conrelid=tables.oid),
   'indexes',(SELECT jsonb_agg(jsonb_build_object('name',i.relname,'valid',x.indisvalid,'definition',pg_get_indexdef(x.indexrelid))) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid WHERE x.indrelid=tables.oid)
   ) ORDER BY name) FROM tables),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'present',oid IS NOT NULL,
   'security_invoker',NOT prosecdef,'config',proconfig,'no_public_grants',no_public_grants,
   'effective_execute',effective_execute) ORDER BY signature) FROM functions),
 'unexpected_overloads',(SELECT coalesce(jsonb_agg(p.oid::regprocedure::text),'[]'::jsonb)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN
     (SELECT split_part(split_part(signature,'.',2),'(',1) FROM expected_functions)
   AND p.oid NOT IN(SELECT oid FROM functions WHERE oid IS NOT NULL)),
 'disabled_state',jsonb_build_object(
   'enabled_rule_sets',CASE WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.tenh_bot_rule_sets') AND attname='enabled' AND atttypid='boolean'::regtype AND NOT attisdropped) THEN (xpath('/table/row/enabled_rule_sets/text()',query_to_xml('SELECT count(*) AS enabled_rule_sets FROM public.tenh_bot_rule_sets WHERE enabled',false,false,'')))[1]::text::bigint ELSE NULL END,
   'unpaused_controls',CASE WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.tenh_bot_execution_controls') AND attname='paused' AND atttypid='boolean'::regtype AND NOT attisdropped) THEN (xpath('/table/row/unpaused_controls/text()',query_to_xml('SELECT count(*) AS unpaused_controls FROM public.tenh_bot_execution_controls WHERE NOT paused',false,false,'')))[1]::text::bigint ELSE NULL END,
   'rule_enabled_default',(SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='tenh_bot_rule_sets' AND column_name='enabled'),
   'control_paused_default',(SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='tenh_bot_execution_controls' AND column_name='paused'),
   'rule_constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid=to_regclass('public.tenh_bot_rule_sets') AND contype='c'),
   'execution_job_count',CASE WHEN to_regclass('public.tenh_bot_execution_jobs') IS NOT NULL THEN (xpath('/table/row/job_count/text()',query_to_xml('SELECT count(*) AS job_count FROM public.tenh_bot_execution_jobs',false,false,'')))[1]::text::bigint ELSE NULL END),
 'paging_rpc_present',to_regprocedure('public.tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)') IS NOT NULL,
 'realtime_tables',(SELECT coalesce(jsonb_agg(tablename ORDER BY tablename),'[]'::jsonb)
   FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename IN('messages','conversations'))
) AS tenh_release_postinstall;
