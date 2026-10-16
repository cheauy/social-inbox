-- Narrow only the two reviewed payment tables; retain rows, RLS and owner-backed RPCs.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
revoke all on table public.bakong_payment_attempts, public.manual_payment_uploads from service_role;
grant select on table public.bakong_payment_attempts to service_role;
grant select, insert, update on table public.manual_payment_uploads to service_role;
commit;
