-- FOLLOW-UP FOR 20261008_workspace_storage.sql.
-- Default privileges on the table creator may have granted service_role more
-- than the intended CRUD access when workspace_files was created.
-- This changes only service_role's direct privileges on this one new table.
begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

revoke all privileges on table public.workspace_files from service_role;
grant select, insert, update, delete on table public.workspace_files to service_role;

commit;
