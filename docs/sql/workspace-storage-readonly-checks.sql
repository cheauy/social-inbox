-- SELECT-only preflight/post-apply checks for Supabase project dvieoqprsmzydtepbxwn.
-- Confirm the SQL editor project before running. This file performs no mutations.

select current_database() as database_name, current_user as inspecting_role;

select to_regclass('public.workspace_files') as workspace_files_table;

select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'workspace_files'
order by ordinal_position;

select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'workspace_files';

-- Expected after apply: service_role has SELECT/INSERT/UPDATE/DELETE;
-- anon/authenticated/PUBLIC have no table privileges.
select role_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'workspace_files'
order by role_name, privilege_type;

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'workspace_files'
order by policyname;

-- Expected after apply: public=false and file_size_limit=20971520.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'tenh-workspace-files';

-- No broad object policy should mention the new bucket.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') ilike '%tenh-workspace-files%'
       or coalesce(with_check, '') ilike '%tenh-workspace-files%')
order by policyname;
