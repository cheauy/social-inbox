-- Trigram index for Inbox message search.
--
-- /api/inbox/search-messages runs
--   message_text ilike '%<query>%'
-- which Postgres can only answer with a sequential scan. Measured on this
-- database at 4,272 messages: 8.6ms, and every row read. That is fine now and
-- stops being fine somewhere around ten times the size, because the cost grows
-- with the whole table rather than with the number of matches.
--
-- A GIN trigram index is the one that helps here. A btree cannot serve a
-- pattern that starts with a wildcard, and full text search would tokenise on
-- word boundaries -- which does not work for Khmer, where this inbox does much
-- of its business, and would not match a phone number in the middle of a
-- sentence either. Trigrams match substrings in any script.
--
-- CONCURRENTLY so the messages table keeps taking webhook writes while the
-- index builds. It cannot run inside a transaction block, so run this on its
-- own, not wrapped in BEGIN/COMMIT and not alongside other statements.
--
-- Safe to re-run: IF NOT EXISTS. If a previous attempt was interrupted, check
-- for an invalid index first and drop it, since CONCURRENTLY leaves one behind
-- on failure:
--
--   select indexrelid::regclass from pg_index
--   where not indisvalid and indrelid = 'public.messages'::regclass;

create index concurrently if not exists messages_message_text_trgm_idx
  on public.messages
  using gin (message_text public.gin_trgm_ops);

-- pg_trgm is already installed on this project (1.6, in the public schema).
-- On a database where it is not:
--   create extension if not exists pg_trgm;
