/* eslint-disable @typescript-eslint/no-require-imports -- Isolated roles, synthetic identities and payment evidence only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { database, prepare, settle } = require('./bakong-fixture.cjs');
const { loader } = require('./tenh-seven/harness.cjs');
const { getTrustedPlan, buildPurchaseRecord } = loader({ 'server-only': {} })('lib/billing/subscription-purchase.ts');

test('narrow service table grants retain owner-backed Bakong RPCs and manual upload lifecycle', async () => {
  const ctx = await database(), db = ctx.db;
  try {
    // Match the hosted default grants and BYPASSRLS role inside this disposable database.
    await db.exec('alter role service_role bypassrls; grant all on all tables in schema public to service_role;');
    for (const table of ['bakong_payment_attempts', 'manual_payment_uploads']) {
      assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed', ['service_role', `public.${table}`, 'TRUNCATE'])).rows[0].allowed, true);
    }
    const files = fs.readdirSync('db/migrations').filter(file => file.endsWith('_payment_service_table_privileges.sql'));
    assert.equal(files.length, 1);
    await db.exec(fs.readFileSync(`db/migrations/${files[0]}`, 'utf8'));
    for (const table of ['bakong_payment_attempts', 'manual_payment_uploads']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        const allowed = table === 'bakong_payment_attempts' ? privilege === 'SELECT' : ['SELECT', 'INSERT', 'UPDATE'].includes(privilege);
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed', ['service_role', `public.${table}`, privilege])).rows[0].allowed, allowed, `${table}: ${privilege}`);
      }
      for (const role of ['anon', 'authenticated']) {
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed', [role, `public.${table}`, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'])).rows[0].allowed, false);
      }
    }
    await db.query("insert into tenh_bakong_private.capacity_reviews values($1,$2,'production',true,100,100,20,'synthetic permission regression',$3,now())", ['f'.repeat(64), 'merchant@devb', randomUUID()]);
    await db.exec('set role service_role');
    const purchase = await prepare(ctx, { environment: 'production' });
    await assert.rejects(db.exec('update public.bakong_payment_attempts set state=state where false'), /permission denied/);
    await assert.rejects(db.exec('delete from public.bakong_payment_attempts where false'), /permission denied/);
    await assert.rejects(db.exec('truncate public.bakong_payment_attempts'), /permission denied/);
    assert.equal((await settle(ctx, purchase)).result.state, 'verified');
    const apply = () => db.query('select public.tenh_apply_bakong_payment($1,$2) result', [purchase.attempt.id, purchase.userId]);
    assert.equal((await apply()).rows[0].result.state, 'applied');
    assert.equal((await apply()).rows[0].result.state, 'applied');
    assert.equal((await db.query('select count(*)::int n from tenh_billing_invoices where source_payment_id=$1', [purchase.attempt.id])).rows[0].n, 1);

    const workspace = await ctx.trial(), member = randomUUID(), ticket = randomUUID();
    await db.query("insert into businesses(id,name) values($1,'Synthetic permission workspace')", [workspace.businessId]);
    await db.query("insert into team_members(id,user_id,business_id,role,is_active) values($1,$2,$3,'owner',true)", [member, randomUUID(), workspace.businessId]);
    const subscription = (await db.query('select to_jsonb(s) s from business_subscriptions s where business_id=$1', [workspace.businessId])).rows[0].s;
    const quote = getTrustedPlan('mini', 'monthly', null, null, false, false, 'none', subscription);
    const payload = buildPurchaseRecord(ticket, workspace.businessId, member, quote, subscription);
    await db.query("insert into manual_payment_uploads(id,business_id,member_id,storage_path,file_name,mime_type,size_bytes,selection,request_payload) values($1,$2,$3,$4,'proof.png','image/png',3,'{}',$5)", [ticket, workspace.businessId, member, `${workspace.businessId}/${ticket}/proof.png`, payload]);
    assert.equal((await db.query('select public.tenh_get_manual_payment_upload($1) result', [ticket])).rows[0].result.status, 'prepared');
    assert.equal((await db.query('select public.tenh_abort_manual_payment_upload($1,$2,$3) result', [ticket, workspace.businessId, member])).rows[0].result.state, 'aborted');
    await assert.rejects(db.exec('delete from public.manual_payment_uploads where false'), /permission denied/);
    await assert.rejects(db.exec('truncate public.manual_payment_uploads'), /permission denied/);
    await db.exec('reset role');
    const functions = (await db.query("select p.proname,p.prosecdef,pg_get_userbyid(p.proowner) owner,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tenh_prepare_bakong_payment','tenh_claim_bakong_check','tenh_complete_bakong_check','tenh_apply_bakong_payment','tenh_bakong_capacity')")).rows;
    assert.equal(functions.length, 5);
    assert.ok(functions.every(fn => fn.prosecdef && fn.owner === 'postgres' && fn.service));
  } finally { await db.close(); }
});
