-- ONE SELECT, metadata only. Verify dashboard project dvieoqprsmzydtepbxwn first.
WITH required(table_name,cols) AS (VALUES
 ('businesses',ARRAY['id']),
 ('team_members',ARRAY['id','business_id','user_id','is_active','created_at']),
 ('business_subscriptions',ARRAY['business_id','status','current_period_end','trial_ends_at','created_at']),
 ('conversations',ARRAY['id','business_id','status','unread_count','is_pinned','last_message_at','updated_at','assigned_to','source_type','last_message_text','social_account_id','contact_id']),
 ('social_accounts',ARRAY['id','business_id','platform','platform_account_id','is_active','telegram_token_status','facebook_token_status','facebook_page_access_token_encrypted']),
 ('contacts',ARRAY['id','business_id','full_name','phone','platform_user_id']),
 ('contact_tags',ARRAY['contact_id','tag_id']),('tags',ARRAY['id','business_id','name']),
 ('messages',ARRAY['id','business_id','conversation_id','platform_created_at','platform_message_id','sender_platform_id','direction','is_echo','raw_payload','message_type','message_text','comment_is_deleted']),
 ('facebook_customer_blocks',ARRAY['business_id','social_account_id','contact_id','is_blocked','updated_by_name','provider_confirmed_at','operation_id','operation_started_at','requested_blocked']),
 ('team_notifications',ARRAY['business_id','recipient_member_id','actor_member_id','notification_type','title','body','link','conversation_id'])
), columns AS (SELECT table_name,unnest(cols) column_name FROM required),
 missing AS (SELECT r.table_name||'.'||r.column_name name FROM columns r LEFT JOIN information_schema.columns c
 ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name WHERE c.column_name IS NULL),
 expected(signature) AS (VALUES
 ('public.tenh_inbox_filter_matches(jsonb,jsonb,uuid)'),
 ('public.tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)'),
 ('public.tenh_bot_save_rule_set(uuid,uuid,bigint,jsonb)'),
 ('public.tenh_bot_record_event(uuid,bigint,jsonb)'),
 ('public.tenh_bot_claim_jobs(integer)'),
 ('public.tenh_bot_reserve_job(uuid,uuid)'),
 ('public.tenh_bot_finish_job(uuid,uuid,text,text,text)'),
 ('public.tenh_bot_set_human_hold(uuid,uuid,boolean)'),('public.tenh_bot_recover_jobs(integer)'),
 ('public.tenh_bot_execute_internal(uuid,uuid)'),('public.tenh_bot_pending_event_ids(integer)')),
 functions AS (SELECT e.signature,p.oid,p.prosecdef,p.proconfig FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)),
 overloads AS (SELECT p.oid,p.proname,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('tenh_inbox_filter_matches','tenh_inbox_page','tenh_bot_save_rule_set','tenh_bot_record_event','tenh_bot_claim_jobs','tenh_bot_reserve_job','tenh_bot_finish_job','tenh_bot_set_human_hold','tenh_bot_recover_jobs','tenh_bot_execute_internal','tenh_bot_pending_event_ids'))
SELECT jsonb_build_object(
 'database',current_database(),'role',current_user,
 'missing_dependencies',COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM missing),'[]'::jsonb),
 'expected_functions', (SELECT jsonb_agg(jsonb_build_object('signature',f.signature,'exists',f.oid IS NOT NULL,
 'security_definer',f.prosecdef,'settings',f.proconfig,
 'grants',CASE WHEN f.oid IS NULL THEN NULL ELSE (SELECT jsonb_object_agg(r.rolname,has_function_privilege(r.oid,f.oid,'EXECUTE')) FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')) END,
 'public_execute',CASE WHEN f.oid IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=f.oid AND a.grantee=0 AND a.privilege_type='EXECUTE') END) ORDER BY f.signature) FROM functions f),
 'overloads',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',proname,'arguments',pg_get_function_identity_arguments(oid),'returns',pg_get_function_result(oid),'security_definer',prosecdef) ORDER BY proname,oid) FROM overloads),'[]'::jsonb),
 'bot_storage',jsonb_build_object('table','public.tenh_bot_rule_sets','exists',to_regclass('public.tenh_bot_rule_sets') IS NOT NULL,
 'rls',(SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.tenh_bot_rule_sets')),
 'columns',COALESCE((SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='tenh_bot_rule_sets'),'[]'::jsonb)),
 'execution_tables',(SELECT jsonb_agg(jsonb_build_object('name',name,'exists',to_regclass('public.'||name) IS NOT NULL) ORDER BY name) FROM unnest(ARRAY['tenh_bot_execution_controls','tenh_bot_recipient_state','tenh_bot_events','tenh_bot_execution_jobs']) name),
 'notification_constraints',COALESCE((SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid=to_regclass('public.team_notifications') AND contype='c'),'[]'::jsonb),
 'notification_type',(SELECT jsonb_build_object('type',data_type,'udt',udt_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='team_notifications' AND column_name='notification_type'),
 'realtime_tables',COALESCE((SELECT jsonb_agg(pubname||':'||tablename ORDER BY pubname,tablename) FROM pg_publication_tables WHERE schemaname='public' AND tablename IN ('messages','conversations')),'[]'::jsonb)
) AS tenh_release_preflight;
