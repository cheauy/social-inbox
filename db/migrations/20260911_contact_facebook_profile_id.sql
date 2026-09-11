-- Public Facebook profile IDs are distinct from Messenger Page-scoped IDs.
-- Never backfill this column from platform_user_id.
alter table public.contacts
  add column if not exists facebook_profile_id text
  check (facebook_profile_id is null or facebook_profile_id ~ '^[0-9]{1,30}$');

comment on column public.contacts.facebook_profile_id is
  'Known public Facebook profile ID. platform_user_id remains the messaging identifier.';

notify pgrst, 'reload schema';
