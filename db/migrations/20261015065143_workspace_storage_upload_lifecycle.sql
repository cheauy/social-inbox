-- Forward expansion only. Apply after the 20261009 organization migration, before code.
-- Service-only: upload capabilities never authorize metadata insertion themselves.
begin;

create table public.workspace_storage_uploads (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  storage_path text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  file_kind text not null check (file_kind in ('image', 'video', 'audio', 'file')),
  -- Retain the expected category even if it is deleted during an interrupted upload.
  category_id uuid,
  state text not null default 'prepared' check (state in ('prepared', 'finalized')),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  created_at timestamptz not null default clock_timestamp(),
  check (storage_path like business_id::text || '/%')
);
alter table public.workspace_storage_uploads enable row level security;
revoke all on public.workspace_storage_uploads from public, anon, authenticated;
grant select, insert, update on public.workspace_storage_uploads to service_role;

-- No Storage HTTP request runs while this row lock is held. Finalization cannot
-- race itself; errors roll back the insert and lifecycle transition together.
create function public.finalize_workspace_storage_upload(
  p_upload_id uuid, p_business_id uuid, p_member_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  attempt public.workspace_storage_uploads%rowtype;
  registered public.workspace_files%rowtype;
begin
  select * into attempt from public.workspace_storage_uploads
  where id = p_upload_id and business_id = p_business_id and member_id = p_member_id
  for update;
  if not found then raise exception 'Prepared upload was not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.team_members where id = p_member_id
      and business_id = p_business_id and is_active) then
    raise exception 'Membership was revoked' using errcode = '42501';
  end if;
  if attempt.state = 'finalized' then
    select * into registered from public.workspace_files where id = attempt.id
      and business_id = p_business_id and storage_path = attempt.storage_path
      and uploaded_by_member_id = p_member_id and deleted_at is null;
    if not found then raise exception 'Finalized file is no longer available' using errcode = 'P0002'; end if;
    return to_jsonb(registered);
  end if;
  if attempt.expires_at <= clock_timestamp() then
    raise exception 'Prepared upload expired' using errcode = '22023';
  end if;
  if attempt.category_id is not null and not exists (
    select 1 from public.workspace_file_categories where id = attempt.category_id and business_id = p_business_id
  ) then raise exception 'Prepared category is no longer available' using errcode = '22023'; end if;
  insert into public.workspace_files (
    id, business_id, display_name, mime_type, size_bytes, file_kind,
    storage_bucket, storage_path, uploaded_by_member_id, category_id
  ) values (
    attempt.id, attempt.business_id, attempt.display_name, attempt.mime_type,
    attempt.size_bytes, attempt.file_kind, 'tenh-workspace-files', attempt.storage_path,
    attempt.member_id, attempt.category_id
  ) returning * into registered;
  update public.workspace_storage_uploads set state = 'finalized' where id = attempt.id;
  return to_jsonb(registered);
end;
$$;
revoke all on function public.finalize_workspace_storage_upload(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_workspace_storage_upload(uuid, uuid, uuid) to service_role;

create index workspace_files_business_cursor_idx
  on public.workspace_files (business_id, created_at desc, id desc) where deleted_at is null;
create index workspace_files_business_pending_idx
  on public.workspace_files (business_id, deleted_at, id) where deleted_at is not null;
commit;
