#!/usr/bin/env python3
"""Targeted native release/closure races; synthetic disposable database only."""
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native_payway', ROOT / 'native-payway-concurrency.py')
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)


def run(options):
    if options.reviewed_private_functions_sql:
        raise ValueError('This targeted synthetic release harness accepts no production overlay.')
    control = n.Session(options)
    checks = []
    try:
        core = ROOT / 'fixtures' / 'payway-legacy-coexistence-core.sql'
        control.sql('begin;\n' + (ROOT / 'native-payway-fixture.sql').read_text() + '\n' + core.read_text() + '\n' + (ROOT / 'native-payway-models.sql').read_text() + '''
create schema auth; create table auth.users(id uuid primary key);
alter table team_members add primary key(id);
alter table businesses add primary key(id);
alter table team_members add foreign key(user_id) references auth.users(id) on delete set null;
alter table team_members add foreign key(business_id) references businesses(id) on delete cascade;
alter table billing_transactions add foreign key(requested_by_member_id) references team_members(id) on delete set null;
alter table billing_transactions add foreign key(business_id) references businesses(id) on delete cascade;
commit;''')
        before_deadlocks = int(control.sql('select deadlocks from pg_stat_database where datname=current_database();')[-1])

        def fixture():
            workspace = n.business(control)
            user, member = str(uuid.uuid4()), str(uuid.uuid4())
            row = n.payment(workspace)
            control.sql('insert into businesses values(' + n.q(workspace) + ",'Synthetic'); insert into auth.users values(" + n.q(user) + '); insert into team_members(id,user_id,business_id,role,is_active) values(' + ','.join(map(n.q, [member, user, workspace])) + ",'owner',false);")
            n.history(control, row)
            control.sql("set session_replication_role='replica'; update billing_transactions set requested_by_member_id=" + n.q(member) + '::uuid where id=' + n.q(row['id']) + "::uuid; set session_replication_role='origin';")
            control.sql("insert into tenh_billing_private.legacy_payway_enrollments select b.id,b.provider_transaction_id,b.business_id,tenh_compat_payment_identity(to_jsonb(b)),tenh_compat_subscription_identity(to_jsonb(s)),'review',false,'UNKNOWN','synthetic release review',clock_timestamp() from billing_transactions b join business_subscriptions s on s.business_id=b.business_id where b.id=" + n.q(row['id']) + '::uuid;')
            snapshot = control.value('select tenh_billing_private.account_deletion_snapshot(' + n.q(user) + '::uuid);')
            reviews = [dict(source_payment_id=p['source_payment_id'], identity_fingerprint=p['identity_fingerprint'], payment_status=p['status'], review_disposition='retain_unresolved_recovery', evidence_kind='authoritative_operator_case_review', evidence_reference='synthetic case', evidence_sha256='a' * 64, authorizes_account_unlink_only=True, preserves_financial_history=True) for p in snapshot['payments']]
            return workspace, user, row, reviews

        def release(user, reviews, reference):
            return 'select tenh_billing_private.release_account_deletion(' + ','.join([n.q(user) + '::uuid', n.q(reference), "'synthetic operator'", n.q(json.dumps(reviews)) + '::jsonb', "'preserve_member_reference_redact_member_profile'"]) + ');'

        def pair(fn):
            a, b = n.Session(options), n.Session(options)
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    fn(a, b, pool)
            finally:
                a.close(); b.close()

        def identical(a, b, pool):
            workspace, user, row, reviews = fixture()
            before = n.snapshot(control, workspace)
            first = a.value('begin; ' + release(user, reviews, 'same-reference'))
            future = pool.submit(b.sql, 'begin; ' + release(user, reviews, 'same-reference'))
            n.waiting(control, b, a); a.sql('commit;')
            second = json.loads(future.result(timeout=23)[-1]); b.sql('commit;')
            assert first['release_id'] == second['release_id'] and second['already_released'] is True
            assert n.snapshot(control, workspace) == before
        pair(identical); checks.append('concurrent identical release waits, then returns the same immutable grant')

        def new_pending(a, b, pool):
            workspace, user, row, reviews = fixture()
            a.sql('begin; select 1 from business_subscriptions where business_id=' + n.q(workspace) + '::uuid for update;')
            future = pool.submit(b.sql, 'begin; ' + release(user, reviews, 'pending-race'))
            n.waiting(control, b, a)
            # Inject an already-existing competing purchase under the fixture role;
            # normal creation correctly rejects this retained-pending workspace.
            a.sql("set local session_replication_role='replica'; " + n.creation(n.payment(workspace, 'manual')) + ' commit;')
            n.expect_error(future, 'P0001')
            assert control.value('select tenh_get_account_deletion_billing_hold(' + n.q(user) + '::uuid);')['held'] is True
        pair(new_pending); checks.append('release waiting for subscription lock sees newly committed unresolved purchase and rejects')

        def creator_after(a, b, pool):
            workspace, user, row, reviews = fixture()
            a.sql('begin; ' + release(user, reviews, 'creator-after-release'))
            future = pool.submit(b.sql, 'begin; ' + n.creation(n.payment(workspace)))
            n.waiting(control, b, a); a.sql('commit;'); n.expect_error(future, '23505')
            assert len(n.snapshot(control, workspace)['payway']) == 1
        pair(creator_after); checks.append('normal new creator waits for release then remains blocked by retained pending payment')

        for field in ["status='cancelled'", "status='expired'", "status='past_due'", 'current_period_end=null', "current_period_end=current_period_end-interval '1 day'"]:
            def closure(a, b, pool):
                workspace, user, row, reviews = fixture()
                before = n.snapshot(control, workspace)
                a.sql('begin; ' + release(user, reviews, 'closure-' + uuid.uuid4().hex))
                future = pool.submit(b.sql, 'begin; update business_subscriptions set ' + field + ' where business_id=' + n.q(workspace) + '::uuid;')
                n.waiting(control, b, a); a.sql('commit;'); n.expect_error(future, 'P0001')
                assert n.snapshot(control, workspace) == before
            pair(closure); checks.append('closure waits for release but cannot remove unresolved paid access: ' + field)

        def unlink(a, b, pool):
            workspace, user, row, reviews = fixture()
            before = n.snapshot(control, workspace)
            grant = a.value('begin; ' + release(user, reviews, 'unlink-race'))
            future = pool.submit(b.sql, 'begin; ' + release(user, reviews, 'unlink-race'))
            n.waiting(control, b, a)
            a.sql('delete from auth.users where id=' + n.q(user) + '::uuid; commit;')
            replay = json.loads(future.result(timeout=23)[-1]); b.sql('commit;')
            assert replay['release_id'] == grant['release_id'] and replay['already_released'] is True and replay['currently_effective'] is False
            assert n.snapshot(control, workspace) == before
            assert control.value('select to_jsonb(count(*)) from tenh_billing_private.account_deletion_releases where user_id=' + n.q(user) + '::uuid;') == 1
        pair(unlink); checks.append('Auth SET NULL during committed release retains requester/financial history and exact replay audit')
        after_deadlocks = int(control.sql('select deadlocks from pg_stat_database where datname=current_database();')[-1])
        assert after_deadlocks == before_deadlocks
        print(json.dumps(dict(native_postgresql=True, activation_bodies='synthetic models only', core_sha256=hashlib.sha256(core.read_bytes()).hexdigest(), checks_passed=len(checks), checks=checks, deadlock_delta=after_deadlocks-before_deadlocks), indent=2))
    finally:
        control.close()


if __name__ == '__main__':
    n.run = run
    n.main()
