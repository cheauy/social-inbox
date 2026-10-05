-- SELECT-only preflight/post-apply checks for Supabase project dvieoqprsmzydtepbxwn.
-- Confirm the SQL editor project before running. This file performs no mutations.

select current_database() as database_name, current_user as inspecting_role;

select to_regclass('public.businesses') as businesses_table,
       to_regclass('public.team_members') as team_members_table,
       to_regclass('public.workspace_files') as workspace_files_table;

-- Prerequisite keys must both exist as UUID before applying the migration.
with expected(table_name, column_name, udt_name) as (
  values ('businesses', 'id', 'uuid'), ('team_members', 'id', 'uuid')
)
select e.table_name, e.column_name, e.udt_name as expected_type,
       c.udt_name as actual_type,
       c.udt_name = e.udt_name as compatible
from expected e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = e.table_name
 and c.column_name = e.column_name
order by e.table_name;

-- Before apply, workspace_files should be absent. If it already exists, this
-- reports every missing, unexpected or type/nullability-incompatible column.
with expected(column_name, udt_name, is_nullable) as (
  values
    ('id', 'uuid', 'NO'),
    ('business_id', 'uuid', 'NO'),
    ('display_name', 'text', 'NO'),
    ('mime_type', 'text', 'NO'),
    ('size_bytes', 'int8', 'NO'),
    ('file_kind', 'text', 'NO'),
    ('storage_bucket', 'text', 'NO'),
    ('storage_path', 'text', 'NO'),
    ('uploaded_by_member_id', 'uuid', 'YES'),
    ('created_at', 'timestamptz', 'NO'),
    ('deleted_at', 'timestamptz', 'YES')
), actual as (
  select column_name, udt_name, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'workspace_files'
)
select coalesce(e.column_name, a.column_name) as column_name,
       e.udt_name as expected_type, a.udt_name as actual_type,
       e.is_nullable as expected_nullable, a.is_nullable as actual_nullable,
       case
         when e.column_name is null then 'unexpected column'
         when a.column_name is null then 'missing column'
         when (e.udt_name, e.is_nullable) is distinct from
              (a.udt_name, a.is_nullable) then 'incompatible definition'
         else 'compatible'
       end as status
from expected e
full join actual a using (column_name)
order by column_name;

-- Inspect defaults, checks, unique keys and foreign keys exactly if the table exists.
select c.column_name, c.column_default
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'workspace_files'
order by c.ordinal_position;

select con.conname, con.contype, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
where con.conrelid = to_regclass('public.workspace_files')
order by con.conname;

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'workspace_files'
order by indexname;

select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'workspace_files';

-- Expected after apply: service_role has SELECT/INSERT/UPDATE/DELETE;
-- anon/authenticated/PUBLIC have no table privileges.
select grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'workspace_files'
order by grantee, privilege_type;

-- Include effective ACL defaults and PUBLIC explicitly, which the
-- information_schema view may not expose to every inspecting role.
select case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
       acl.privilege_type, acl.is_grantable
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
where n.nspname = 'public' and c.relname = 'workspace_files'
order by grantee, acl.privilege_type;

-- Effective service_role privileges after the follow-up migration must match
-- this matrix. has_table_privilege also detects access inherited via roles.
with expected(privilege_type, expected) as (
  values
    ('SELECT', true), ('INSERT', true), ('UPDATE', true), ('DELETE', true),
    ('TRUNCATE', false), ('REFERENCES', false), ('TRIGGER', false),
    ('MAINTAIN', false)
)
select e.privilege_type, e.expected,
       has_table_privilege(
         'service_role', 'public.workspace_files', e.privilege_type
       ) as actual
from expected e
order by e.privilege_type;

-- No direct table policies are expected; server routes authenticate an active
-- member and use service_role with an explicit business_id filter.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'workspace_files'
order by policyname;

-- Expected after apply: public=false and file_size_limit=20971520.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'tenh-workspace-files';

-- Inventory EVERY storage.objects policy, including generic policies whose
-- expressions do not name this bucket. Review authenticated/anon/PUBLIC roles
-- and any unrestricted USING/WITH CHECK expression before release.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- Inventory storage.objects table privileges as a second broad-access check.
select case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
       acl.privilege_type, acl.is_grantable
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
where n.nspname = 'storage' and c.relname = 'objects'
order by grantee, acl.privilege_type;
