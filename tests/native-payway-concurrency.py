#!/usr/bin/env python3
"""Native psql sessions, synthetic DB only; no Python packages or provider calls.

This tests the exact compatibility core with labelled activation models.
It is NOT proof that captured production activation bodies behave identically.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import threading
import time
import uuid


class SqlError(RuntimeError):
    pass


class Session:
    def __init__(self, options):
        env = dict(os.environ)
        for key in ('PGSERVICE', 'PGSERVICEFILE', 'PGDATABASE', 'PGHOST', 'PGHOSTADDR', 'PGOPTIONS'):
            env.pop(key, None)
        env['PGHOSTADDR'] = '127.0.0.1'
        self.process = subprocess.Popen([
            options.psql, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
            '--host=127.0.0.1', '--port=' + str(options.port),
            '--username=postgres', '--dbname=' + options.database,
        ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, env=env)
        self.lines, self.errors = queue.Queue(), []
        def reader(stream, output):
            for line in stream:
                output(line.rstrip('\n'))
            if stream is self.process.stdout:
                self.lines.put(None)
        self.stdout_thread = threading.Thread(target=reader, args=(self.process.stdout, self.lines.put), daemon=True)
        self.stderr_thread = threading.Thread(target=reader, args=(self.process.stderr, self.errors.append), daemon=True)
        self.stdout_thread.start()
        self.stderr_thread.start()
        self.sql("\\set VERBOSITY verbose\nSET application_name='tenh_native_test'; SET lock_timeout='12s'; SET statement_timeout='20s'; SET idle_in_transaction_session_timeout='25s'; SET timezone='UTC';")
        self.pid = int(self.sql('select pg_backend_pid();')[-1])

    def sql(self, command, timeout=23):
        marker = 'END_' + uuid.uuid4().hex
        if self.process.poll() is not None:
            raise SqlError('\n'.join(self.errors))
        self.process.stdin.write(command + '\n\\echo ' + marker + '\n')
        self.process.stdin.flush()
        result, deadline = [], time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Native session did not finish within its deadline.')
            line = self.lines.get(timeout=remaining)
            if line is None:
                self.stderr_thread.join(timeout=1)
                raise SqlError('\n'.join(self.errors))
            if line == marker:
                return result
            if line:
                result.append(line)

    def value(self, command):
        return json.loads(self.sql(command)[-1])

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.write('\\q\n')
                self.process.stdin.flush()
                self.process.wait(timeout=3)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.wait(timeout=3)
        self.stderr_thread.join(timeout=1)


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def business(control):
    value = str(uuid.uuid4())
    control.sql("insert into business_subscriptions(business_id,plan_code,status,billing_cycle,member_limit,channel_limit,current_period_start,current_period_end) values(" + q(value) + ",'mini','trialing','monthly',1,3,now()-interval '15 days',now()+interval '15 days');")
    return value


def payment(workspace, provider='payway'):
    return {'id': str(uuid.uuid4()), 'business': workspace, 'provider': provider,
            'transaction': uuid.uuid4().hex[:18]}


def creation(row):
    if row['provider'] == 'payway':
        return "insert into billing_transactions(id,business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,metadata) values(" + ','.join([q(row['id']), q(row['business']), "'payway'", q(row['transaction']), "'mini'", "'monthly'", '13', "'USD'", "'pending'", '1', '3', "'{\"checkout_contract_version\":2,\"environment\":\"sandbox\",\"live_enabled\":false}'"]) + ');'
    return "insert into manual_payment_requests(id,business_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit) values(" + ','.join([q(row['id']), q(row['business']), "'mini'", "'monthly'", '13', "'USD'", "'submitted'", '1', '3']) + ');'


def approval(row):
    if row['provider'] == 'manual':
        return 'select row_to_json(r) from tenh_approve_manual_payment(' + q(row['id']) + '::uuid) r;'
    envelope = json.dumps({'status': {'code': '00', 'tran_id': row['transaction']}})
    return 'select row_to_json(r) from tenh_activate_verified_payway_payment(' + q(row['transaction']) + ",13,13,'USD','APPROVED',0,'synthetic'," + q(envelope) + '::jsonb,true) r;'


def history(control, *rows):
    control.sql("begin; set local session_replication_role='replica'; " + ' '.join(creation(r) for r in rows) + ' commit;')


def snapshot(control, workspace):
    return control.value("select jsonb_build_object('subscription',(select to_jsonb(s) from business_subscriptions s where business_id=" + q(workspace) + "::uuid),'payway',(select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') from billing_transactions b where business_id=" + q(workspace) + "::uuid),'manual',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from manual_payment_requests m where business_id=" + q(workspace) + "::uuid),'invoices',(select count(*) from tenh_billing_invoices where business_id=" + q(workspace) + '::uuid));')


def waiting(control, waiter, blocker):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = control.value('select jsonb_build_object(\'blocked\',' + str(blocker.pid) + '=any(pg_blocking_pids(' + str(waiter.pid) + ')));')
        if state['blocked']:
            return
        if waiter.process.poll() is not None:
            raise AssertionError('Expected a native lock wait, but the waiting session exited.')
        time.sleep(0.02)
    raise AssertionError('Did not observe the expected native blocker/waiter relationship.')


def expect_error(future, code):
    try:
        future.result(timeout=23)
    except SqlError as error:
        assert code in str(error), 'Unexpected native SQL error: ' + str(error)
    else:
        raise AssertionError('Expected native SQLSTATE ' + code)


def run(options):
    root = Path(__file__).resolve().parent
    fixture = root / 'native-payway-fixture.sql'
    core = root / 'fixtures' / 'payway-legacy-coexistence-core.sql'
    models = root / 'native-payway-models.sql'
    checks = []
    control = Session(options)
    try:
        assert control.value('select to_jsonb(current_database());') == options.database
        overlay = Path(options.reviewed_private_functions_sql).read_text(encoding='utf-8') if options.reviewed_private_functions_sql else ''
        if overlay and re.search(r'(?im)^\s*(?:(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;|\\(?:connect|c)\b)', overlay):
            raise ValueError('Private overlay must have no transaction or connection-switch commands.')
        control.sql('begin;\n' + fixture.read_text(encoding='utf-8') + '\n' + core.read_text(encoding='utf-8') + '\n' + models.read_text(encoding='utf-8') + '\n' + overlay + '\ncommit;', timeout=23)
        before_deadlocks = int(control.sql('select deadlocks from pg_stat_database where datname=current_database();')[-1])
        def pair(test_function):
            first, second = Session(options), Session(options)
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    test_function(first, second, executor)
            finally:
                first.close()
                second.close()
        for left, right in [('payway', 'payway'), ('manual', 'manual'), ('payway', 'manual'), ('manual', 'payway')]:
            def creators(a, b, executor):
                workspace = business(control)
                first, second = payment(workspace, left), payment(workspace, right)
                a.sql('begin; ' + creation(first))
                competing = executor.submit(b.sql, 'begin; ' + creation(second))
                waiting(control, b, a)
                a.sql('commit;')
                expect_error(competing, '23505')
                state = snapshot(control, workspace)
                assert len(state['payway']) + len(state['manual']) == 1
                assert state['subscription']['status'] == 'trialing' and state['invoices'] == 0
            pair(creators)
            checks.append('simultaneous creators: ' + left + '/' + right)
        for approved_provider, next_provider in [('payway', 'payway'), ('payway', 'manual'), ('manual', 'payway'), ('manual', 'manual')]:
            def approval_then_creation(a, b, executor):
                workspace = business(control)
                first, second = payment(workspace, approved_provider), payment(workspace, next_provider)
                control.sql(creation(first))
                result = json.loads(a.sql('begin; ' + approval(first))[-1])
                assert result['subscription_status'] == 'active'
                competing = executor.submit(b.sql, 'begin; ' + creation(second))
                waiting(control, b, a)
                a.sql('commit;')
                competing.result(timeout=23)
                b.sql('commit;')
                state = snapshot(control, workspace)
                assert state['invoices'] == 1 and state['subscription']['status'] == 'active'
                assert len(state['payway']) + len(state['manual']) == 2
                assert sum(r['status'] == 'approved' for r in state['payway'] + state['manual']) == 1
            pair(approval_then_creation)
            checks.append('creator waits for approval commit and sees fresh state: ' + approved_provider + '/' + next_provider)
        def cross_approvals(a, b, executor):
            workspace = business(control)
            first, second = payment(workspace), payment(workspace, 'manual')
            history(control, first, second)
            before = snapshot(control, workspace)
            assert json.loads(a.sql('begin; ' + approval(first))[-1])['subscription_status'] == 'recovery_required'
            competing = executor.submit(b.sql, 'begin; ' + approval(second))
            waiting(control, b, a)
            a.sql('commit;')
            assert json.loads(competing.result(timeout=23)[-1])['subscription_status'] == 'recovery_required'
            b.sql('commit;')
            assert snapshot(control, workspace) == before
            count = int(control.sql('select count(*) from tenh_billing_private.reconciliation_events where business_id=' + q(workspace) + '::uuid;')[-1])
            assert count == 2
        pair(cross_approvals)
        checks.append('cross-provider conflicting approval preserves both rows and entitlement')
        def replay(a, b, executor):
            workspace = business(control)
            first = payment(workspace)
            control.sql(creation(first))
            assert not json.loads(a.sql('begin; ' + approval(first))[-1])['already_approved']
            competing = executor.submit(b.sql, 'begin; ' + approval(first))
            waiting(control, b, a)
            a.sql('commit;')
            assert json.loads(competing.result(timeout=23)[-1])['already_approved']
            b.sql('commit;')
            assert snapshot(control, workspace)['invoices'] == 1
        pair(replay)
        checks.append('concurrent callback replay issues exactly one invoice')
        def creation_then_replay(a, b, executor):
            workspace = business(control)
            first, second = payment(workspace), payment(workspace, 'manual')
            control.sql(creation(first))
            control.sql(approval(first))
            a.sql('begin; ' + creation(second))
            competing = executor.submit(b.sql, 'begin; ' + approval(first))
            waiting(control, b, a)
            a.sql('commit;')
            assert json.loads(competing.result(timeout=23)[-1])['already_approved']
            b.sql('commit;')
            state = snapshot(control, workspace)
            assert state['invoices'] == 1 and state['manual'][0]['status'] == 'submitted'
        pair(creation_then_replay)
        checks.append('creator versus already-approved replay does not activate twice')
        def lock_order(a, b, executor):
            workspace = business(control)
            first = payment(workspace)
            control.sql(creation(first))
            a.sql('begin; select business_id from business_subscriptions where business_id=' + q(workspace) + '::uuid for update;')
            competing = executor.submit(b.sql, 'begin; ' + approval(first))
            waiting(control, b, a)
            a.sql('select id from billing_transactions where id=' + q(first['id']) + '::uuid for update nowait;')
            a.sql('commit;')
            assert json.loads(competing.result(timeout=23)[-1])['subscription_status'] == 'active'
            b.sql('commit;')
        pair(lock_order)
        checks.append('native waiter holds no payment lock before subscription lock')
        def nonlocking_sibling(a, b, executor):
            workspace = business(control)
            first, sibling = payment(workspace), payment(workspace, 'manual')
            history(control, first, sibling)
            a.sql('begin; select id from manual_payment_requests where id=' + q(sibling['id']) + '::uuid for update;')
            competing = executor.submit(b.sql, 'begin; ' + approval(first))
            result = json.loads(competing.result(timeout=3)[-1])
            assert result['subscription_status'] == 'recovery_required'
            a.sql('commit;')
            b.sql('commit;')
        pair(nonlocking_sibling)
        checks.append('conflict check never waits on a sibling payment row')
        def invoice_failure(a, b, executor):
            workspace = business(control)
            first, second = payment(workspace), payment(workspace, 'manual')
            control.sql(creation(first))
            before = snapshot(control, workspace)
            result = json.loads(a.sql("begin; set local tenh_native.fail_invoice='on'; " + approval(first))[-1])
            assert result['subscription_status'] == 'recovery_required'
            competing = executor.submit(b.sql, 'begin; ' + creation(second))
            waiting(control, b, a)
            a.sql('commit;')
            expect_error(competing, '23505')
            assert snapshot(control, workspace) == before
        pair(invoice_failure)
        checks.append('invoice subtransaction rollback preserves pending blocker and entitlement')
        workspace = business(control)
        first = payment(workspace)
        control.sql(creation(first))
        control.sql('update billing_transactions set status=\'failed\' where id=' + q(first['id']) + '::uuid;')
        before = snapshot(control, workspace)
        assert control.value(approval(first))['subscription_status'] == 'recovery_required'
        observation = json.dumps({'provider_status_code': '6'})
        assert control.value('select tenh_observe_payway_verification(' + q(first['transaction']) + ',' + q(observation) + '::jsonb,true);')['payment_state'] == 'failed'
        denied = Session(options)
        try:
            try:
                denied.sql('update billing_transactions set status=\'pending\' where id=' + q(first['id']) + '::uuid;')
            except SqlError as error:
                assert 'P0001' in str(error)
            else:
                raise AssertionError('Terminal payment reopened.')
        finally:
            denied.close()
        after = snapshot(control, workspace)
        assert after['payway'][0]['status'] == 'failed'
        assert after['subscription'] == before['subscription'] and after['invoices'] == 0
        checks.append('late approval and unknown inquiry never reactivate terminal payment')
        workspace = business(control)
        first = payment(workspace)
        history(control, first)
        control.sql("insert into tenh_billing_private.legacy_payway_enrollments select b.id,b.provider_transaction_id,b.business_id,tenh_compat_payment_identity(to_jsonb(b)),tenh_compat_subscription_identity(to_jsonb(s)),'review',false,'UTC','synthetic unverified merchant',clock_timestamp() from billing_transactions b join business_subscriptions s on s.business_id=b.business_id where b.id=" + q(first['id']) + '::uuid;')
        before = snapshot(control, workspace)
        assert control.value(approval(first))['subscription_status'] == 'recovery_required'
        assert snapshot(control, workspace) == before
        denied = Session(options)
        try:
            try:
                denied.sql("update billing_transactions set status='cancelled' where id=" + q(first['id']) + '::uuid;')
            except SqlError as error:
                assert 'P0001' in str(error)
            else:
                raise AssertionError('Enrolled payment was silently resolved.')
        finally:
            denied.close()
        checks.append('unverified merchant enrollment requires recovery and cannot silently cancel')
        privileges = control.value("select jsonb_build_object('schema',has_schema_privilege('service_role','tenh_billing_private','USAGE'),'forge',has_table_privilege('service_role','tenh_billing_private.approval_attempts','INSERT'),'direct',has_function_privilege('service_role','tenh_billing_private.activate_payway_v2(text,numeric,numeric,text,text,integer,text,jsonb,boolean)','EXECUTE')); ")
        assert privileges == {'schema': False, 'forge': False, 'direct': False}
        checks.append('service role cannot bypass wrapper or forge private approval permit')
        after_deadlocks = int(control.sql('select deadlocks from pg_stat_database where datname=current_database();')[-1])
        assert after_deadlocks == before_deadlocks, 'Native deadlock counter increased.'
        result = {'native_postgresql': True, 'activation_bodies': 'operator-supplied overlay; provenance requires separate review' if overlay else 'synthetic models; production body validation remains separate',
                  'private_overlay_sha256': hashlib.sha256(overlay.encode()).hexdigest() if overlay else None,
                  'core_sha256': hashlib.sha256(core.read_bytes()).hexdigest(),
                  'checks_passed': len(checks), 'checks': checks, 'deadlock_delta': after_deadlocks - before_deadlocks,
                  'server_version': control.value("select to_jsonb(current_setting('server_version'));")}
        print(json.dumps(result, indent=2))
    finally:
        control.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--port', type=int, default=5432)
    parser.add_argument('--psql', default=shutil.which('psql'))
    parser.add_argument('--reviewed-private-functions-sql', help='Optional separately reviewed private activation/invoice bodies; never included in the synthetic packet.')
    parser.add_argument('--allow-isolated-db-write', action='store_true')
    options = parser.parse_args()
    if not options.allow_isolated_db_write or not re.fullmatch(r'tenh_native_test_[a-z0-9_]+', options.database):
        parser.error('Explicit disposable database name and --allow-isolated-db-write are required.')
    if not options.psql:
        parser.error('Existing native psql executable is required; this harness installs nothing.')
    run(options)


if __name__ == '__main__':
    main()
