-- Storage schema diagnostic: ONE complete read-only SELECT.
-- Paste the entire file into a new SQL tab, then run it.
-- Returns one JSON result; expand/copy storage_diagnostic to share metadata.
-- Catalog metadata and only the tenh-workspace-files bucket metadata.
-- No customer records, object paths, credentials, migration, or mutations.
-- Strict access and pagination need no new SQL.
SELECT jsonb_build_object(
  'tables', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      with required(schema_name, table_name) as (values
        ('public', 'workspace_files'), ('public', 'workspace_file_categories'),
        ('public', 'workspace_file_favorites'), ('public', 'team_members'),
        ('public', 'business_subscriptions'), ('storage', 'buckets'), ('storage', 'objects')
      )
      select r.schema_name, r.table_name, c.oid is not null as exists,
             c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls,
             pg_get_userbyid(c.relowner) as owner
      from required r
      left join pg_namespace n on n.nspname = r.schema_name
      left join pg_class c on c.relnamespace = n.oid and c.relname = r.table_name
      order by r.schema_name, r.table_name
    ) AS report_rows
  ), '[]'::jsonb),
  'columns', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      with expected(table_name, column_name, udt_name, nullable) as (values
        ('workspace_files','id','uuid','NO'), ('workspace_files','business_id','uuid','NO'),
        ('workspace_files','display_name','text','NO'), ('workspace_files','mime_type','text','NO'),
        ('workspace_files','size_bytes','int8','NO'), ('workspace_files','file_kind','text','NO'),
        ('workspace_files','storage_bucket','text','NO'), ('workspace_files','storage_path','text','NO'),
        ('workspace_files','uploaded_by_member_id','uuid','YES'), ('workspace_files','created_at','timestamptz','NO'),
        ('workspace_files','deleted_at','timestamptz','YES'), ('workspace_files','category_id','uuid','YES'),
        ('workspace_file_categories','id','uuid','NO'), ('workspace_file_categories','business_id','uuid','NO'),
        ('workspace_file_categories','name','text','NO'), ('workspace_file_categories','created_at','timestamptz','NO'),
        ('workspace_file_categories','updated_at','timestamptz','NO'),
        ('workspace_file_favorites','member_id','uuid','NO'), ('workspace_file_favorites','file_id','uuid','NO'),
        ('workspace_file_favorites','created_at','timestamptz','NO')
      )
      select e.table_name, e.column_name, e.udt_name as expected_type, c.udt_name as actual_type,
             e.nullable as expected_nullable, c.is_nullable as actual_nullable, c.column_default,
             c.column_name is not null and (e.udt_name, e.nullable) = (c.udt_name, c.is_nullable) as compatible
      from expected e left join information_schema.columns c
        on c.table_schema = 'public' and c.table_name = e.table_name and c.column_name = e.column_name
      order by e.table_name, e.column_name
    ) AS report_rows
  ), '[]'::jsonb),
  'guard_columns', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      select table_name, column_name, udt_name, is_nullable
      from information_schema.columns where table_schema = 'public'
        and ((table_name = 'team_members' and column_name in ('id','user_id','business_id','role','is_active','permissions','created_at'))
          or (table_name = 'business_subscriptions' and column_name in ('business_id','status','current_period_end','trial_ends_at','created_at')))
      order by table_name, ordinal_position
    ) AS report_rows
  ), '[]'::jsonb),
  'constraints', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      select c.relname as table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) as definition
      from pg_constraint con join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('workspace_files','workspace_file_categories','workspace_file_favorites')
      order by c.relname, con.conname
    ) AS report_rows
  ), '[]'::jsonb),
  'indexes', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      select tablename, indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename in ('workspace_files','workspace_file_categories','workspace_file_favorites')
      order by tablename, indexname
    ) AS report_rows
  ), '[]'::jsonb),
  'table_acl', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      select c.relname as table_name,
             case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
             acl.privilege_type, acl.is_grantable
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
      where n.nspname = 'public' and c.relname in ('workspace_files','workspace_file_categories','workspace_file_favorites')
      order by c.relname, grantee, acl.privilege_type
    ) AS report_rows
  ), '[]'::jsonb),
  'effective_role_privileges', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      with roles as (select oid, rolname, rolbypassrls from pg_roles where rolname in ('service_role','anon','authenticated')),
      tables as (select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname in ('workspace_files','workspace_file_categories','workspace_file_favorites'))
      select r.rolname, r.rolbypassrls, t.relname,
             has_table_privilege(r.oid,t.oid,'SELECT') as can_select,
             has_table_privilege(r.oid,t.oid,'INSERT') as can_insert,
             has_table_privilege(r.oid,t.oid,'UPDATE') as can_update,
             has_table_privilege(r.oid,t.oid,'DELETE') as can_delete,
             has_table_privilege(r.oid,t.oid,'TRUNCATE') as can_truncate,
             has_table_privilege(r.oid,t.oid,'REFERENCES') as can_reference,
             has_table_privilege(r.oid,t.oid,'TRIGGER') as can_trigger
      from roles r cross join tables t order by r.rolname, t.relname
    ) AS report_rows
  ), '[]'::jsonb),
  'policies', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
      where (schemaname = 'public' and tablename in ('workspace_files','workspace_file_categories','workspace_file_favorites'))
         or (schemaname = 'storage' and tablename = 'objects')
      order by schemaname, tablename, policyname
    ) AS report_rows
  ), '[]'::jsonb),
  'bucket', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      select id, name, public, file_size_limit, allowed_mime_types
      from storage.buckets where id = 'tenh-workspace-files'
    ) AS report_rows
  ), '[]'::jsonb),
  'storage_objects_acl', COALESCE((
    SELECT jsonb_agg(to_jsonb(report_rows))
    FROM (
      select case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
             acl.privilege_type, acl.is_grantable
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
      where n.nspname = 'storage' and c.relname = 'objects'
      order by grantee, acl.privilege_type
    ) AS report_rows
  ), '[]'::jsonb)
) AS storage_diagnostic;
