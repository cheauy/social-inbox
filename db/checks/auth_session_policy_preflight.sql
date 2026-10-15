-- READ ONLY: run by a reviewer against a staging/local database before activation.
-- No credentials, JWTs, emails, or provider sessions are returned.
-- Required Auth columns are based on current upstream supabase/auth
-- internal/models/user.go and documented auth.sessions; verify deployed schema
-- compatibility using the standalone information_schema query below before
-- applying the migration; other queries require preparation first.
-- No hosted schema was read.
--
-- Rollout ordering:
-- 1. Apply the preparatory migration in a reviewed deployment. Existing bound
--    rows enforce expiry/revocation immediately; unknown sessions are explicitly
--    legacy while enforcement_enabled=false. This is NOT full direct enforcement.
-- 2. Ship server-controlled login/binding for EVERY client, including native CHAT.
--    Current mobile/app/sign-in.tsx and mobile/lib/auth/oauth.ts authenticate
--    directly with Supabase and do not register policies. Never enable the cutoff
--    until those paths are supported or their loss of access is explicitly reviewed.
-- 3. Review all results below. Inspect exact function bodies and grants, including
--    overloads, and all RLS-disabled tables, views, exposed custom schemas, buckets,
--    edge functions, direct DB clients and service-role API handlers. Keep existing
--    tenant/role checks. Future tables require the restrictive policy too.
-- 4. Determine effective PostgREST db-pre-request configuration from BOTH database
--    role settings and server/API configuration. Do not overwrite an existing hook.
--    Chain it in an explicitly reviewed function with the session check first.
--    The preparation migration only defines public.tenh_auth_pre_request(); it
--    deliberately performs no ALTER ROLE/DATABASE or PostgREST configuration reload.
--    Once installed, test the hook through REST: tables, owner/invoker views, every
--    SECURITY DEFINER RPC, service-role webhooks/jobs and anonymous public reads.
--    Do not grant access to a wrapper's original unguarded function as a workaround.
-- 5. Review Storage objects RLS and test auth-based upload/read operations. Public
--    buckets and previously issued signed URLs remain public/bearer capabilities;
--    their delivery does not recheck this registry. Existing app-issued signed
--    read/download workspace URLs use 300 or 600 seconds. Signed upload URLs have
--    a separate provider-controlled lifetime (official createSignedUploadUrl docs
--    describe two hours); deployed delivery behavior has not been tested here.
--    Clamp new issuance where practical.
-- 6. Private Realtime Presence/Broadcast authorization is evaluated/cached on join.
--    Existing channels do not promise instantaneous ledger revocation. PostgreSQL
--    Changes uses table RLS for deliveries, but prove the deployed behavior.
--    Client disconnect timers are UX only. To bound active-channel lifetime review
--    an Auth access-token hook clamping exp to min(provider_exp, ledger_expires_at)
--    and denying expired/revoked/unbound sessions on refresh; this is not installed
--    here. JWTs already issued are not retroactively revoked by cookie deletion.
--    The provider Auth /user password-update API is also outside application
--    PostgREST/RLS enforcement. Provider secure-password-change/recent-auth settings
--    and recovery behavior have NOT been inspected or changed by this patch.
--    Review/test those settings before claiming direct Auth password-write closure.
--    The app recovery reset consumes a service-only ledger claim exactly once;
--    a failed provider update after claiming requires a new recovery link.
--    App password creation/update baseline is 8..128 characters, at least one
--    ASCII letter and digit, plus matching confirmation. Provider minimum length,
--    character/leaked-password rules, secure-change configuration, email templates,
--    OTP and link expiry remain uninspected. Do not present this local baseline
--    or public documented defaults as the actual hosted provider configuration.
-- 7. With all surfaces tested and stakeholder approval recorded, activate a finite
--    legacy cutoff/grace using the PRIVATE settings table in a separate reviewed
--    transaction. Choose a trusted DB-clock cutoff after all supported clients ship;
--    set legacy_created_before once, legacy_grace_until to a specific timestamp
--    <= cutoff+30 days, and enforcement_enabled=true. Never recompute the deadline
--    Record the reviewed native plan/approval reference in native_rollout_approval;
--    the settings constraint blocks activation without that explicit reference.
--    on page loads/refresh or silently extend it. Unknown sessions created at/after
--    cutoff must fail immediately; earlier unknown sessions expire at the deadline.
--    Reauthentication binds a new provider session; never register an old session.
-- 8. Rollback uses a separate reviewed change. Disabling unknown-session enforcement
--    must never clear bound revocation/expiry rows. Retain registry tombstones at
--    least until no corresponding provider session/access JWT can be presented.
--
-- This file is evidence collection, not a claim that deployed functions/settings
-- have been inspected. No hosted query is performed by the application or tests.

select enforcement_enabled,legacy_created_before,legacy_grace_until,
  nullif(btrim(native_rollout_approval),'') is not null as native_plan_approval_recorded
from tenh_auth_private.session_settings where singleton;

select required.table_name,required.column_name,columns.data_type,
  columns.column_name is not null as available
from (values ('users','id'),('users','email_confirmed_at'),('users','banned_until'),
  ('users','deleted_at'),('sessions','id'),('sessions','user_id'),
  ('sessions','created_at'),('sessions','not_after')) required(table_name,column_name)
left join information_schema.columns columns on columns.table_schema='auth'
  and columns.table_name=required.table_name and columns.column_name=required.column_name
order by required.table_name,required.column_name;

select n.nspname as schema_name,c.relname as relation_name,c.relkind,
  c.relrowsecurity as rls_enabled,
  exists(select 1 from pg_policy p where p.polrelid=c.oid
    and p.polname='tenh_session_policy_guard' and not p.polpermissive) as session_guard,
  has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')
  and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
order by n.nspname,c.relname;

select n.nspname as schema_name,c.relname as view_name,c.relkind,
  c.reloptions,pg_get_userbyid(c.relowner) as owner,
  has_table_privilege('anon',c.oid,'SELECT') as anon_read,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('v','m') and n.nspname not in ('pg_catalog','information_schema')
  and (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT'))
order by n.nspname,c.relname;

select n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  md5(pg_get_functiondef(p.oid)) as definition_md5
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prokind='f' and n.nspname not in ('pg_catalog','information_schema')
  and p.prosecdef and (has_function_privilege('anon',p.oid,'EXECUTE')
    or has_function_privilege('authenticated',p.oid,'EXECUTE'))
order by n.nspname,p.proname,identity_arguments;

select coalesce(d.datname,'ALL DATABASES') as database_name,
  coalesce(r.rolname,'ALL ROLES') as role_name,setting
from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase
left join pg_roles r on r.oid=s.setrole
cross join lateral unnest(s.setconfig) setting
where setting like 'pgrst.db_pre_request=%' or setting like 'pgrst.db_schemas=%'
order by database_name,role_name,setting;

select id as bucket_id,public as publicly_readable from storage.buckets order by id;
