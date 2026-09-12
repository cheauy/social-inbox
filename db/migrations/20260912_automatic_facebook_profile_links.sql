-- Safe to run when either/both columns already exist. No existing IDs change.
-- Public profile links come from verified Facebook UI links, never from PSIDs.
alter table public.contacts
  add column if not exists facebook_profile_id text
    check (facebook_profile_id is null or facebook_profile_id ~ '^[0-9]{1,30}$'),
  add column if not exists facebook_profile_url text;

comment on column public.contacts.facebook_profile_url is
  'Verified public Facebook profile URL. Messenger platform_user_id is never used as a public profile URL.';

notify pgrst, 'reload schema';
