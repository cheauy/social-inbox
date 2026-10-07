import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import harness from "./tenh-seven/harness.cjs";

// Provisioning is deliberately separate. Never accept a production URL or load .env files.
const psql = process.env.TENH_ADVERTISER_TEST_PSQL;
const runId = process.env.TENH_ADVERTISER_TEST_RUN_ID;
const database = "tenh_advertiser_validation";
const table = "tiktok_advertiser_connections";
const app = "123456";
const businessA = "00000000-0000-4000-8000-000000000001";
const businessB = "00000000-0000-4000-8000-000000000002";
const member = "00000000-0000-4000-8000-000000000011";
const user = "00000000-0000-4000-8000-000000000021";
const memberB = "00000000-0000-4000-8000-000000000012";
const userB = "00000000-0000-4000-8000-000000000022";
const hash = value => createHash("sha256").update(value).digest("hex");
const openSessions = new Set();
const literal = value => value === null ? "null" : Array.isArray(value)
  ? `ARRAY[${value.map(literal).join(",")}]::text[]` : `'${String(value).replaceAll("'", "''")}'`;
const identifier = value => {
  assert.match(value, /^[a-z_]+$/);
  return `"${value}"`;
};

function session(input, application = "tenh_advertiser_validation") {
  assert.ok(psql); assert.match(runId ?? "", /^[a-f0-9-]{36}$/);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
  const child = spawn(psql, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
    "-h", "127.0.0.1", "-p", "55437", "-U", "tenh_validation_admin", "-d", database], {
    windowsHide: true, env: { ...inherited, PGAPPNAME: application, PGHOSTADDR: "127.0.0.1",
      PGOPTIONS: "-c statement_timeout=15000 -c lock_timeout=10000", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
      PGPASSFILE: `${psql}.validation-no-password` },
  });
  openSessions.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => { openSessions.delete(child); resolve({ code, stdout: stdout.trim(), stderr }); });
  });
  if (input !== undefined) child.stdin.end(input);
  return { child, done };
}

async function sql(input) {
  const result = await session(input).done;
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}
async function denied(input, code) {
  const result = await session(input).done;
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, new RegExp(code));
}
async function until(check) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, "Timed out waiting for the expected database lock/state");
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
const holdsAdvisoryLock = application => sql(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid)
  WHERE a.application_name=${literal(application)} AND l.locktype='advisory' AND l.granted
    AND a.state='idle in transaction')`).then(value => value === "t");
const service = statement => `BEGIN; SET LOCAL ROLE service_role; ${statement}; COMMIT;`;
async function attempt(business = businessA, actorMember = business === businessB ? memberB : member, actorUser = business === businessB ? userB : user) {
  const id = randomUUID();
  await sql(service(`INSERT INTO public.${table}(id,business_id,member_id,user_id,app_id,status)
    VALUES (${literal(id)},${literal(business)},${literal(actorMember)},${literal(actorUser)},${literal(app)},'exchanging')`));
  return id;
}
const save = (id, business, fingerprint, encrypted = "v1.fixture.fixture.fixture") =>
  `SELECT public.tenh_save_tiktok_advertiser_grant(${literal(id)},${literal(business)},${literal(business === businessB ? memberB : member)},
    ${literal(business === businessB ? userB : user)},${literal(app)},${literal(fingerprint)},${literal(encrypted)},ARRAY['7001'],ARRAY['1'])`;
const claim = (id, business, operation) =>
  `SELECT public.tenh_claim_tiktok_advertiser_disconnect(${literal(id)},${literal(business)},${literal(app)},${literal(operation)})->>'outcome'`;
const row = async id => JSON.parse(await sql(`SELECT row_to_json(t) FROM public.${table} t WHERE id=${literal(id)}`));
const uuidArray = ids => `ARRAY[${ids.map(literal).join(',')}]::uuid[]`;
const beginClosure = (tenant, operation, closing = [tenant.business], transferring = []) =>
  `SELECT public.tenh_begin_tiktok_advertiser_account_deletion(${literal(tenant.user)},${literal(operation)},${uuidArray(closing)},${uuidArray(transferring)})`;
async function tenant() {
  const result = { business: randomUUID(), member: randomUUID(), user: randomUUID() };
  await sql(`INSERT INTO public.businesses(id) VALUES (${literal(result.business)});
    INSERT INTO public.team_members(id,business_id,user_id,role,is_active) VALUES
      (${literal(result.member)},${literal(result.business)},${literal(result.user)},'owner',true)`);
  return result;
}
const pendingInsert = (tenant, id) => `INSERT INTO public.${table}(id,business_id,member_id,user_id,app_id,status,state_hash,state_expires_at)
  VALUES (${literal(id)},${literal(tenant.business)},${literal(tenant.member)},${literal(tenant.user)},${literal(app)},'pending',${literal(hash(id))},now()+interval '10 minutes')`;
const tenantSave = (tenant, id, token) => `SELECT public.tenh_save_tiktok_advertiser_grant(${literal(id)},${literal(tenant.business)},
  ${literal(tenant.member)},${literal(tenant.user)},${literal(app)},${literal(hash(token))},'v1.fixture.fixture.fixture',ARRAY['7001'],ARRAY['1'])`;
const waiting = application => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
  WHERE application_name=${literal(application)} AND wait_event_type='Lock')`).then(value => value === 't');
const idleTransaction = application => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
  WHERE application_name=${literal(application)} AND state='idle in transaction')`).then(value => value === 't');
const fence = tenant => sql(`SELECT coalesce(tiktok_advertiser_closure_operation_id::text,'none') FROM public.businesses WHERE id=${literal(tenant.business)}`);

// Small SQL adapter for the real DELETE handler, with an injectable local persistence fault.
function routeDatabase() {
  const db = { fail: () => false };
  db.rpc = async (name, args) => {
    assert.equal(name, "tenh_claim_tiktok_advertiser_disconnect");
    const data = await sql(service(`SELECT public.${name}(${literal(args.p_id)},${literal(args.p_business_id)},
      ${literal(args.p_app_id)},${literal(args.p_operation_id)})`));
    return { data: JSON.parse(data), error: null };
  };
  db.from = name => {
    assert.equal(name, table);
    const filters = []; let patch, columns = "*", single = false;
    const query = {
      select(value) { columns = value; return query; },
      update(value) { patch = value; return query; },
      eq(key, value) { filters.push(`${identifier(key)}=${literal(value)}`); return query; },
      not(key, op, value) { assert.equal(op, "is"); assert.equal(value, null); filters.push(`${identifier(key)} IS NOT NULL`); return query; },
      maybeSingle() { single = true; return execute(); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    async function execute() {
      if (patch && db.fail(patch)) return { data: null, error: { message: "Injected synthetic persistence failure" } };
      const selected = columns === "*" ? "*" : columns.split(",").map(identifier).join(",");
      const where = filters.join(" AND ") || "true";
      const statement = patch ? `UPDATE public.${table} SET ${Object.entries(patch)
        .map(([key, value]) => `${identifier(key)}=${literal(value)}`).join(",")} WHERE ${where} RETURNING ${selected}`
        : `SELECT ${selected} FROM public.${table} WHERE ${where}`;
      const data = JSON.parse(await sql(service(`WITH result AS (${statement}) SELECT coalesce(jsonb_agg(result),'[]') FROM result`)));
      return { data: single ? data[0] ?? null : data, error: null };
    }
    return query;
  };
  return db;
}

function disconnectFixture(options = {}) {
  const db = routeDatabase(), calls = [], logs = [], token = `synthetic-grant-${randomUUID()}`;
  const load = harness.loader({
    "next/server": { NextResponse: { json: (data, init = {}) => new Response(JSON.stringify(data), init) } },
    "@/lib/supabase/admin": { supabaseAdmin: db },
    "@/lib/auth/get-current-member": { getCurrentMember: async () => ({ success: true,
      user: { id: user }, member: { id: member, business_id: businessA } }) },
    "@/lib/auth/require-permission": { memberHasPermission: async () => true },
    "@/lib/subscription/get-business-subscription-access": { getBusinessSubscriptionAccess: async () => ({ locked: false }) },
  }, {
    Buffer, process: { env: { NODE_ENV: "production", TIKTOK_ADVERTISER_OAUTH_ENABLED: "true",
      FACEBOOK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), TIKTOK_ADVERTISER_APP_ID: app,
      TIKTOK_ADVERTISER_APP_SECRET: "synthetic-only", TIKTOK_ADVERTISER_TOKEN_MODE: "long_term",
      TIKTOK_ADVERTISER_AUTHORIZATION_URL: `https://business-api.tiktok.com/portal/auth?app_id=${app}&redirect_uri=${encodeURIComponent("https://app.tenhchat.com/api/tiktok/advertiser/oauth/callback")}` } },
    console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args), log: (...args) => logs.push(args) },
    fetch: async url => {
      calls.push(String(url)); assert.match(String(url), /\/oauth2\/revoke_token\/$/);
      if (options.timeout) throw new DOMException("Synthetic timeout", "TimeoutError");
      return new Response(JSON.stringify(options.payload ?? { code: 0, data: { app_id: app, advertiser_ids: ["7001"] } }));
    },
  });
  const request = { nextUrl: new URL("https://app.tenhchat.com/api/tiktok/advertiser/connections/fixture"),
    headers: new Headers({ Origin: "https://app.tenhchat.com" }) };
  return { db, calls, logs,
    async connect() {
      const id = await attempt(), encrypted = load("lib/channels/channel-token-crypto.ts").encryptChannelCredential(token);
      assert.equal(await sql(service(save(id, businessA, hash(token), encrypted))), "connected");
      return id;
    },
    disconnect: id => load("app/api/tiktok/advertiser/connections/[connectionId]/route.ts")
      .DELETE(request, { params: Promise.resolve({ connectionId: id }) }),
  };
}

test("advertiser PostgreSQL validation (explicit disposable cluster only)", { skip: !psql || !runId, timeout: 180_000 }, async t => {
  t.after(() => { for (const child of openSessions) child.kill(); });
  // This marker must be created by the separately approved disposable-cluster provisioner.
  assert.equal(await sql("SELECT current_database()"), database);
  assert.equal(await sql("SELECT run_id FROM public.tenh_validation_marker"), runId);
  assert.equal(await sql("SHOW listen_addresses"), "127.0.0.1");
  await sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE TABLE public.businesses(id uuid PRIMARY KEY);
  CREATE TABLE public.team_members(id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES public.businesses(id),
    user_id uuid, role text NOT NULL, is_active boolean NOT NULL, permissions jsonb NOT NULL DEFAULT '{}');
  INSERT INTO public.businesses VALUES (${literal(businessA)}),(${literal(businessB)});
  INSERT INTO public.team_members(id,business_id,user_id,role,is_active) VALUES
    (${literal(member)},${literal(businessA)},${literal(user)},'owner',true),
    (${literal(memberB)},${literal(businessB)},${literal(userB)},'owner',true);
  GRANT SELECT,UPDATE ON public.businesses TO service_role;
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.team_members TO service_role;`);

  await t.test("migration installs in isolation with actual lifecycle constraints", async () => {
    await sql(readFileSync(new URL("../db/proposals/20261007_tiktok_advertiser_oauth.sql", import.meta.url), "utf8"));
    assert.equal(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.${table}'::regclass`), "t");
    const id = await attempt();
    await denied(service(`UPDATE public.${table} SET status='connected' WHERE id=${literal(id)}`), "23514");
    await denied(service(`UPDATE public.${table} SET token_hash=${literal(hash("invalid"))} WHERE id=${literal(id)}`), "23514");
  });

  await t.test("actual table/RPC privileges deny browser roles and service-role deletion", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert.equal(await sql(`SELECT has_table_privilege(${literal(role)},'public.${table}',${literal(privilege)})`), "f");
      }
      await denied(`SET ROLE ${role}; SELECT * FROM public.${table}`, "42501");
      await denied(`SET ROLE ${role}; ${claim(randomUUID(), businessA, randomUUID())}`, "42501");
      await denied(`SET ROLE ${role}; ${save(randomUUID(), businessA, hash("denied"))}`, "42501");
    }
    for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
      assert.equal(await sql(`SELECT has_table_privilege('service_role','public.${table}',${literal(privilege)})`), "t");
    }
    assert.equal(await sql(`SELECT has_table_privilege('service_role','public.${table}','DELETE')`), "f");
    await denied(service(`DELETE FROM public.${table}`), "42501");
  });

  await t.test("RLS denies rows even with temporary SELECT permission", async () => {
    assert.equal(await sql(`BEGIN; GRANT SELECT ON public.${table} TO authenticated;
      SET LOCAL ROLE authenticated; SELECT count(*) FROM public.${table}; ROLLBACK;`), "0");
  });

  await t.test("tenant/member/user bindings and foreign disconnect claims are enforced", async () => {
    const id = await attempt();
    assert.equal(await sql(service(save(id, businessB, hash("foreign")))), "invalid_attempt");
    assert.equal(await sql(service(save(id, businessA, hash("foreign")).replace(literal(member), literal(randomUUID())))), "invalid_attempt");
    assert.equal(await sql(service(save(id, businessA, hash("foreign")).replace(literal(user), literal(randomUUID())))), "invalid_attempt");
    assert.equal(await sql(service(claim(id, businessB, randomUUID()))), "not_found");
    assert.equal((await row(id)).status, "exchanging");
  });

  for (const abortOwner of [false, true]) {
    await t.test(`competing tenant saves wait for the real advisory lock (${abortOwner ? "owner crash" : "commit"})`, async () => {
      const a = await attempt(), b = await attempt(businessB), fingerprint = hash(randomUUID());
      const ownerName = `tenh_adv_owner_${randomUUID()}`, contenderName = `tenh_adv_contender_${randomUUID()}`;
      const owner = session(undefined, ownerName);
      owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${save(a, businessA, fingerprint)}; SELECT 'LOCK_READY';\n`);
      await until(() => holdsAdvisoryLock(ownerName));
      const contender = session(service(save(b, businessB, fingerprint)), contenderName);
      await until(async () => (await sql(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid)
        WHERE a.application_name=${literal(contenderName)} AND l.locktype='advisory' AND NOT l.granted)`)) === "t");
      if (abortOwner) {
        assert.equal(await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=${literal(ownerName)}`), "t");
        owner.child.stdin.end();
      } else owner.child.stdin.end("COMMIT;\n");
      await owner.done;
      const result = await contender.done;
      assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, abortOwner ? "connected" : "conflict");
      assert.equal(await sql(`SELECT count(*) FROM public.${table} WHERE token_hash=${literal(fingerprint)}`), "1");
      assert.equal((await row(abortOwner ? b : a)).status, "connected");
    });
  }

  await t.test("concurrent disconnect claims wait then return one owner and one busy result", async () => {
    const id = await attempt(), fingerprint = hash(randomUUID()), operation = randomUUID();
    await sql(service(save(id, businessA, fingerprint)));
    const ownerName = `tenh_adv_claim_${randomUUID()}`, contenderName = `tenh_adv_duplicate_${randomUUID()}`;
    const owner = session(undefined, ownerName);
    owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${claim(id, businessA, operation)}; SELECT 'LOCK_READY';\n`);
    await until(() => holdsAdvisoryLock(ownerName));
    const duplicate = session(service(claim(id, businessA, randomUUID())), contenderName);
    await until(async () => (await sql(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid)
      WHERE a.application_name=${literal(contenderName)} AND l.locktype='advisory' AND NOT l.granted)`)) === "t");
    const late = await attempt(businessB), saveName = `tenh_adv_save_${randomUUID()}`;
    const competingSave = session(service(save(late, businessB, fingerprint)), saveName);
    await until(async () => (await sql(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid)
      WHERE a.application_name=${literal(saveName)} AND l.locktype='advisory' AND NOT l.granted)`)) === "t");
    owner.child.stdin.end("COMMIT;\n"); await owner.done;
    assert.equal((await duplicate.done).stdout, "busy");
    assert.equal((await competingSave.done).stdout, "conflict");
    assert.equal((await row(id)).revoke_operation_id, operation);
  });

  await t.test("real DELETE recovers remote success then local failure from the persisted receipt", async () => {
    const fixture = disconnectFixture(), id = await fixture.connect();
    fixture.db.fail = patch => patch.status === "disconnected";
    assert.equal((await fixture.disconnect(id)).status, 503);
    const pending = await row(id); assert.ok(pending.revoke_confirmed_at);
    fixture.db.fail = () => false;
    assert.equal((await fixture.disconnect(id)).status, 200);
    const disconnected = await row(id);
    assert.equal(disconnected.status, "disconnected"); assert.equal(disconnected.access_token_encrypted, null);
    assert.equal(disconnected.token_hash, pending.token_hash); assert.equal(disconnected.revoke_operation_id, pending.revoke_operation_id);
    assert.equal(fixture.calls.length, 1); assert.equal(fixture.logs.length, 0);
    const late = await attempt(businessB);
    assert.equal(await sql(service(save(late, businessB, disconnected.token_hash))), "conflict");
    await denied(`DELETE FROM public.businesses WHERE id=${literal(businessA)}`, "23503");
  });

  await t.test("real DELETE without a persisted receipt fences retries despite provider success", async () => {
    const fixture = disconnectFixture(), id = await fixture.connect();
    fixture.db.fail = patch => Boolean(patch.revoke_confirmed_at);
    assert.equal((await fixture.disconnect(id)).status, 503);
    const pending = await row(id); assert.equal(pending.revoke_confirmed_at, null); assert.ok(pending.access_token_encrypted);
    fixture.db.fail = () => false;
    assert.equal((await fixture.disconnect(id)).status, 409);
    assert.equal((await row(id)).revoke_operation_id, pending.revoke_operation_id);
    assert.equal(fixture.calls.length, 1); assert.equal(fixture.logs.length, 0);
  });

  for (const options of [{ timeout: true }, { payload: { code: 40105, message: "Synthetic ambiguous error" } }]) {
    await t.test(`real DELETE preserves ownership on ambiguous provider outcome (${Object.keys(options)[0]})`, async () => {
      const fixture = disconnectFixture(options), id = await fixture.connect();
      assert.equal((await fixture.disconnect(id)).status, 503);
      assert.equal((await row(id)).revoke_confirmed_at, null);
      assert.equal((await fixture.disconnect(id)).status, 409);
      assert.equal(fixture.calls.length, 1); assert.equal(fixture.logs.length, 0);
    });
  }

  await t.test('committed closure fences a concurrent attempt, save and only its own tenant', async () => {
    const own = await tenant(), foreign = await tenant(), operation = randomUUID();
    const ownerName = `closure_${randomUUID()}`, contenderName = `attempt_${randomUUID()}`;
    const owner = session(undefined, ownerName);
    owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${beginClosure(own, operation)};\n`);
    await until(() => idleTransaction(ownerName));
    const contender = session(service(pendingInsert(own, randomUUID())), contenderName);
    await until(() => waiting(contenderName));
    owner.child.stdin.end('COMMIT;\n'); assert.equal((await owner.done).code, 0);
    const attempted = await contender.done; assert.notEqual(attempted.code, 0); assert.match(attempted.stderr, /23514/);
    assert.equal(await fence(own), operation);
    assert.equal(await sql(service(tenantSave(own, randomUUID(), 'late-grant'))), 'closure_in_progress');
    const id = await attempt(foreign.business, foreign.member, foreign.user);
    assert.equal(await sql(service(tenantSave(foreign, id, 'foreign-grant'))), 'connected');
    assert.equal(await fence(foreign), 'none');
  });

  await t.test('attempt creation wins the business lock and closure then blocks without a fence', async () => {
    const own = await tenant(), id = randomUUID(), ownerName = `attempt_${randomUUID()}`, contenderName = `closure_${randomUUID()}`;
    const owner = session(undefined, ownerName);
    owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${pendingInsert(own, id)};\n`);
    await until(() => idleTransaction(ownerName));
    const contender = session(service(beginClosure(own, randomUUID())), contenderName);
    await until(() => waiting(contenderName));
    owner.child.stdin.end('COMMIT;\n'); assert.equal((await owner.done).code, 0);
    const result = await contender.done; assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).outcome, 'blocked'); assert.equal(await fence(own), 'none');
    assert.equal((await row(id)).status, 'pending');
  });

  await t.test('mock provider exchange remains owned while closure refuses its in-flight result', async () => {
    const own = await tenant(), id = randomUUID();
    await sql(service(pendingInsert(own, id)));
    await sql(service(`UPDATE public.${table} SET status='exchanging',state_hash=null,state_expires_at=null WHERE id=${literal(id)}`));
    let finishProvider; const provider = new Promise(resolve => { finishProvider = resolve; });
    const saveLater = provider.then(token => sql(service(tenantSave(own, id, token))));
    assert.equal(JSON.parse(await sql(service(beginClosure(own, randomUUID())))).outcome, 'blocked');
    finishProvider('synthetic-delayed-provider-grant');
    assert.equal(await saveLater, 'connected'); assert.equal(await fence(own), 'none');
    assert.equal((await row(id)).business_id, own.business);
  });

  await t.test('uncommitted save cannot allow closure to retire unresolved ownership', async () => {
    const own = await tenant(), id = await attempt(own.business, own.member, own.user), ownerName = `saving_${randomUUID()}`;
    const owner = session(undefined, ownerName);
    owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${tenantSave(own,id,'saving-grant')};\n`);
    await until(() => holdsAdvisoryLock(ownerName));
    assert.equal(JSON.parse(await sql(service(beginClosure(own,randomUUID())))).outcome, 'blocked');
    owner.child.stdin.end('COMMIT;\n'); assert.equal((await owner.done).code, 0);
    assert.equal((await row(id)).status, 'connected'); assert.equal(await fence(own), 'none');
  });

  await t.test('last Owner removal first prevents a later concurrent attempt from starting', async () => {
    const own = await tenant(), ownerName = `remove_${randomUUID()}`, contenderName = `attempt_${randomUUID()}`;
    const owner = session(undefined,ownerName);
    owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; UPDATE public.team_members SET is_active=false WHERE id=${literal(own.member)};\n`);
    await until(() => idleTransaction(ownerName));
    const contender = session(service(pendingInsert(own,randomUUID())),contenderName);
    await until(() => waiting(contenderName));
    owner.child.stdin.end('COMMIT;\n'); assert.equal((await owner.done).code,0);
    const result = await contender.done; assert.notEqual(result.code,0); assert.match(result.stderr,/23514/);
    assert.equal(await sql(`SELECT count(*) FROM public.${table} WHERE business_id=${literal(own.business)}`),'0');
  });

  await t.test('attempt first prevents concurrent last Owner removal before any provider work', async () => {
    const own = await tenant(), ownerName = `attempt_${randomUUID()}`, contenderName = `remove_${randomUUID()}`;
    const owner = session(undefined,ownerName);
    owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${pendingInsert(own,randomUUID())};\n`);
    await until(() => idleTransaction(ownerName));
    const contender = session(service(`UPDATE public.team_members SET is_active=false WHERE id=${literal(own.member)}`),contenderName);
    await until(() => waiting(contenderName));
    owner.child.stdin.end('COMMIT;\n'); assert.equal((await owner.done).code,0);
    const result = await contender.done; assert.notEqual(result.code,0); assert.match(result.stderr,/23514/);
    assert.equal(await sql(`SELECT is_active FROM public.team_members WHERE id=${literal(own.member)}`),'t');
  });

  await t.test('direct Owner removal paths reject unresolved work; authorized transfer remains usable', async () => {
    const own = await tenant(), foreign = await tenant(), id = await attempt(own.business,own.member,own.user);
    assert.equal(await sql(service(tenantSave(own,id,'transfer-grant'))),'connected');
    for (const statement of [
      `DELETE FROM public.team_members WHERE id=${literal(own.member)}`,
      `UPDATE public.team_members SET is_active=false WHERE id=${literal(own.member)}`,
      `UPDATE public.team_members SET role='agent' WHERE id=${literal(own.member)}`,
      `UPDATE public.team_members SET user_id=null WHERE id=${literal(own.member)}`,
      `UPDATE public.team_members SET business_id=${literal(foreign.business)} WHERE id=${literal(own.member)}`,
    ]) await denied(service(statement),'23514');
    const replacement = randomUUID();
    await sql(`INSERT INTO public.team_members(id,business_id,user_id,role,is_active) VALUES
      (${literal(replacement)},${literal(own.business)},${literal(randomUUID())},'agent',true)`);
    await sql(service(`UPDATE public.team_members SET role='owner' WHERE id=${literal(replacement)};
      UPDATE public.team_members SET is_active=false WHERE id=${literal(own.member)}`));
    assert.equal((await row(id)).token_hash,hash('transfer-grant'));
    assert.equal(await sql(`SELECT is_active FROM public.team_members WHERE id=${literal(replacement)}`),'t');
  });

  await t.test('simultaneous Owner removals serialize and retain one authorized Owner', async () => {
    const own = await tenant(), id = await attempt(own.business,own.member,own.user), replacement = randomUUID();
    await sql(`INSERT INTO public.team_members(id,business_id,user_id,role,is_active) VALUES
      (${literal(replacement)},${literal(own.business)},${literal(randomUUID())},'owner',true)`);
    const ownerName = `remove_${randomUUID()}`, contenderName = `remove_${randomUUID()}`;
    const owner = session(undefined,ownerName);
    owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; UPDATE public.team_members SET is_active=false WHERE id=${literal(own.member)};\n`);
    await until(() => idleTransaction(ownerName));
    const contender = session(service(`UPDATE public.team_members SET is_active=false WHERE id=${literal(replacement)}`),contenderName);
    await until(() => waiting(contenderName));
    owner.child.stdin.end('COMMIT;\n'); assert.equal((await owner.done).code,0);
    const result = await contender.done; assert.notEqual(result.code,0); assert.match(result.stderr,/23514/);
    assert.equal(await sql(`SELECT count(*) FROM public.team_members WHERE business_id=${literal(own.business)} AND role='owner' AND is_active`),'1');
    assert.equal((await row(id)).status,'exchanging');
  });

  await t.test('interrupted reservation rolls back; committed fences survive crashes and reject takeover', async () => {
    const own = await tenant(), operation = randomUUID(), ownerName = `interrupted_${randomUUID()}`;
    const owner = session(undefined,ownerName);
    owner.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${beginClosure(own,operation)};\n`);
    await until(() => idleTransaction(ownerName));
    await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=${literal(ownerName)}`);
    owner.child.stdin.end(); await owner.done;
    assert.equal(await fence(own),'none');
    assert.equal(JSON.parse(await sql(service(beginClosure(own,operation)))).outcome,'reserved');
    assert.equal(JSON.parse(await sql(service(beginClosure(own,randomUUID())))).outcome,'busy');
    assert.equal(JSON.parse(await sql(service(beginClosure(own,operation)))).outcome,'reserved');
    await denied(service(pendingInsert(own,randomUUID())),'23514');
    assert.equal(await fence(own),operation);
    await denied(service(`UPDATE public.businesses SET tiktok_advertiser_closure_operation_id=null,tiktok_advertiser_closure_user_id=null WHERE id=${literal(own.business)}`),'23514');
    await sql('GRANT SELECT ON public.businesses TO authenticated; GRANT UPDATE(tiktok_advertiser_closure_operation_id,tiktok_advertiser_closure_user_id) ON public.businesses TO authenticated');
    await denied(`SET ROLE authenticated; UPDATE public.businesses SET tiktok_advertiser_closure_operation_id=null,tiktok_advertiser_closure_user_id=null WHERE id=${literal(own.business)}`,'42501');
    await sql('REVOKE SELECT,UPDATE(tiktok_advertiser_closure_operation_id,tiktok_advertiser_closure_user_id) ON public.businesses FROM authenticated');
    assert.equal(await fence(own),operation);
  });

  await t.test('multi-workspace reservation is atomic and rejects foreign closure/transfer scope', async () => {
    const own = await tenant(), additional = await tenant(), foreign = await tenant();
    await sql(`UPDATE public.team_members SET user_id=${literal(own.user)} WHERE id=${literal(additional.member)}`);
    additional.user = own.user;
    await attempt(additional.business,additional.member,additional.user);
    const result = JSON.parse(await sql(service(beginClosure(own,randomUUID(),[own.business,additional.business]))));
    assert.equal(result.outcome,'blocked'); assert.equal(await fence(own),'none'); assert.equal(await fence(additional),'none');
    assert.equal(JSON.parse(await sql(service(beginClosure(own,randomUUID(),[foreign.business])))).outcome,'invalid_scope');
    assert.equal(JSON.parse(await sql(service(beginClosure(own,randomUUID(),[],[foreign.business])))).outcome,'invalid_scope');
    assert.equal(await fence(foreign),'none');
    for (const role of ['anon','authenticated']) await denied(`SET ROLE ${role}; ${beginClosure(own,randomUUID())}`,'42501');
  });

  await t.test('exchange commencement rechecks membership after a successful Owner transfer', async () => {
    const own = await tenant(), id = randomUUID(), replacement = randomUUID();
    await sql(service(pendingInsert(own,id)));
    await sql(`INSERT INTO public.team_members(id,business_id,user_id,role,is_active) VALUES
      (${literal(replacement)},${literal(own.business)},${literal(randomUUID())},'owner',true)`);
    await sql(service(`UPDATE public.team_members SET is_active=false WHERE id=${literal(own.member)}`));
    await denied(service(`UPDATE public.${table} SET status='exchanging',state_hash=null,state_expires_at=null WHERE id=${literal(id)}`),'23514');
    assert.equal((await row(id)).status,'pending');
    await denied(service(pendingInsert({ ...own, member: replacement },randomUUID())),'23514');
  });

  await t.test('disconnected reservations allow access closure but still restrict physical business deletion', async () => {
    const own = await tenant(), id = await attempt(own.business,own.member,own.user), operation = randomUUID();
    assert.equal(await sql(service(tenantSave(own,id,'retained-grant'))),'connected');
    assert.equal(await sql(service(claim(id,own.business,operation))),'claimed');
    // Synthetic provider success receipt; no remote call is made.
    await sql(service(`UPDATE public.${table} SET revoke_confirmed_at=clock_timestamp() WHERE id=${literal(id)};
      UPDATE public.${table} SET status='disconnected',access_token_encrypted=null,disconnected_at=clock_timestamp() WHERE id=${literal(id)}`));
    const before = await row(id);
    assert.equal(JSON.parse(await sql(service(beginClosure(own,randomUUID())))).outcome,'reserved');
    await sql(service(`DELETE FROM public.team_members WHERE id=${literal(own.member)}`));
    await denied(`DELETE FROM public.businesses WHERE id=${literal(own.business)}`,'23503');
    assert.equal((await row(id)).token_hash,before.token_hash);
    assert.equal((await row(id)).revoke_operation_id,before.revoke_operation_id);
    await denied(service(`DELETE FROM public.${table} WHERE id=${literal(id)}`),'42501');
  });
});
