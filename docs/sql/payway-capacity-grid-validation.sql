-- Run in an isolated PostgreSQL database AFTER installing draft 20261012.
-- Expected: zero mismatches across all 2,800 published capacity combinations.
select count(*) as pricing_mismatches
from generate_series(3,30) c
cross join generate_series(1,100) u
where public.tenh_custom_monthly_cents(c,u) is distinct from least(
  1300+greatest(0,c-3)*400+greatest(0,u-1)*300,
  2500+greatest(0,c-5)*400+greatest(0,u-3)*300,
  5900+greatest(0,c-12)*400+greatest(0,u-8)*300);
select public.tenh_custom_monthly_cents(11,8) = 5900 as eleven_connections_eight_users;
-- Rollback pricing ONLY after pausing new checkout creation and draining pending
-- payments priced with the aligned function: restore the exact definition in
-- .codex/payway-original-capacity-pricing.sql. Do not rewrite saved payments.
