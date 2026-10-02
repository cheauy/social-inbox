-- REVIEW BEFORE APPLYING: additive organization for shared workspace Storage.
-- Favorites belong to one workspace membership (team_members.id), matching
-- TENH's existing per-workspace user preference boundary.
-- File deletion remains a soft delete; category deletion only unassigns files.
-- Rollout order: apply this expansion, run the read-only review checks, then
-- deploy the compatible application code. Old application readers ignore all
-- three additions, so code rollback can safely leave this migration in place.
begin;

create table if not exists public.workspace_file_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create unique index if not exists workspace_file_categories_business_name_idx
  on public.workspace_file_categories (business_id, lower(name));

alter table public.workspace_files
  add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_files_category_id_fkey'
      and conrelid = 'public.workspace_files'::regclass
  ) then
    alter table public.workspace_files
      add constraint workspace_files_category_id_fkey
      foreign key (category_id)
      references public.workspace_file_categories(id)
      on delete set null;
  end if;
end $$;

create index if not exists workspace_files_business_category_created_idx
  on public.workspace_files (business_id, category_id, created_at desc)
  where deleted_at is null;

create table if not exists public.workspace_file_favorites (
  member_id uuid not null references public.team_members(id) on delete cascade,
  file_id uuid not null references public.workspace_files(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (member_id, file_id)
);

alter table public.workspace_file_categories enable row level security;
alter table public.workspace_file_favorites enable row level security;
revoke all on table public.workspace_file_categories, public.workspace_file_favorites
  from public, anon, authenticated;
revoke all privileges on table public.workspace_file_categories, public.workspace_file_favorites
  from service_role;
grant select, insert, update, delete
  on table public.workspace_file_categories, public.workspace_file_favorites
  to service_role;

commit;
