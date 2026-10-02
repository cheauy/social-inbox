-- READ-ONLY verification for 20261009_workspace_storage_organization.sql.
-- Expected: all booleans true and both mismatch counts zero.
select
  to_regclass('public.workspace_file_categories') is not null as categories_exists,
  to_regclass('public.workspace_file_favorites') is not null as favorites_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspace_files' and column_name = 'category_id'
  ) as file_category_exists;

select count(*) as cross_workspace_category_mismatches
from public.workspace_files f
join public.workspace_file_categories c on c.id = f.category_id
where c.business_id <> f.business_id;

select count(*) as cross_workspace_favorite_mismatches
from public.workspace_file_favorites favorite
join public.team_members member on member.id = favorite.member_id
join public.workspace_files file on file.id = favorite.file_id
where member.business_id <> file.business_id;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('workspace_file_categories', 'workspace_file_favorites')
order by table_name, grantee, privilege_type;

-- ROLLBACK NOTES (do not execute as part of verification):
-- 1. Preferred application rollback: roll code back and leave these additive
--    tables/column in place. Old readers ignore them and no file bytes are lost.
-- 2. Before a later schema rollback, export both organization tables and
--    workspace_files.category_id. Restore every wanted Trash row through the
--    supported UI first; older code cannot expose Trash.
-- 3. Only after code rollback and separate destructive approval:
-- begin;
-- drop table public.workspace_file_favorites;
-- alter table public.workspace_files drop constraint workspace_files_category_id_fkey;
-- alter table public.workspace_files drop column category_id;
-- drop table public.workspace_file_categories;
-- commit;
