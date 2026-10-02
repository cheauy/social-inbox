-- REVIEW BEFORE APPLYING: creates the private, shop-shared attachment library.
-- Customer-scoped customer_files rows and objects are intentionally untouched.
-- Safe code rollback: leave this additive table and private bucket in place.
-- Dropping either is destructive and requires a separate backup/export and approval.
begin;

create table if not exists public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  file_kind text not null check (file_kind in ('image', 'video', 'audio', 'file')),
  storage_bucket text not null check (storage_bucket = 'tenh-workspace-files'),
  storage_path text not null,
  uploaded_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (storage_bucket, storage_path),
  check (storage_path like business_id::text || '/%')
);

create index if not exists workspace_files_business_created_idx
  on public.workspace_files (business_id, created_at desc)
  where deleted_at is null;

alter table public.workspace_files enable row level security;
revoke all on table public.workspace_files from public, anon, authenticated;
grant select, insert, update, delete on table public.workspace_files to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('tenh-workspace-files', 'tenh-workspace-files', false, 20971520)
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1 from storage.buckets
    where id = 'tenh-workspace-files'
      and (public is distinct from false or file_size_limit is distinct from 20971520)
  ) then
    raise exception 'Existing tenh-workspace-files bucket has unexpected privacy or size settings';
  end if;
end $$;

commit;
