-- Existing TENH Supabase database only. No replacement data store.
-- Does not change Messenger PSIDs, messages, memberships or old pin/block tables.
alter table public.contacts add column if not exists facebook_profile_url text;
alter table public.contacts add column if not exists facebook_profile_id text;

-- Idempotency receipts for online sticker sends. Service role only; the API
-- authenticates workspace/member/conversation before every read and write.
create table if not exists public.facebook_sticker_sends (
  business_id uuid not null,
  request_id uuid not null,
  conversation_id uuid not null,
  member_id uuid not null,
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending','completed','rejected','uncertain')),
  result jsonb,
  http_status integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, request_id)
);
alter table public.facebook_sticker_sends enable row level security;
revoke all on public.facebook_sticker_sends from anon, authenticated;
grant all on public.facebook_sticker_sends to service_role;
comment on table public.facebook_sticker_sends is 'Server-only receipts prevent repeated or uncertain online sticker sends being dispatched twice.';
notify pgrst, 'reload schema';
