-- What a paired browser says about its Facebook companion.
--
-- The device row already carried facebook_connected and composer_state, both of
-- which answer "what is on that tab". Neither can express the state that
-- matters most on the website: no tab is loaded and that is correct, because
-- nothing has needed one. Reported as "not connected", it read like a fault and
-- sent people looking for a problem that did not exist.
--
-- So one column, holding the same word the extension shows its own customer:
-- ready, sleeping, connecting, sign_in_required, error.
--
-- Nothing in TENH reads this to decide whether a message can be sent. It is a
-- status line, and an expired one is stale text rather than a broken Inbox.
--
-- Safe to run twice.

alter table public.extension_devices
  add column if not exists facebook_state text;

alter table public.extension_devices
  add column if not exists keep_companion_active boolean not null default false;

comment on column public.extension_devices.facebook_state is
  'Companion-reported Facebook state: ready | sleeping | connecting | sign_in_required | error. Observation only.';

comment on column public.extension_devices.keep_companion_active is
  'Whether that browser is configured to keep a Facebook tab loaded.';
