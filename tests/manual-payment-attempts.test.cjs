/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated route probes and embedded PostgreSQL only; no network, files or hosted data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader, database } = require('./tenh-seven/harness.cjs');

const business = '10000000-0000-4000-8000-000000000001';
const member = '20000000-0000-4000-8000-000000000001';
const requestId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const selection = { planCode: 'mini', billingCycle: 'monthly', fileName: 'local.png', mimeType: 'image/png', sizeBytes: 3 };

function fixture(options = {}) {
  const db = database({
    team_members: [{ id: member, business_id: business, user_id: 'user', role: 'owner', is_active: true }],
    businesses: [{ id: business, name: 'Fixture' }],
    business_subscriptions: [{ id: 'subscription', business_id: business, status: 'expired', plan_code: 'mini',
      billing_cycle: 'monthly', member_limit: 1, channel_limit: 3, pricing_snapshot: {}, last_paid_amount: 12,
      last_paid_currency: 'USD', current_period_start: '2026-01-01T00:00:00Z', current_period_end: '2026-02-01T00:00:00Z' }],
    manual_payment_requests: [], manual_payment_uploads: [], billing_transactions: [],
  });
  const effects = [], objects = new Map();
  const mutable = { authorized: true, canManage: true, memberId: member, ...options };
  const from = db.from;
  db.from = name => {
    const query = from(name), execute = query.execute.bind(query);
    query.execute = async () => {
      if (name === 'manual_payment_uploads' && query.op === 'insert') {
        const row = query.body;
        if (db.tables.manual_payment_uploads.some(x => x.id === row.id || (x.business_id === row.business_id && x.state === 'prepared'))
          || db.tables.manual_payment_requests.some(x => x.business_id === row.business_id && x.status === 'submitted')
          || db.tables.billing_transactions.some(x => x.business_id === row.business_id && x.provider === 'payway' && x.status === 'pending')) {
          return { data: null, error: { code: '23505', message: 'pending claim' } };
        }
      }
      const result = await execute();
      if (name === 'manual_payment_uploads' && query.op === 'insert' && result.data && mutable.finishDuringPrepare) {
        mutable.finishDuringPrepare = false;
        const ticket = db.tables.manual_payment_uploads.find(x=>x.id===result.data.id);
        db.tables.manual_payment_requests.push({...ticket.request_payload,created_at:'2026-10-15T00:00:00Z'});
        ticket.state='submitted'; objects.set(ticket.storage_path,{size:3,contentType:'image/png'});
        return {data:null,error:{code:'23505',message:'concurrent prepare/finalize completed'}};
      }
      if (name === 'manual_payment_uploads' && query.op === 'insert' && result.data && mutable.lostPrepare) {
        mutable.lostPrepare = false;
        return { data: null, error: { message: 'lost preparation reply' } };
      }
      return result;
    };
    return query;
  };
  db.storage = { from: bucket => ({
    createSignedUploadUrl: async (path, config) => {
      effects.push(['sign', bucket, path, config]);
      return mutable.signError ? { data: null, error: { message: 'sign unavailable' } } : { data: { token: 'fixture-token' }, error: null };
    },
    info: async path => {
      effects.push(['info', path]);
      return mutable.infoError ? { data: null, error: mutable.infoError }
        : objects.has(path) ? { data: objects.get(path), error: null } : { data: null, error: { status: 404 } };
    },
    remove: async () => { assert.fail('Manual payment reconciliation must never delete proof objects'); },
  }) };
  let queue = Promise.resolve();
  db.rpc = (name, args) => {
    if (name === 'tenh_payment_application_guards_ready') return Promise.resolve({data: !mutable.guardsUnavailable, error: null});
    const result = queue.then(() => {
      effects.push(['rpc', name]);
      if (mutable.rpcError) return { data: null, error: mutable.rpcError };
      const ticket = db.tables.manual_payment_uploads.find(x => x.id === args.p_request_id
        && x.business_id === args.p_business_id && x.member_id === args.p_member_id);
      if (!ticket || !db.tables.team_members.some(x => x.id === args.p_member_id && x.business_id === args.p_business_id && x.is_active)) {
        return { data: null, error: { code: '42501', message: 'revoked' } };
      }
      const saved = db.tables.manual_payment_requests.find(x => x.id === ticket.id);
      if (name === 'tenh_abort_manual_payment_upload') {
        if (saved || ticket.state === 'submitted') return { data: null, error: { code: '22023' } };
        ticket.state = 'aborted';
        return { data: { id: ticket.id, business_id: ticket.business_id, state: 'aborted' }, error: null };
      }
      assert.equal(name, 'tenh_finalize_manual_payment_upload');
      if (saved) return { data: structuredClone(saved), error: null };
      if (ticket.state !== 'prepared') return { data: null, error: { code: '22023' } };
      const row = { ...ticket.request_payload, created_at: '2026-10-15T00:00:00Z', customer_note: args.p_customer_note };
      db.tables.manual_payment_requests.push(row); ticket.state = 'submitted';
      if (mutable.lostFinalize) { mutable.lostFinalize = false; return { data: null, error: { message: 'lost commit reply' } }; }
      return { data: structuredClone(row), error: null };
    });
    queue = result.then(() => {});
    return result;
  };
  const load = loader({
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/auth/get-current-member': { getCurrentMember: async strict => {
      assert.equal(strict, true);
      return mutable.authorized ? { success: true, user: { id: 'user' }, member: { ...db.tables.team_members[0], id: mutable.memberId } }
        : { success: false, status: 403, error: 'membership revoked' };
    } },
    '@/lib/auth/require-permission': { memberHasPermission: async () => mutable.canManage,
      permissionDenied: error => Response.json({ success: false, error }, { status: 403 }) },
    '@/lib/billing/manual-payment-config': { getManualPaymentConfig: () => ({ enabled: true }) },
    '@/lib/billing/manual-payment-payway-safety': { getManualPaymentPayWaySafety: async () => ({ blocked: false }) },
    '@/lib/subscription/sync-subscription-lifecycle': { syncBusinessSubscriptionLifecycle: async () => { effects.push(['sync']); } },
  });
  const route = load('app/api/manual-payments/route.ts');
  const invoke = async (body, query = '') => {
    const response = await (body ? route.POST(new Request('https://fixture.invalid/api/manual-payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })) : route.GET(new Request('https://fixture.invalid/api/manual-payments' + query)));
    return { status: response.status, headers: response.headers, ...await response.json() };
  };
  const prepare = async (id = requestId(1), extra = {}) => invoke({ action: 'prepare-upload', requestId: id, ...selection, ...extra });
  const put = attempt => objects.set(attempt.upload.path, { size: 3, contentType: 'image/png' });
  const finalize = (id = requestId(1), extra = {}) => invoke({ action: 'finalize-upload', requestId: id, ...extra });
  return { db, effects, objects, mutable, invoke, prepare, put, finalize };
}

test('manual prepare persists trusted selection before signing and same-ID retries retain quote/path', async () => {
  const h = fixture(), first = await h.prepare();
  assert.equal(first.status, 200); assert.equal(first.trustedAmount, '13.00');
  assert.equal(first.headers.get('cache-control'), 'private, no-store, max-age=0');
  const ticket = h.db.tables.manual_payment_uploads[0];
  assert.equal(ticket.member_id, member); assert.equal(ticket.request_payload.amount, '13.00');
  assert.deepEqual(ticket.request_payload._expected_subscription, h.db.tables.business_subscriptions[0]);
  h.db.tables.business_subscriptions[0].last_paid_amount = 99;
  const again = await h.prepare();
  assert.equal(again.upload.path, first.upload.path); assert.equal(again.trustedAmount, first.trustedAmount);
  assert.equal(h.db.tables.manual_payment_uploads.length, 1);
  assert.equal(h.effects.filter(x => x[0] === 'sync').length, 1);
  assert.ok(h.effects.filter(x => x[0] === 'sign').every(x => x[3].upsert === false));
});

test('permission, foreign workspace/member, forged path and mismatched file fail without Storage effects', async () => {
  for (const options of [{ authorized: false }, { canManage: false }]) {
    const h = fixture(options); assert.equal((await h.prepare()).status, 403); assert.deepEqual(h.effects, []);
  }
  const h = fixture();
  assert.equal((await h.prepare(requestId(1), { purchaseBusinessId: requestId(99) })).status, 403);
  const prepared = await h.prepare(); h.put(prepared); h.effects.length = 0;
  assert.equal((await h.finalize(requestId(999), { storagePath: prepared.upload.path })).status, 404);
  assert.equal((await h.finalize(requestId(1), { storagePath: business + '/old-object.png' })).status, 400);
  assert.equal((await h.finalize(requestId(1), { sizeBytes: 4 })).status, 400);
  h.mutable.memberId = requestId(90);
  assert.equal((await h.finalize()).status, 404); assert.deepEqual(h.effects, []);
  h.mutable.authorized = false;
  assert.equal((await h.finalize()).status, 403); assert.equal(h.objects.size, 1);
});

test('invalid file and competing attempts do not create or replace a pending intent', async () => {
  for (const extra of [{ mimeType: 'application/zip' }, { sizeBytes: 0 }, { sizeBytes: 10 * 1024 * 1024 + 1 }]) {
    const h = fixture(); assert.equal((await h.prepare(requestId(1), extra)).status, 400); assert.equal(h.objects.size, 0);
    assert.equal(h.db.tables.manual_payment_uploads.length, 0); assert.equal(h.effects.some(x => x[0] === 'sign'), false);
  }
  const h = fixture();
  const results = await Promise.all([h.prepare(requestId(1)), h.prepare(requestId(2))]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]); assert.equal(h.db.tables.manual_payment_uploads.length, 1);
  assert.equal((await h.prepare(requestId(1), { fileName: 'changed.png' })).status, 400);
  assert.equal(h.effects.filter(x => x[0] === 'sign').length, 1);
});

test('native prepare without client ID remains supported; signature/DB outages retain recoverable intent', async () => {
  const h = fixture({ signError: true });
  const result = await h.invoke({ action: 'prepare-upload', ...selection });
  assert.equal(result.status, 503); assert.equal(h.db.tables.manual_payment_uploads.length, 1);
  const id = h.db.tables.manual_payment_uploads[0].id;
  h.mutable.signError = false;
  assert.equal((await h.invoke({ action: 'resume-upload', requestId: id, fileName: 'local.png', mimeType: 'image/png', sizeBytes: 3 })).status, 200);
  const failed = fixture(); failed.db.failures.push({ table: 'manual_payment_uploads', op: 'insert' });
  assert.equal((await failed.prepare()).code, 'TENH_MANUAL_PREPARATION_UNCERTAIN');
  assert.equal(failed.effects.some(x => x[0] === 'sign'), false);
});

test('new payment preparation fails closed without application-baseline guards', async () => {
  const h = fixture({guardsUnavailable:true});
  assert.equal((await h.prepare()).code, 'TENH_BILLING_APPLICATION_MIGRATION_REQUIRED');
  assert.equal(h.db.tables.manual_payment_uploads.length,0); assert.deepEqual(h.effects,[]);
  h.mutable.guardsUnavailable=false; const prepared=await h.prepare(); h.put(prepared);
  h.mutable.guardsUnavailable=true;
  assert.equal((await h.finalize()).status,200);
});

test('lost prepare acknowledgement reuses persisted ticket instead of creating a second object', async () => {
  const h = fixture({ lostPrepare: true }); const result = await h.prepare();
  assert.equal(result.status, 200); assert.equal(h.db.tables.manual_payment_uploads.length, 1);
  assert.equal((await h.prepare()).upload.path, result.upload.path);
  const concurrent = fixture();
  const pair = await Promise.all([concurrent.prepare(),concurrent.prepare()]);
  assert.ok(pair.every(x=>x.status===200)); assert.equal(pair[0].upload.path,pair[1].upload.path);
  assert.equal(concurrent.db.tables.manual_payment_uploads.length,1);
  const completed = fixture({finishDuringPrepare:true}), final = await completed.prepare();
  assert.equal(final.status,200); assert.equal(final.request.id,requestId(1));
  assert.equal(completed.effects.some(x=>x[0]==='sign'),false); assert.equal(completed.objects.size,1);
});

test('resume uses saved quote, checks existing bytes and finalizes duplicates/concurrent calls once', async () => {
  const h = fixture(), prepared = await h.prepare(); h.put(prepared);
  h.db.tables.business_subscriptions[0].status = 'suspended';
  h.mutable.signError = true;
  const resumed = await h.invoke({ action: 'resume-upload', requestId: requestId(1), fileName: 'local.png', mimeType: 'image/png', sizeBytes: 3 });
  assert.equal(resumed.status, 200); assert.equal(resumed.proofUploaded, true); assert.equal(resumed.trustedAmount, prepared.trustedAmount);
  assert.equal(resumed.upload.path, prepared.upload.path); assert.equal(resumed.upload.token, null);
  assert.equal(h.effects.filter(x=>x[0]==='sign').length,1); assert.equal(h.db.tables.manual_payment_requests.length,0);
  const results = await Promise.all([h.finalize(), h.finalize()]);
  assert.ok(results.every(x => x.status === 200)); assert.equal(results[0].request.id, results[1].request.id);
  assert.equal(h.db.tables.manual_payment_requests.length, 1); assert.equal(h.objects.size, 1);
  const reads = h.effects.filter(x => x[0] === 'info').length;
  assert.equal((await h.finalize()).status, 200); assert.equal(h.effects.filter(x => x[0] === 'info').length, reads);
});

test('missing, mismatched, uncertain and DB-failed uploads preserve object and exact ticket', async () => {
  const h = fixture(), prepared = await h.prepare();
  assert.equal((await h.finalize()).code, 'UPLOAD_INCOMPLETE');
  h.put(prepared); h.objects.get(prepared.upload.path).size = 4;
  assert.equal((await h.finalize()).status, 400); assert.equal(h.db.tables.manual_payment_requests.length, 0);
  h.objects.get(prepared.upload.path).size = 3; h.mutable.infoError = { status: 503 };
  assert.equal((await h.finalize()).code, 'TENH_MANUAL_SUBMISSION_UNCERTAIN');
  h.mutable.infoError = null; h.mutable.rpcError = { message: 'insert failed' };
  assert.equal((await h.finalize()).code, 'TENH_MANUAL_SUBMISSION_UNCERTAIN');
  assert.equal(h.objects.size, 1); assert.equal(h.db.tables.manual_payment_uploads[0].state, 'prepared');
  h.mutable.rpcError = null; assert.equal((await h.finalize()).status, 200);
});

test('lost finalization response reconciles exact committed request; existing request is never cleaned up', async () => {
  const h = fixture({ lostFinalize: true }), prepared = await h.prepare(); h.put(prepared);
  const result = await h.finalize(); assert.equal(result.status, 200); assert.equal(result.request.id, requestId(1));
  assert.equal(h.db.tables.manual_payment_requests.length, 1); assert.equal(h.objects.size, 1);
  assert.equal((await h.finalize(requestId(1), { storagePath: business + '/forged' })).status, 400);
  assert.equal((await h.finalize()).status, 200); assert.equal(h.objects.size, 1);
});

test('abort/finalize resolve one lifecycle, duplicate abort is idempotent and proof is retained', async () => {
  const h = fixture(), prepared = await h.prepare(); h.put(prepared);
  assert.equal((await h.invoke({ action: 'abort-upload', requestId: requestId(1) })).status, 200);
  assert.equal((await h.invoke({ action: 'abort-upload', requestId: requestId(1) })).status, 200);
  assert.equal((await h.finalize()).status, 409); assert.equal(h.objects.size, 1);
  const other = fixture(), second = await other.prepare(); other.put(second);
  const outcomes = await Promise.all([other.finalize(), other.invoke({ action: 'abort-upload', requestId: requestId(1) })]);
  assert.deepEqual(outcomes.map(x=>x.status).sort(), [200,409]); assert.equal(other.objects.size, 1);
});

test('checkout lookup excludes historical approvals; exact and legacy GET keep their contracts', async () => {
  const h = fixture();
  h.db.tables.manual_payment_requests.push({ id: requestId(90), business_id: business, requested_by_member_id: member,
    plan_code: 'mini', billing_cycle: 'monthly', status: 'approved', amount: 12, currency: 'USD' });
  assert.equal((await h.invoke(null, '?mode=checkout')).request, null);
  assert.equal((await h.invoke(null)).request.id, requestId(90));
  assert.equal((await h.invoke(null, '?request_id=' + requestId(90))).request.id, requestId(90));
  assert.equal((await h.invoke(null, '?request_id=' + requestId(91))).status, 404);
  await h.prepare();
  const checkout = await h.invoke(null, '?mode=checkout');
  assert.equal(checkout.request, null); assert.equal(checkout.preparedAttempt.id, requestId(1));
  assert.equal(checkout.preparedAttempt.canResume, true);
  h.mutable.memberId = requestId(80);
  const blocked = await h.invoke(null, '?mode=checkout');
  assert.equal(blocked.preparedAttempt.canResume, false); assert.equal(blocked.preparedAttempt.fileName, undefined);
  assert.equal((await h.invoke(null, '?request_id=' + requestId(1))).status, 404);
});

test('manual attempt migration: real SQL enum compatibility, shared claims, rollback, identity and ACL',
  { skip: !process.env.TENH_PGLITE_MODULE }, async () => {
    const { PGlite } = require(process.env.TENH_PGLITE_MODULE), db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create table public.businesses(id uuid primary key);
        create table public.team_members(id uuid primary key,business_id uuid,is_active boolean);
        create table public.business_subscriptions(business_id uuid primary key);
        create table public.billing_transactions(id uuid primary key,business_id uuid,provider text,status text);
        create type public.manual_status as enum ('submitted','approved','rejected','cancelled');
        create table public.manual_payment_requests(id uuid primary key,business_id uuid,requested_by_member_id uuid,
          plan_code text,billing_cycle text,target_member_limit int,target_channel_limit int,pricing_version text,
          renew_same boolean,pricing_snapshot jsonb,amount numeric,currency text,status public.manual_status,
          transfer_reference text,customer_note text,proof_bucket text,proof_path text,proof_file_name text,
          proof_mime_type text,proof_size_bytes bigint,created_at timestamptz default now());
        grant usage on schema public to service_role;
        grant select,insert,update on all tables in schema public to service_role;
        insert into public.businesses values ('${business}');
        insert into public.team_members values ('${member}','${business}',true);
        insert into public.business_subscriptions values ('${business}');`);
      await db.exec(fs.readFileSync('db/migrations/20261015104508_manual_payment_upload_lifecycle.sql', 'utf8'));
      const prepare = (n, expected) => db.query(`insert into public.manual_payment_uploads(id,business_id,member_id,storage_path,file_name,mime_type,size_bytes,selection,request_payload)
        values($1,$2,$3,$4,'local.png','image/png',3,'{}',$5)`, [requestId(n),business,member,`${business}/${requestId(n)}/local.png`,
        JSON.stringify({plan_code:'mini',billing_cycle:'monthly',target_member_limit:1,target_channel_limit:3,pricing_version:'fixture',renew_same:false,pricing_snapshot:{},amount:'12.00',
          ...(expected?{_expected_subscription:expected}:{})})]);
      const finalize = (n, initiator = member) => db.query('select public.tenh_finalize_manual_payment_upload($1,$2,$3) result', [requestId(n),business,initiator]);
      const abort = n => db.query('select public.tenh_abort_manual_payment_upload($1,$2,$3) result', [requestId(n),business,member]);
      await prepare(1); await assert.rejects(prepare(2), /unresolved payment/);
      await assert.rejects(db.query("insert into public.billing_transactions values($1,$2,'payway','pending')", [requestId(2),business]), /unresolved payment/);
      await assert.rejects(finalize(1,requestId(99)), /not found/);
      await db.exec(`create function public.reject_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture insert failure'; end $$;
        create trigger fixture_failure before insert on public.manual_payment_requests for each row execute function public.reject_fixture();`);
      await assert.rejects(finalize(1), /fixture insert failure/);
      assert.equal((await db.query('select state from public.manual_payment_uploads')).rows[0].state, 'prepared');
      assert.equal((await db.query('select count(*)::int n from public.manual_payment_requests')).rows[0].n, 0);
      await db.exec('drop trigger fixture_failure on public.manual_payment_requests; drop function public.reject_fixture();');
      const first = await finalize(1), repeated = await finalize(1);
      assert.deepEqual(first.rows, repeated.rows);
      assert.equal((await db.query('select count(*)::int n from public.manual_payment_requests')).rows[0].n, 1);
      await assert.rejects(abort(1), /submitted payment/);
      await db.query('update public.manual_payment_requests set requested_by_member_id=null where id=$1', [requestId(1)]);
      await assert.rejects(finalize(1), /identity mismatch/);
      await db.query("update public.manual_payment_requests set requested_by_member_id=$2,status='approved' where id=$1", [requestId(1),member]);
      await prepare(2); await abort(2); await abort(2); await assert.rejects(finalize(2), /no longer open/);
      await db.query("insert into public.billing_transactions values($1,$2,'payway','pending')", [requestId(3),business]);
      await assert.rejects(prepare(3), /unresolved payment/);
      await db.query("update public.billing_transactions set status='cancelled' where id=$1", [requestId(3)]);
      await prepare(4);
      await db.query('update public.team_members set is_active=false where id=$1', [member]);
      await assert.rejects(finalize(4), /revoked/); await assert.rejects(abort(4), /revoked/);
      await db.query('update public.team_members set is_active=true where id=$1', [member]);
      await db.exec('set role service_role');
      assert.equal((await finalize(4)).rows[0].result.id, requestId(4));
      const projection = (await db.query('select public.tenh_get_manual_payment_upload($1) result', [requestId(4)])).rows[0].result;
      assert.equal(projection.status, 'recovery_required'); assert.equal(projection.proof_path, undefined); assert.equal(projection.request_payload, undefined);
      await db.exec('reset role');
      for (const role of ['anon','authenticated']) {
        const acl = (await db.query(`select has_table_privilege($1,'public.manual_payment_uploads','SELECT') tickets,
          has_function_privilege($1,'public.tenh_finalize_manual_payment_upload(uuid,uuid,uuid,text)','EXECUTE') finalize,
          has_function_privilege($1,'public.tenh_abort_manual_payment_upload(uuid,uuid,uuid)','EXECUTE') abort`, [role])).rows[0];
        assert.deepEqual(acl,{tickets:false,finalize:false,abort:false});
      }
      assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.manual_payment_uploads'::regclass")).rows[0].relrowsecurity,true);

      // Combined ticket wiring uses both actual drafts and the exact canonicalizer.
      // Legacy approval is stubbed false; activation/invoice RPCs are tested separately.
      await db.query("update public.manual_payment_requests set status='approved' where id=$1",[requestId(4)]);
      await prepare(5);
      await db.exec(`create schema tenh_billing_private;
        alter table public.billing_transactions add column metadata jsonb default '{}';
        alter table public.business_subscriptions add column plan_code text default 'mini';
        create function public.tenh_legacy_approval_authorized(uuid) returns boolean language sql as 'select false';
        create function tenh_billing_private.deny_audit_mutation() returns trigger language plpgsql as $$ begin raise exception 'append-only fixture'; end $$;`);
      const core=fs.readFileSync('tests/fixtures/payway-legacy-coexistence-core.sql','utf8');
      const identityStart=core.indexOf('create function public.tenh_compat_subscription_identity(');
      await db.exec(core.slice(identityStart,core.indexOf('$function$;',identityStart)+'$function$;'.length));
      await db.exec(fs.readFileSync('db/migrations/20261015113000_payment_application_baselines.sql','utf8'));
      assert.equal((await db.query('select public.tenh_payment_application_guards_ready() ready')).rows[0].ready,true);
      await assert.rejects(finalize(5),/no original application baseline/);
      assert.equal((await db.query('select state from public.manual_payment_uploads where id=$1',[requestId(5)])).rows[0].state,'prepared');
      await abort(5);
      const expected=(await db.query('select * from public.business_subscriptions')).rows[0];
      await db.exec('set role service_role');
      await assert.rejects(prepare(6,{...expected,plan_code:'stale'}),/subscription changed/);
      await prepare(6,expected);
      await db.exec('reset role');
      const baseline=(await db.query('select subscription_identity from tenh_billing_private.payment_application_baselines where source_payment_id=$1',[requestId(6)])).rows[0].subscription_identity;
      assert.equal(baseline.plan_code,'mini');
      await db.query("update public.business_subscriptions set plan_code='pro'");
      await db.exec('set role service_role');
      assert.equal((await finalize(6)).rows[0].result.id,requestId(6));
      await assert.rejects(db.query("update public.manual_payment_requests set status='approved' where id=$1",[requestId(6)]),/changed subscription/);
      await db.exec('reset role');
      assert.deepEqual((await db.query('select subscription_identity from tenh_billing_private.payment_application_baselines where source_payment_id=$1',[requestId(6)])).rows[0].subscription_identity,baseline);
      await db.query("update public.business_subscriptions set plan_code='mini'");
      await db.query("update public.manual_payment_requests set status='approved' where id=$1",[requestId(6)]);
    } finally { await db.close(); }
  });

test('admin readiness, source identity and duplicate notification gates preserve approved rechecks', async () => {
  for (const mode of ['valid','mismatched','unready','approved']) {
    const db = database({manual_payment_requests:[{id:requestId(1),business_id:business,status:mode==='approved'?'approved':'submitted',plan_code:'mini',billing_cycle:'monthly',amount:12,currency:'USD'}],
      business_subscriptions:[{business_id:business,status:'expired'}]});
    const logs = [],rpc=[];
    db.rpc = async name => {rpc.push(name);return name==='tenh_payment_application_guards_ready' ? {data:mode!=='unready',error:null}
      : {data:{request_id:requestId(mode==='mismatched' ? 2 : 1),business_id:business,subscription_status:'active',already_approved:true},error:null};};
    const route = loader({
      '@/lib/supabase/admin':{supabaseAdmin:db},
      '@/lib/admin/tenh-admin-auth':{getTenhAdminMutationUser:async()=>({success:true,user:{id:'admin',email:'admin@example.invalid'}})},
      '@/lib/admin/log-tenh-admin-action':{logTenhAdminAction:async input=>logs.push(input)},
      '@/lib/billing/manual-payment-payway-safety':{getManualPaymentPayWaySafety:async()=>({blocked:false})},
    })('app/api/manual-payments/admin/route.ts');
    const response = await route.POST(new Request('https://fixture.invalid/api/manual-payments/admin', {method:'POST',body:JSON.stringify({requestId:requestId(1),decision:'approve'})}));
    assert.equal(response.status,mode==='mismatched'?500:mode==='unready'?503:200);
    const body = await response.json();
    if (mode==='valid'||mode==='approved') { assert.equal(body.wasAlreadyApproved,true);assert.equal(body.notificationSent,false);assert.equal(logs[0].action,'manual_payment_approval_rechecked'); }
    else assert.equal(logs.length,0);
    if(mode==='unready')assert.equal(rpc.includes('tenh_approve_manual_payment'),false);
    if(mode==='approved')assert.equal(rpc.includes('tenh_payment_application_guards_ready'),false);
    assert.equal(db.history.some(x=>x.table==='member_notifications'),false);
  }
});

test('a rejection race with zero affected rows cannot report success or notify', async () => {
  const db=database({manual_payment_requests:[{id:requestId(1),business_id:business,status:'submitted'}]});
  const from=db.from;db.from=name=>{const query=from(name),execute=query.execute.bind(query);
    query.execute=async()=>query.op==='update'?{data:null,error:null}:execute();return query;};
  let audited=false;
  const route=loader({
    '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/admin/tenh-admin-auth':{getTenhAdminMutationUser:async()=>({success:true,user:{id:'admin'}})},
    '@/lib/admin/log-tenh-admin-action':{logTenhAdminAction:async()=>{audited=true;}},
  })('app/api/manual-payments/admin/route.ts');
  const response=await route.POST(new Request('https://fixture.invalid/api/manual-payments/admin',{method:'POST',body:JSON.stringify({requestId:requestId(1),decision:'reject',reviewNote:'Fixture rejection'})}));
  assert.equal(response.status,409);assert.equal(audited,false);
  assert.equal(db.history.some(x=>x.table==='member_notifications'),false);
});
