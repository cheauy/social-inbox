-- TENH-CHAT: publish the two core Inbox tables, once, in Supabase SQL Editor.
-- Idempotent. No data, schema columns, grants or RLS policies are changed.
-- Do NOT add social_accounts: it may contain provider credentials.
begin;
do $block$
declare
  target_table text;
  publication_all boolean;
  table_oid regclass;
  rls_enabled boolean;
begin
  select puballtables into publication_all from pg_publication where pubname = 'supabase_realtime';
  if not found then
    raise exception 'The supabase_realtime publication is missing. Enable Supabase Realtime before applying this script.';
  end if;
  foreach target_table in array array['messages', 'conversations'] loop
    table_oid := to_regclass(format('public.%I', target_table));
    if table_oid is null then
      raise exception 'Required Inbox table public.% is missing. No publication changes were applied.', target_table;
    end if;
    select c.relrowsecurity into rls_enabled from pg_class c where c.oid = table_oid;
    if not rls_enabled then
      raise exception 'RLS is disabled on public.%. Review and enable the existing workspace-scoped RLS policies first. This script does not change access policies.', target_table;
    end if;
    if not publication_all and not exists (
      select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end
$block$;
commit;

-- Confirm publication and RLS. SELECT policies must still allow each active
-- owner/agent to read only the workspaces to which that user has access.
select p.tablename, c.relrowsecurity as rls_enabled
from pg_publication_tables p
join pg_class c on c.oid = to_regclass(format('%I.%I', p.schemaname, p.tablename))
where p.pubname = 'supabase_realtime' and p.schemaname = 'public'
  and p.tablename in ('messages', 'conversations')
order by p.tablename;
