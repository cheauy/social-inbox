#!/usr/bin/env bash
# Runs the Telegram Personal draft SQL tests against a SCRATCH Postgres server.
# Usage: PGHOST=... PGPORT=... PGUSER=... tests/sql/run-telegram-personal-sql.sh
# Creates and drops throwaway databases tgp_test_*; never point this at TENH.
set -euo pipefail
cd "$(dirname "$0")/../.."
db=tgp_test_$$
dropdb --if-exists "$db" >/dev/null
createdb "$db"
trap 'for d in "$db" "${db}_guard" "${db}_d1" "${db}_split"; do dropdb --if-exists "$d" >/dev/null 2>&1 || true; done' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$db" -f tests/sql/telegram-personal-stub-schema.sql
psql -q -v ON_ERROR_STOP=1 -d "$db" -f db/proposals/20261020_telegram_personal_draft.sql
psql -q -v ON_ERROR_STOP=1 -d "$db" -f db/proposals/20261020_telegram_personal_draft.sql 2>/dev/null # idempotent
psql -q -v ON_ERROR_STOP=1 -d "$db" -f tests/sql/telegram-personal-draft.test.sql | grep -q 'all assertions passed'
echo "PASS assertions"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f db/proposals/20261021_telegram_personal_d1.sql
psql -q -v ON_ERROR_STOP=1 -d "$db" -f db/proposals/20261021_telegram_personal_d1.sql 2>/dev/null # idempotent
dropdb --if-exists "${db}_d1" >/dev/null; createdb "${db}_d1"
psql -q -v ON_ERROR_STOP=1 -d "${db}_d1" -f tests/sql/telegram-personal-stub-schema.sql
psql -q -v ON_ERROR_STOP=1 -d "${db}_d1" -f db/proposals/20261020_telegram_personal_draft.sql
psql -q -v ON_ERROR_STOP=1 -d "${db}_d1" -f db/proposals/20261021_telegram_personal_d1.sql
psql -q -v ON_ERROR_STOP=1 -d "${db}_d1" -f tests/sql/telegram-personal-d1.test.sql | grep -q 'all assertions passed'
echo "PASS D1 assertions"
# Both files must also survive an editor that splits on statements.
for f in db/proposals/20261020_telegram_personal_draft.sql db/proposals/20261021_telegram_personal_d1.sql; do
  chunks="$(mktemp -d)"
  python3 tests/sql/tools/split-like-editor.py "$f" "$chunks" >/dev/null
  dropdb --if-exists "${db}_split" >/dev/null; createdb "${db}_split"
  psql -q -d "${db}_split" -f tests/sql/telegram-personal-stub-schema.sql
  [ "$f" = db/proposals/20261021_telegram_personal_d1.sql ] && psql -q -d "${db}_split" -f db/proposals/20261020_telegram_personal_draft.sql
  cat "$chunks"/*.sql | psql -q -v ON_ERROR_STOP=1 -d "${db}_split" >/dev/null
  rm -rf "$chunks"
  echo "PASS statement-split install: $f"
done

# Concurrency: two workspaces activate the same Telegram account at once.
psql -q -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
insert into businesses(id) values ('00000000-0000-0000-0000-0000000000e1'),('00000000-0000-0000-0000-0000000000e2');
insert into team_members(id,business_id,user_id,role) values
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','owner'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d2','owner');
select tgp_begin_login('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000f1','qr');
select tgp_begin_login('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000f2','qr');
select count(*) from tgp_claim_sessions('race-worker', 120, 50);
SQL
activate() {
  psql -qtA -v ON_ERROR_STOP=1 -d "$db" -c "begin; select tgp_activate(id,'race-worker',lease_epoch,'9990001','Racer','racer','+0')->>'code' from telegram_personal_sessions where business_id='$1'; select pg_sleep(1.5); commit;" | head -1
}
activate 00000000-0000-0000-0000-0000000000e1 > /tmp/tgp_race_1.$$ &
activate 00000000-0000-0000-0000-0000000000e2 > /tmp/tgp_race_2.$$ &
wait
results="$(cat /tmp/tgp_race_1.$$ /tmp/tgp_race_2.$$ | sort | tr '\n' ' ')"
rm -f /tmp/tgp_race_1.$$ /tmp/tgp_race_2.$$
live="$(psql -qtA -d "$db" -c "select count(*) from telegram_personal_sessions where telegram_user_id='9990001' and status='connected'")"
echo "race results: [$results] live=$live"
[ "$live" = "1" ] && echo "$results" | grep -q "ACCOUNT_IN_OTHER_WORKSPACE" && echo "PASS concurrent duplicate ownership"

# The live platform CHECK is extended; an unexpected one stops the install.
psql -qtA -d "$db" -c "select pg_get_constraintdef(oid) from pg_constraint where conname='social_accounts_platform_check'" | grep -q telegram_personal \
  && echo "PASS live platform constraint extended"
createdb "${db}_guard"
psql -q -d "${db}_guard" -f tests/sql/telegram-personal-stub-schema.sql
psql -q -d "${db}_guard" -c "alter table social_accounts drop constraint social_accounts_platform_check, add constraint social_accounts_platform_check check (platform in ('facebook','telegram','instagram'))"
if psql -q -v ON_ERROR_STOP=1 -d "${db}_guard" -f db/proposals/20261020_telegram_personal_draft.sql >/dev/null 2>&1; then
  echo "FAIL guard"; exit 1
fi
[ -z "$(psql -qtA -d "${db}_guard" -c "select to_regclass('public.telegram_personal_sessions')")" ] && echo "PASS install guard on unexpected constraint (nothing created)"
