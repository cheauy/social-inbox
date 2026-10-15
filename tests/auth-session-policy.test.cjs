/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function load(file, admin, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(source, { exports: loaded.exports, module: loaded, Buffer, process, Response, URL,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : name === "server-only" ? {} : name === "@/lib/supabase/admin" ? { supabaseAdmin: admin } : require(name),
  }, { filename: file });
  return loaded.exports;
}

test("verified claims, trusted recent timestamps, recovery denial and unavailable DB fail closed", async () => {
  const uid = "10000000-0000-4000-8000-000000000001";
  const sid = "20000000-0000-4000-8000-000000000001";
  const now = "2026-10-15T10:00:00.000Z";
  let row = { status: "allowed", kind: "normal", authenticated_at: now, server_time: now,
    expires_at: "2026-10-16T10:00:00.000Z", remembered: false };
  let fail = false;
  let claimsError = null, sessionError = null, claimsThrows = false, sessionThrows = false;
  const claims = { sub: uid, session_id: sid, aal: "aal2", amr: [{ method: "totp", timestamp: Date.parse(now) / 1000 - 30 }] };
  const admin = {
    rpc: async () => ({ data: row, error: fail ? { code: "offline" } : null }),
    auth: { getClaims: async () => { if (claimsThrows) throw new Error("Provider network failed"); return { data: { claims }, error: claimsError }; } },
  };
  const client = { auth: {
    getSession: async () => { if (sessionThrows) throw new Error("Provider network failed"); return { data: { session: { access_token: "opaque-not-persisted" } }, error: sessionError }; },
    getClaims: async () => { throw new Error("Wrapped client getClaims must not be called"); },
  } };
  const api = load("lib/auth/session-policy.ts", admin);
  const result = await api.checkSessionPolicy(client, { id: uid });
  assert.equal(result.allowed, true);
  assert.equal(result.recentAuthentication, true);
  assert.equal(result.recentMfa, true);
  for (const error of [{ status: 503 }, { status: 429 }, { name: "AuthRetryableFetchError" }, { name: "AuthUnknownError" }]) {
    claimsError = error;
    assert.equal((await api.checkSessionPolicy(client, { id: uid })).status, 503);
    claimsError = null; sessionError = error;
    assert.equal((await api.checkSessionPolicy(client, { id: uid })).status, 503);
    sessionError = null;
  }
  claimsError = { status: 401 };
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).status, 401);
  claimsError = null; sessionError = { status: 400 };
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).status, 401);
  sessionError = null; claimsThrows = true;
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).status, 503);
  claimsThrows = false; sessionThrows = true;
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).status, 503);
  sessionThrows = false;
  for (const method of ["mfa/totp", "mfa/phone", "mfa/webauthn"]) {
    claims.amr[0].method = method;
    assert.equal((await api.checkSessionPolicy(client, { id: uid })).recentMfa, true);
  }
  claims.amr[0].method = "password";
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).recentMfa, false);
  claims.amr[0].method = "totp";
  row = { ...row, authenticated_at: "2026-10-15T09:00:00.000Z" };
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).recentAuthentication, false);
  claims.amr[0].timestamp += 300;
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).recentMfa, false);
  row.kind = "recovery";
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).status, 403);
  assert.equal((await api.checkSessionPolicy(client, { id: uid }, { allowRecovery: true })).allowed, true);
  claims.sub = "another-user";
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).reason, "invalid-session");
  claims.sub = uid;
  fail = true;
  assert.equal((await api.checkSessionPolicy(client, { id: uid })).status, 503);
});

test("admin policy API requires exact origin, mandatory fresh MFA and records verified actor", async () => {
  const original = process.env.TENH_APP_ORIGIN;
  process.env.TENH_APP_ORIGIN = "https://app.test";
  const uid = "10000000-0000-4000-8000-000000000001";
  let identity = { success: true, user: { id: uid } };
  let policy = { allowed: true, aal: "aal1", recentMfa: false };
  let limited = { allowed: true, retryAfterSeconds: 0 };
  let offline = false;
  const writes = [];
  const admin = { rpc: async (name, args) => {
    if (name === "tenh_set_session_policy_settings") writes.push(args);
    return { data: { remember_days: args?.p_remember_days ?? 30, updated_at: "2026-10-15T10:00:00Z" }, error: offline ? { message: "private database failure" } : null };
  } };
  const mutation = load("lib/auth/mutation-request.ts", {});
  const route = load("app/api/tenh-admin/login-sessions/route.ts", admin, {
    "@/lib/admin/tenh-admin-auth": { getTenhAdminIdentityUser: async () => identity },
    "@/lib/auth/mutation-request": mutation,
    "@/lib/auth/rate-limit": { consumeAuthRateLimit: async () => limited },
    "@/lib/auth/session-policy": { checkSessionPolicy: async () => policy },
    "@/lib/supabase/server": { createClient: async () => ({}) },
  });
  const request = (body, origin = "https://app.test") => new Request("https://app.test/api/tenh-admin/login-sessions", {
    method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await (await route.GET()).json()).requiresMfa, true);
    assert.equal((await route.PATCH(request({ rememberDays: 30 }, "https://attacker.test"))).status, 403);
    assert.equal((await (await route.PATCH(request({ rememberDays: 30 }))).json()).code, "mfa_required");
    policy = { allowed: true, aal: "aal2", recentMfa: false };
    assert.equal((await (await route.PATCH(request({ rememberDays: 30 }))).json()).code, "recent_mfa_required");
    assert.equal(writes.length, 0);
    policy.recentMfa = true;
    for (const rememberDays of [0, 91, 1.5, "30", null]) {
      assert.equal((await route.PATCH(request({ rememberDays }))).status, 400);
    }
    const saved = await route.PATCH(request({ rememberDays: 90, actorUserId: "attacker" }));
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).rememberDays, 90);
    assert.equal(writes[0].p_actor_user_id, uid);
    assert.equal(writes[0].p_remember_days, 90);
    limited = { allowed: false, retryAfterSeconds: 120, unavailable: true };
    const unavailable = await route.PATCH(request({ rememberDays: 1 }));
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("retry-after"), "120");
    limited = { allowed: true, retryAfterSeconds: 0 };
    offline = true;
    const failed = await route.PATCH(request({ rememberDays: 1 }));
    assert.equal(failed.status, 503);
    assert.ok(!JSON.stringify(await failed.json()).includes("private database failure"));
    identity = { success: false, status: 403, code: "identity_mismatch", error: "Forbidden" };
    assert.equal((await route.GET()).status, 403);
  } finally {
    if (original === undefined) delete process.env.TENH_APP_ORIGIN; else process.env.TENH_APP_ORIGIN = original;
  }
});

test("distributed limiter hashes identities, ignores untrusted IP headers, and fails closed", async () => {
  const saved = { secret: process.env.TENH_AUTH_RATE_LIMIT_SECRET, header: process.env.TENH_AUTH_TRUSTED_IP_HEADER };
  process.env.TENH_AUTH_RATE_LIMIT_SECRET = "isolated-test-secret";
  delete process.env.TENH_AUTH_TRUSTED_IP_HEADER;
  const calls = [];
  let offline = false;
  const api = load("lib/auth/rate-limit.ts", { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: offline ? null : { allowed: true, retry_after_seconds: 0 }, error: offline ? {} : null };
  } });
  try {
    const request = ip => new Request("https://example.test/api/auth/login", { headers: { "x-forwarded-for": ip } });
    assert.equal((await api.consumeAuthRateLimit(request("1.1.1.1"), "login", "User@Example.com")).allowed, true);
    await api.consumeAuthRateLimit(request("8.8.8.8"), "login", " user@example.com ");
    assert.equal(calls[0].args.p_ip_hash, calls[1].args.p_ip_hash);
    assert.equal(calls[0].args.p_identity_hash, calls[1].args.p_identity_hash);
    assert.match(calls[0].args.p_identity_hash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(calls).includes("example.com"));
    process.env.TENH_AUTH_TRUSTED_IP_HEADER = "x-forwarded-for";
    await api.consumeAuthRateLimit(request("8.8.8.8"), "login", "user@example.com");
    assert.notEqual(calls[1].args.p_ip_hash, calls[2].args.p_ip_hash);
    offline = true;
    const result = await api.consumeAuthRateLimit(request("8.8.8.8"), "login");
    assert.equal(result.allowed, false);
    assert.equal(result.unavailable, true);
  } finally {
    for (const [key, original] of [["TENH_AUTH_RATE_LIMIT_SECRET", saved.secret], ["TENH_AUTH_TRUSTED_IP_HEADER", saved.header]]) {
      if (original === undefined) delete process.env[key]; else process.env[key] = original;
    }
  }
});
