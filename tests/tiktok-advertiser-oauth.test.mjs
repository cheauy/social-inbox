import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import harness from "./tenh-seven/harness.cjs";

const { loader, database } = harness;
const TABLE = "tiktok_advertiser_connections";
const ORIGIN = "https://app.tenhchat.com";
const CALLBACK = "/api/tiktok/advertiser/oauth/callback";
const COOKIE = "tenh_tiktok_advertiser_oauth_state";
const TOKEN = "fixture-advertiser-access-token";
const CONNECTION = "app/api/tiktok/advertiser/connections/[connectionId]/route.ts";
const OAUTH = "lib/tiktok/advertiser-oauth.ts";
const clone = value => JSON.parse(JSON.stringify(value));

// Model the proposed RPC transactions; these tests do not execute PostgreSQL/RLS.
function advertiserDatabase() {
  const db = database({ [TABLE]: [] }), locks = new Map();
  db.rpc = async (name, args) => {
    db.history.push({ table: TABLE, op: "rpc", name, args: clone(args) });
    const failure = db.failures.find(f => f.op === "rpc" && (!f.name || f.name === name));
    if (failure) {
      if (failure.once) db.failures.splice(db.failures.indexOf(failure), 1);
      return { data: null, error: { message: "private-storage-error" } };
    }
    const target = db.tables[TABLE]?.find(r => r.id === args.p_id && r.business_id === args.p_business_id && r.app_id === args.p_app_id);
    const key = args.p_app_id + ":" + (args.p_token_hash ?? target?.token_hash);
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    locks.set(key, current);
    await previous;
    try {
      if (!db.tables[TABLE]) return { data: null, error: { code: "42P01" } };
      if (name === "tenh_save_tiktok_advertiser_grant") {
        if (!target || target.member_id !== args.p_member_id || target.user_id !== args.p_user_id) return { data: "invalid_attempt", error: null };
        const owner = db.tables[TABLE].find(r => r.app_id === args.p_app_id && r.token_hash === args.p_token_hash);
        if (owner) return { data: owner.id === target.id && owner.status === "connected" ? "connected" : "conflict", error: null };
        const saved = await db.from(TABLE).update({ status: "connected", access_token_encrypted: args.p_encrypted,
          token_hash: args.p_token_hash, advertiser_ids: args.p_advertiser_ids, scopes: args.p_scopes, connected_at: new Date().toISOString() })
          .eq("id", args.p_id).eq("business_id", args.p_business_id).eq("member_id", args.p_member_id)
          .eq("user_id", args.p_user_id).eq("app_id", args.p_app_id).eq("status", "exchanging").select("id").maybeSingle();
        return { data: saved.data ? "connected" : "invalid_attempt", error: saved.error };
      }
      assert.equal(name, "tenh_claim_tiktok_advertiser_disconnect");
      if (!target) return { data: { outcome: "not_found" }, error: null };
      if (target.status === "disconnected") return { data: { outcome: "disconnected" }, error: null };
      if (target.status === "revocation_pending") return { data: target.revoke_confirmed_at ? {
        outcome: "confirmed", operation_id: target.revoke_operation_id, token_hash: target.token_hash,
      } : { outcome: "busy" }, error: null };
      if (target.status !== "connected") return { data: { outcome: "not_ready" }, error: null };
      const claimed = await db.from(TABLE).update({ status: "revocation_pending", revoke_operation_id: args.p_operation_id,
        revoke_started_at: new Date().toISOString() }).eq("id", args.p_id).eq("business_id", args.p_business_id)
        .eq("app_id", args.p_app_id).eq("status", "connected").select("id").maybeSingle();
      return { data: claimed.data ? { outcome: "claimed", operation_id: args.p_operation_id,
        token_hash: target.token_hash, access_token_encrypted: target.access_token_encrypted } : null, error: claimed.error };
    } finally {
      release();
      if (locks.get(key) === current) locks.delete(key);
    }
  };
  return db;
}

function setup(options = {}) {
  const db = options.db ?? advertiserDatabase(), calls = [], cookies = [], logs = [];
  let authCalls = 0;
  const member = { id: "member-1", user_id: "user-1", business_id: "workspace-1", role: "owner", ...options.member };
  const env = { NODE_ENV: "production", FACEBOOK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    TIKTOK_ADVERTISER_APP_ID: "123456", TIKTOK_ADVERTISER_APP_SECRET: "fixture-app-secret",
    TIKTOK_ADVERTISER_AUTHORIZATION_URL: `https://business-api.tiktok.com/portal/auth?app_id=123456&redirect_uri=${encodeURIComponent(ORIGIN + CALLBACK)}`,
    TIKTOK_ADVERTISER_TOKEN_MODE: "long_term", ...(options.enabled ? { TIKTOK_ADVERTISER_OAUTH_ENABLED: "true" } : {}), ...options.env };
  function response(value, init) {
    const result = new Response(value, init);
    result.cookies = { set: (...args) => cookies.push(args) };
    return result;
  }
  const load = loader({
    "next/server": { NextResponse: {
      json: (data, init = {}) => response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...init.headers } }),
      redirect: (url, status = 307) => response(null, { status, headers: { Location: String(url) } }),
    } },
    "@/lib/supabase/admin": { supabaseAdmin: db },
    "@/lib/auth/get-current-member": { getCurrentMember: async strict => {
      authCalls++; assert.equal(strict, true);
      if (options.authThrow) throw new Error("private-auth-detail");
      return options.unauthorized ? { success: false } : { success: true, member, user: { id: member.user_id } };
    } },
    "@/lib/auth/require-permission": { memberHasPermission: async (_member, permission, level) => {
      assert.equal(permission, "channels"); assert.equal(level, "manage"); return !options.permissionDenied;
    } },
    "@/lib/subscription/get-business-subscription-access": { getBusinessSubscriptionAccess: async id => {
      assert.equal(id, member.business_id);
      if (options.planThrow) throw new Error("private-database-detail");
      return { locked: Boolean(options.locked) };
    } },
  }, { Buffer, process: { env }, ...(options.jsonWithoutSource ? { JSON: { ...JSON,
    parse: (text, reviver) => JSON.parse(text, reviver ? (key, value) => reviver(key, value) : undefined), stringify: JSON.stringify } } : {}),
    console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args), log: (...args) => logs.push(args) },
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      if (options.networkThrow) throw new Error("private-provider-token-or-code");
      if (String(url).includes("revoke_token")) {
        if (options.revokePause) await options.revokePause();
        if (options.revokeTimeout) throw new DOMException("private-provider-timeout", "TimeoutError");
        if (options.revokeThrow) throw new Error("private-revocation-detail");
        if (options.revokeRaw !== undefined) return new Response(options.revokeRaw, { status: options.revokeStatus ?? 200 });
        return new Response(JSON.stringify({ code: 0, data: { app_id: "123456", advertiser_ids: ["7001", "7002"] }, ...options.revokePayload }));
      }
      if (options.fetchPause) await options.fetchPause();
      const raw = options.rawPayload ?? JSON.stringify({ code: 0, data: {
        access_token: TOKEN, advertiser_ids: ["7001", "7002", "7001"], scope: [1, 2], ...options.grant }, ...options.payload });
      return new Response(raw, { status: options.providerStatus ?? 200 });
    },
  });
  const request = (path = CALLBACK, query = {}, cookie, headers = {}, origin = ORIGIN) => {
    const nextUrl = new URL(path, origin);
    for (const [key, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : [value]) nextUrl.searchParams.append(key, item);
    return { url: nextUrl.toString(), nextUrl, headers: new Headers({ Origin: origin, ...headers }),
      cookies: { get: name => name === COOKIE && cookie ? { value: cookie } : undefined } };
  };
  const start = (headers = {}, origin = ORIGIN) => load("app/api/tiktok/advertiser/oauth/connect/route.ts")
    .POST(request("/api/tiktok/advertiser/oauth/connect", {}, undefined, headers, origin));
  const callback = (query, cookie, origin = ORIGIN) => load("app/api/tiktok/advertiser/oauth/callback/route.ts").GET(request(CALLBACK, query, cookie, {}, origin));
  async function begin() {
    const result = await start(); assert.equal(result.status, 303);
    const location = new URL(result.headers.get("location"));
    return { state: location.searchParams.get("state"), cookie: cookies.at(-1)[1], id: db.tables[TABLE].at(-1).id };
  }
  const context = id => ({ params: Promise.resolve({ connectionId: id }) });
  const get = id => load(CONNECTION).GET(request(), context(id));
  const disconnect = (id, headers = {}) => load(CONNECTION).DELETE(request(CALLBACK, {}, undefined, headers), context(id));
  return { db, load, env, member, calls, cookies, logs, start, callback, begin, get, disconnect, request, authCalls: () => authCalls };
}

function reason(response) { return new URL(response.headers.get("location")).searchParams.get("reason"); }
function assertPrivate(h, response) {
  assert.doesNotMatch(response.headers.get("location") ?? "", /fixture-|auth_code|private-|secret|state=/);
  assert.equal(h.logs.length, 0);
}

test("advertiser routes are disabled by default before auth, storage, or provider calls", async () => {
  const h = setup();
  assert.equal((await h.start()).status, 503);
  const callback = await h.callback({ auth_code: "private-code" });
  assert.equal(reason(callback), "integration_disabled");
  assert.equal((await h.get("12345678-1234-1234-1234-123456789012")).status, 503);
  assert.equal((await h.disconnect("12345678-1234-1234-1234-123456789012")).status, 503);
  assert.equal(h.authCalls(), 0); assert.equal(h.db.history.length, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.cookies.at(-1)[0], COOKIE); assert.equal(h.cookies.at(-1)[2].path, CALLBACK);
  assertPrivate(h, callback);
});

test("same-origin start stores only a tenant-bound nonce hash and uses a real configured provider link", async () => {
  const h = setup({ enabled: true }); const a = await h.begin();
  const row = h.db.tables[TABLE][0];
  assert.equal(row.business_id, h.member.business_id); assert.equal(row.user_id, h.member.user_id);
  assert.equal(row.member_id, h.member.id); assert.equal(row.status, "pending");
  assert.equal(row.state_hash, h.load(OAUTH).advertiserHash(a.state)); assert.notEqual(row.state_hash, a.state);
  assert.doesNotMatch(a.cookie, /workspace-1|member-1|user-1/);
  assert.equal(h.calls.length, 0);
  const [, , settings] = h.cookies[0];
  assert.deepEqual(clone(settings), { httpOnly: true, secure: true, sameSite: "lax", path: CALLBACK, maxAge: 600 });
});

for (const headers of [{ Origin: "https://evil.example" }, { Origin: "" }, { "sec-fetch-site": "cross-site" }]) {
  test(`cross-site start and disconnect fail before writes: ${JSON.stringify(headers)}`, async () => {
    const h = setup({ enabled: true });
    assert.equal((await h.start(headers)).status, 403);
    assert.equal((await h.disconnect("12345678-1234-1234-1234-123456789012", headers)).status, 403);
    assert.equal(h.db.history.length, 0); assert.equal(h.calls.length, 0);
  });
}

for (const options of [{ unauthorized: true }, { permissionDenied: true }, { locked: true }, { authThrow: true }, { planThrow: true }]) {
  test(`start/callback fail closed on access: ${JSON.stringify(options)}`, async () => {
    const h = setup({ enabled: true, ...options });
    assert.ok((await h.start()).status >= 400);
    const result = await h.callback({ state: "fixture", auth_code: "private-code" });
    assert.notEqual(reason(result), "authorized"); assertPrivate(h, result);
    assert.equal(h.db.history.length, 0); assert.equal(h.calls.length, 0);
  });
}

for (const env of [
  { TIKTOK_ADVERTISER_APP_ID: "" }, { TIKTOK_ADVERTISER_APP_SECRET: "" },
  { TIKTOK_ADVERTISER_TOKEN_MODE: undefined }, { TIKTOK_ADVERTISER_TOKEN_MODE: "short_term" },
  { TIKTOK_ADVERTISER_AUTHORIZATION_URL: "https://evil.example/portal/auth" },
  { TIKTOK_ADVERTISER_AUTHORIZATION_URL: "https://business-api.tiktok.com/portal/docs" },
  { TIKTOK_ADVERTISER_AUTHORIZATION_URL: `https://business-api.tiktok.com/portal/auth?app_id=123456&app_id=other&redirect_uri=${encodeURIComponent(ORIGIN + CALLBACK)}` },
  { TIKTOK_ADVERTISER_AUTHORIZATION_URL: "https://business-api.tiktok.com/portal/auth?app_id=123456&redirect_uri=https://evil.example" },
  { TIKTOK_ADVERTISER_AUTHORIZATION_URL: `https://business-api.tiktok.com/portal/auth?app_id=123456&redirect_uri=${encodeURIComponent(ORIGIN + CALLBACK)}&secret=do-not-leak` },
  { FACEBOOK_TOKEN_ENCRYPTION_KEY: "invalid-key" },
]) {
  test(`missing/unapproved or mismatched configuration fails before insert (${Object.keys(env).join()})`, async () => {
    const h = setup({ enabled: true, env });
    assert.equal((await h.start()).status, 503); assert.equal(h.db.history.length, 0); assert.equal(h.calls.length, 0);
  });
}

test("older JSON runtimes fail configuration before any grant or storage operation", async () => {
  const h = setup({ enabled: true, jsonWithoutSource: true });
  assert.equal((await h.start()).status, 503); assert.equal(h.db.history.length, 0); assert.equal(h.calls.length, 0);
});

test("valid advertiser callback exchanges auth_code once and stores encrypted provider-verified grants", async () => {
  const h = setup({ enabled: true, rawPayload: `{"code":0,"data":{"access_token":"${TOKEN}","advertiser_ids":["7001","7002"],"scope":[1,7533163835474346001]}}` });
  const a = await h.begin(); const result = await h.callback({ state: a.state, auth_code: "fixture-code", code: "ignored-account-holder-code" }, a.cookie);
  assert.equal(reason(result), "authorized"); assert.equal(result.status, 303); assertPrivate(h, result);
  assert.equal(new URL(result.headers.get("location")).searchParams.get("connection_id"), a.id);
  const call = h.calls[0];
  assert.equal(call.url, "https://business-api.tiktok.com/open_api/v2.0/oauth2/access_token/");
  assert.deepEqual(call.body, { app_id: "123456", secret: "fixture-app-secret", auth_code: "fixture-code", is_long_term: true, return_advertiser_ids: true });
  assert.equal(call.init.redirect, "error"); assert.equal(call.init.cache, "no-store"); assert.ok(call.init.signal);
  const row = h.db.tables[TABLE][0];
  assert.equal(row.status, "connected"); assert.equal(row.state_hash, null);
  assert.equal(h.load("lib/channels/channel-token-crypto.ts").decryptChannelCredential(row.access_token_encrypted), TOKEN);
  assert.deepEqual(row.advertiser_ids, ["7001", "7002"]); assert.deepEqual(row.scopes, ["1", "7533163835474346001"]);
  assert.equal(h.calls.length, 1);
  assert.equal(reason(await h.callback({ state: a.state, auth_code: "second-code" }, a.cookie)), "invalid_state");
  assert.equal(h.calls.length, 1);
});

test("concurrent callbacks consume the pending row once before calling TikTok", async () => {
  const h = setup({ enabled: true }); const a = await h.begin();
  const results = await Promise.all([h.callback({ state: a.state, auth_code: "one" }, a.cookie), h.callback({ state: a.state, auth_code: "two" }, a.cookie)]);
  assert.deepEqual(results.map(reason).sort(), ["authorized", "invalid_state"]); assert.equal(h.calls.length, 1);
});

test("state rejects tampering, expiration, different flow and every identity/config binding", async () => {
  const h = setup({ enabled: true }); const state = h.load(OAUTH);
  const binding = { userId: "u", memberId: "m", businessId: "b", appId: "123456", callback: ORIGIN + CALLBACK };
  const now = Date.now(); const { attempt, cookie } = state.createAdvertiserAttempt(binding, now);
  assert.ok(state.verifyAdvertiserAttempt(cookie, attempt.nonce, binding, now));
  assert.equal(state.verifyAdvertiserAttempt(`${cookie.slice(0, -4)}xxxx`, attempt.nonce, binding, now), null);
  assert.equal(state.verifyAdvertiserAttempt(cookie, attempt.nonce, binding, now + 600000), null);
  assert.equal(state.verifyAdvertiserAttempt(cookie, attempt.nonce, binding, now - 60000), null);
  for (const key of Object.keys(binding)) assert.equal(state.verifyAdvertiserAttempt(cookie, attempt.nonce, { ...binding, [key]: "other" }, now), null);
  const crypto = h.load("lib/channels/channel-token-crypto.ts");
  assert.equal(state.verifyAdvertiserAttempt(crypto.encryptChannelCredential(JSON.stringify({ ...attempt, type: "account-holder" })), attempt.nonce, binding, now), null);
  assert.equal(state.verifyAdvertiserAttempt(undefined, attempt.nonce, binding, now), null);
});

test("wrong workspace, duplicated state, missing cookie and expired stored attempt never exchange", async () => {
  const h = setup({ enabled: true }); const a = await h.begin();
  h.member.business_id = "workspace-2";
  assert.equal(reason(await h.callback({ state: a.state, auth_code: "code" }, a.cookie)), "invalid_state");
  h.member.business_id = "workspace-1";
  assert.equal(reason(await h.callback({ state: [a.state, a.state], auth_code: "code" }, a.cookie)), "invalid_state");
  assert.equal(reason(await h.callback({ state: a.state, auth_code: "code" })), "invalid_state");
  h.db.tables[TABLE][0].state_expires_at = "2000-01-01T00:00:00.000Z";
  assert.equal(reason(await h.callback({ state: a.state, auth_code: "code" }, a.cookie)), "invalid_state");
  assert.equal(h.calls.length, 0);
});

for (const query of [{ error_description: "private-provider-error" }, { code: "account-holder-code" }, { auth_code: ["one", "two"] }, { auth_code: "" }, { auth_code: "has space" }]) {
  test(`denial/malformed advertiser callback is consumed without exchange (${Object.keys(query).join()})`, async () => {
    const h = setup({ enabled: true }); const a = await h.begin();
    const result = await h.callback({ state: a.state, ...query }, a.cookie);
    assert.ok(["authorization_denied", "malformed_callback"].includes(reason(result)));
    assertPrivate(h, result); assert.equal(h.db.tables[TABLE][0].status, "failed"); assert.equal(h.calls.length, 0);
    assert.equal(reason(await h.callback({ state: a.state, auth_code: "later" }, a.cookie)), "invalid_state");
  });
}

test("unavailable pending storage prevents exchange and returns no database details", async () => {
  const h = setup({ enabled: true }); const a = await h.begin();
  h.db.failures.push({ table: TABLE, op: "update", message: "private-database-detail" });
  const result = await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  assert.equal(reason(result), "storage_unavailable"); assertPrivate(h, result); assert.equal(h.calls.length, 0);
});

for (const options of [{ networkThrow: true }, { providerStatus: 500 }, { payload: { code: 400, message: "private-error" } }, { rawPayload: "not JSON" }, { grant: { access_token: "" } }]) {
  test(`provider failure never connects or leaks raw errors (${Object.keys(options).join()})`, async () => {
    const h = setup({ enabled: true, ...options }); const a = await h.begin();
    const result = await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
    assert.equal(reason(result), "authorization_failed"); assertPrivate(h, result); assert.equal(h.db.tables[TABLE][0].status, "failed");
  });
}

for (const grant of [{ advertiser_ids: [] }, { advertiser_ids: [7001] }, { scope: [] }, { scope: ["not-a-scope"] }, { refresh_token: "unexpected-refresh-token" }]) {
  test(`invalid provider metadata defers cleanup without safe ownership (${Object.keys(grant).join()})`, async () => {
    const h = setup({ enabled: true, grant }); const a = await h.begin();
    assert.equal(reason(await h.callback({ state: a.state, auth_code: "code" }, a.cookie)), "provider_cleanup_required");
    assert.equal(h.calls.length, 1);
    assert.equal(h.db.tables[TABLE][0].access_token_encrypted, undefined);
  });
}

test("failed persistence defers minted-token cleanup and never revokes an unowned grant", async () => {
  for (const revokeThrow of [false, true]) {
    const h = setup({ enabled: true, revokeThrow }); const a = await h.begin();
    h.db.failures.push({ table: TABLE, op: "update", when: query => query.body?.status === "connected" });
    const result = await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
    assert.equal(reason(result), "provider_cleanup_required"); assert.equal(h.calls.length, 1);
    assertPrivate(h, result); assert.equal(h.db.tables[TABLE][0].status, "failed");
  }
});

test("a provider token already saved by another tenant is neither overwritten nor revoked", async () => {
  const h = setup({ enabled: true }); const a = await h.begin();
  const existing = { id: "other-id", business_id: "other-workspace", app_id: "123456", status: "connected", token_hash: h.load(OAUTH).advertiserHash(TOKEN), access_token_encrypted: "other-encrypted" };
  h.db.tables[TABLE].push(clone(existing));
  const result = await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  assert.equal(reason(result), "grant_already_connected"); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.db.tables[TABLE][1], existing); assert.equal(h.db.tables[TABLE][0].status, "failed"); assertPrivate(h, result);
});

test("simultaneous grants use coordinated ownership without revoking the winning connection", async () => {
  const h = setup({ enabled: true }); const a = await h.begin(); const b = await h.begin();
  const results = await Promise.all([h.callback({ state: a.state, auth_code: "one" }, a.cookie), h.callback({ state: b.state, auth_code: "two" }, b.cookie)]);
  assert.deepEqual(results.map(reason).sort(), ["authorized", "grant_already_connected"]);
  assert.equal(h.db.tables[TABLE].filter(row => row.status === "connected").length, 1);
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => !call.url.includes("revoke_token")));
});

test("malformed metadata with an existing token does not revoke a different tenant's grant", async () => {
  const h = setup({ enabled: true, grant: { scope: [] } }); const a = await h.begin();
  const other = { id: "other", business_id: "other-workspace", app_id: "123456", status: "connected", token_hash: h.load(OAUTH).advertiserHash(TOKEN) };
  h.db.tables[TABLE].push(clone(other));
  assert.equal(reason(await h.callback({ state: a.state, auth_code: "one" }, a.cookie)), "grant_already_connected");
  assert.deepEqual(h.db.tables[TABLE][1], other); assert.equal(h.calls.length, 1);
});

test("ambiguous persistence is reconciled from the exact saved attempt without revoking its token", async () => {
  const h = setup({ enabled: true }); const a = await h.begin();
  h.db.failures.push({ table: TABLE, op: "update", once: true, when: query => {
    if (query.body?.status !== "connected") return false;
    Object.assign(h.db.tables[TABLE][0], clone(query.body)); return true;
  } });
  const result = await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  assert.equal(reason(result), "authorized"); assert.equal(h.db.tables[TABLE][0].status, "connected"); assert.equal(h.calls.length, 1);
});

test("safe metadata excludes secrets and cross-tenant connection IDs cannot read or revoke", async () => {
  const h = setup({ enabled: true }); const a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  const publicResponse = await h.get(a.id); const text = await publicResponse.text();
  assert.equal(publicResponse.status, 200); assert.equal(publicResponse.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(text, /access_token|token_hash|state_hash|member_id|user_id|fixture-/);
  h.member.business_id = "other-workspace";
  assert.equal((await h.get(a.id)).status, 404); assert.equal((await h.disconnect(a.id)).status, 404);
  assert.equal(h.calls.length, 1); assert.equal(h.db.tables[TABLE][0].status, "connected");
});

test("disconnect confirms provider revocation before clearing credentials, even after subscription expiry", async () => {
  const options = { enabled: true }; const h = setup(options); const a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie); options.locked = true;
  assert.equal((await h.disconnect(a.id)).status, 200);
  assert.match(h.calls[1].url, /\/v2\.0\/oauth2\/revoke_token\/$/);
  assert.equal(h.calls[1].body.access_token, TOKEN); assert.equal(h.calls[1].init.headers["Access-Token"], TOKEN);
  const row = h.db.tables[TABLE][0]; assert.equal(row.status, "disconnected");
  assert.equal(row.access_token_encrypted, null); assert.equal(row.token_hash, h.load(OAUTH).advertiserHash(TOKEN));
  assert.ok(row.revoke_confirmed_at); assert.ok(row.revoke_operation_id);
  assert.equal((await h.disconnect(a.id)).status, 200); assert.equal(h.calls.length, 2);
});

test("unconfirmed revocation preserves credentials and fences retries for reconciliation", async () => {
  const h = setup({ enabled: true, revokeThrow: true }); const a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  const encrypted = h.db.tables[TABLE][0].access_token_encrypted;
  const result = await h.disconnect(a.id); assert.equal(result.status, 503);
  assert.equal(h.db.tables[TABLE][0].status, "revocation_pending"); assert.equal(h.db.tables[TABLE][0].access_token_encrypted, encrypted);
  assert.doesNotMatch(await result.text(), /fixture-|private-|secret/);
  assert.equal((await h.disconnect(a.id)).status, 409); assert.equal(h.calls.length, 2);
});

test("production callback never redirects to a supplied hostile origin", async () => {
  const h = setup(); const result = await h.callback({}, undefined, "https://evil.example");
  assert.equal(new URL(result.headers.get("location")).origin, ORIGIN);
  assert.equal(result.headers.get("referrer-policy"), "no-referrer");
});

test("proposal denies browser credential access and has a provider-token uniqueness constraint", () => {
  const sql = readFileSync(new URL("../db/proposals/20261007_tiktok_advertiser_oauth.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all .* from public,anon,authenticated/i);
  assert.match(sql, /grant select,insert,update .* to service_role/i);
  assert.doesNotMatch(sql, /grant .*delete .* to service_role/i);
  assert.match(sql, /create unique index .*\(app_id,token_hash\)/i);
  assert.match(sql, /references public.businesses\(id\) on delete restrict/i);
  assert.doesNotMatch(sql, /create policy|alter table public.social_accounts|insert into/i);
  assert.equal((sql.match(/pg_advisory_xact_lock/g) ?? []).length, 2);
  assert.match(sql, /revoke_operation_id uuid/); assert.match(sql, /revoke_confirmed_at timestamptz/);
  assert.match(sql, /security invoker set search_path = ''/);
  for (const name of ["tenh_save_tiktok_advertiser_grant", "tenh_claim_tiktok_advertiser_disconnect"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}.*from public,anon,authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}.*to service_role`));
  }
});

for (const flag of [undefined, "false"]) {
  test(`disabled handlers need neither advertiser credentials nor the proposal (${String(flag)})`, async () => {
    const h = setup({ authThrow: true, env: { TIKTOK_ADVERTISER_OAUTH_ENABLED: flag,
      TIKTOK_ADVERTISER_APP_ID: undefined, TIKTOK_ADVERTISER_APP_SECRET: undefined,
      TIKTOK_ADVERTISER_AUTHORIZATION_URL: undefined, TIKTOK_ADVERTISER_TOKEN_MODE: undefined,
      FACEBOOK_TOKEN_ENCRYPTION_KEY: undefined } });
    delete h.db.tables[TABLE];
    h.db.from = h.db.rpc = () => { throw new Error("Unexpected storage access"); };
    assert.equal((await h.start()).status, 503);
    const result = await h.callback({ auth_code: "private-code", state: "private-state" });
    assert.equal(result.status, 303); assert.equal(reason(result), "integration_disabled"); assertPrivate(h, result);
    assert.equal((await h.get("12345678-1234-1234-1234-123456789012")).status, 503);
    assert.equal((await h.disconnect("12345678-1234-1234-1234-123456789012")).status, 503);
    assert.equal(h.authCalls(), 0); assert.equal(h.calls.length, 0);
  });
}

test("failed-save cleanup snapshot interleaved with another tenant's save never revokes the winner", async () => {
  const db = advertiserDatabase(), first = setup({ enabled: true, db });
  const second = setup({ enabled: true, db, member: { id: "member-2", user_id: "user-2", business_id: "workspace-2" } });
  const a = await first.begin(), b = await second.begin();
  let release, notify;
  const paused = new Promise(resolve => { notify = resolve; }), resume = new Promise(resolve => { release = resolve; });
  const from = db.from;
  let intercepted = false;
  db.from = name => {
    const query = from(name), then = query.then;
    query.then = function(resolve, reject) {
      return then.call(this, async snapshot => {
        if (query.op === "read" && !intercepted) { intercepted = true; notify(); await resume; }
        return resolve(snapshot);
      }, reject);
    };
    return query;
  };
  db.failures.push({ table: TABLE, op: "update", once: true, when: q => q.body?.status === "connected" });
  const loser = first.callback({ state: a.state, auth_code: "first-code" }, a.cookie);
  await paused;
  assert.equal(reason(await second.callback({ state: b.state, auth_code: "second-code" }, b.cookie)), "authorized");
  release();
  assert.equal(reason(await loser), "provider_cleanup_required");
  assert.equal(db.tables[TABLE].find(r => r.id === b.id).business_id, "workspace-2");
  assert.equal(db.tables[TABLE].find(r => r.id === b.id).status, "connected");
  assert.ok([...first.calls, ...second.calls].every(c => !c.url.includes("revoke_token")));
});

test("competing tenant saves reserve one owner and reject a foreign disconnect", async () => {
  const db = advertiserDatabase(), first = setup({ enabled: true, db });
  const second = setup({ enabled: true, db, member: { id: "member-2", user_id: "user-2", business_id: "workspace-2" } });
  const a = await first.begin(), b = await second.begin();
  const results = await Promise.all([first.callback({ state: a.state, auth_code: "a" }, a.cookie),
    second.callback({ state: b.state, auth_code: "b" }, b.cookie)]);
  assert.deepEqual(results.map(reason).sort(), ["authorized", "grant_already_connected"]);
  const owner = db.tables[TABLE].find(r => r.status === "connected");
  const other = owner.business_id === first.member.business_id ? second : first;
  assert.equal((await other.disconnect(owner.id)).status, 404);
  assert.ok([...first.calls, ...second.calls].every(c => !c.url.includes("revoke_token")));
});

test("late cross-tenant save cannot take a fingerprint during or after its disconnect", async () => {
  for (const finishFirst of [false, true]) {
    let release, notify;
    const paused = new Promise(resolve => { notify = resolve; }), resume = new Promise(resolve => { release = resolve; });
    const db = advertiserDatabase(), first = setup({ enabled: true, db, revokePause: async () => { notify(); await resume; } });
    const second = setup({ enabled: true, db, member: { id: "member-2", user_id: "user-2", business_id: "workspace-2" } });
    const a = await first.begin(); await first.callback({ state: a.state, auth_code: "a" }, a.cookie);
    const b = await second.begin(), disconnect = first.disconnect(a.id);
    await paused;
    if (finishFirst) { release(); assert.equal((await disconnect).status, 200); }
    assert.equal(reason(await second.callback({ state: b.state, auth_code: "b" }, b.cookie)), "grant_already_connected");
    if (!finishFirst) { release(); assert.equal((await disconnect).status, 200); }
    assert.equal(db.tables[TABLE].find(r => r.id === a.id).token_hash, first.load(OAUTH).advertiserHash(TOKEN));
    assert.equal(first.calls.length, 2); assert.equal(second.calls.length, 1);
  }
});

test("duplicate DELETE requests grant exactly one provider-operation owner", async () => {
  let release, notify;
  const paused = new Promise(resolve => { notify = resolve; }), resume = new Promise(resolve => { release = resolve; });
  const h = setup({ enabled: true, revokePause: async () => { notify(); await resume; } }), a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  const first = h.disconnect(a.id); await paused;
  const owner = h.db.tables[TABLE][0].revoke_operation_id;
  const duplicate = await h.disconnect(a.id);
  assert.equal(duplicate.status, 409); assert.equal(h.db.tables[TABLE][0].revoke_operation_id, owner);
  assert.doesNotMatch(await duplicate.text(), /fixture-|token|operation_id/);
  release(); assert.equal((await first).status, 200);
  assert.equal((await h.disconnect(a.id)).status, 200); assert.equal(h.calls.length, 2);
});

test("remote success then local clearing failure retries only the confirmed storage cleanup", async () => {
  const options = { enabled: true }, h = setup(options), a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  h.db.failures.push({ table: TABLE, op: "update", once: true, when: q => q.body?.status === "disconnected" });
  assert.equal((await h.disconnect(a.id)).status, 503);
  const owner = h.db.tables[TABLE][0].revoke_operation_id;
  assert.ok(h.db.tables[TABLE][0].revoke_confirmed_at);
  options.revokePayload = { code: 400, message: "Already revoked is not proof" };
  assert.equal((await h.disconnect(a.id)).status, 200);
  assert.equal(h.db.tables[TABLE][0].revoke_operation_id, owner);
  assert.equal(h.db.tables[TABLE][0].access_token_encrypted, null); assert.equal(h.calls.length, 2);
});

test("a receipt-write failure retries the local receipt once without another provider revoke", async () => {
  for (const committed of [false, true]) {
    const h = setup({ enabled: true }), a = await h.begin();
    await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
    h.db.failures.push({ table: TABLE, op: "update", once: true, when: q => {
      if (!q.body?.revoke_confirmed_at) return false;
      if (committed) Object.assign(h.db.tables[TABLE][0], q.body);
      return true;
    } });
    assert.equal((await h.disconnect(a.id)).status, 200); assert.equal(h.calls.length, 2);
  }
});

test("lost local clearing response reconciles the same completed operation", async () => {
  const h = setup({ enabled: true }), a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  h.db.failures.push({ table: TABLE, op: "update", once: true, when: q => {
    if (q.body?.status !== "disconnected") return false;
    Object.assign(h.db.tables[TABLE][0], q.body); return true;
  } });
  assert.equal((await h.disconnect(a.id)).status, 200); assert.equal(h.calls.length, 2);
});

test("an ambiguous receipt commit can be recovered by a later storage-only retry", async () => {
  const h = setup({ enabled: true }), a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  h.db.failures.push({ table: TABLE, op: "update", when: q => {
    if (!q.body?.revoke_confirmed_at) return false;
    Object.assign(h.db.tables[TABLE][0], q.body); return true;
  } });
  assert.equal((await h.disconnect(a.id)).status, 503);
  h.db.failures.length = 0;
  assert.equal((await h.disconnect(a.id)).status, 200); assert.equal(h.calls.length, 2);
});

test("a crashed owner after claim is never replaced automatically, even after ten minutes", async () => {
  const h = setup({ enabled: true }), a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  const operationId = "11111111-1111-4111-8111-111111111111";
  assert.equal((await h.db.rpc("tenh_claim_tiktok_advertiser_disconnect", {
    p_id: a.id, p_business_id: h.member.business_id, p_app_id: "123456", p_operation_id: operationId,
  })).data.outcome, "claimed");
  h.db.tables[TABLE][0].revoke_started_at = "2000-01-01T00:00:00.000Z";
  assert.equal((await h.disconnect(a.id)).status, 409);
  assert.equal(h.db.tables[TABLE][0].revoke_operation_id, operationId); assert.equal(h.calls.length, 1);
});

test("remote success without a durable receipt requires reconciliation and never steals the owner", async () => {
  const h = setup({ enabled: true }), a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  h.db.failures.push({ table: TABLE, op: "update", when: q => Boolean(q.body?.revoke_confirmed_at) });
  assert.equal((await h.disconnect(a.id)).status, 503);
  const row = h.db.tables[TABLE][0], owner = row.revoke_operation_id;
  h.db.failures.length = 0; row.revoke_started_at = "2000-01-01T00:00:00.000Z";
  assert.equal((await h.disconnect(a.id)).status, 409);
  assert.equal(row.revoke_operation_id, owner); assert.ok(row.access_token_encrypted); assert.equal(row.revoke_confirmed_at, undefined);
  assert.equal(h.calls.length, 2); assert.equal(h.logs.length, 0);
});

test("operation claim failure and an ambiguous committed claim never contact the provider", async () => {
  for (const committed of [false, true]) {
    const h = setup({ enabled: true }), a = await h.begin();
    await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
    h.db.failures.push({ table: TABLE, op: "update", once: true, when: q => {
      if (q.body?.status !== "revocation_pending") return false;
      if (committed) Object.assign(h.db.tables[TABLE][0], q.body);
      return true;
    } });
    assert.equal((await h.disconnect(a.id)).status, 503); assert.equal(h.calls.length, 1);
    if (committed) { assert.equal((await h.disconnect(a.id)).status, 409); assert.equal(h.calls.length, 1); }
    else { assert.equal((await h.disconnect(a.id)).status, 200); assert.equal(h.calls.length, 2); }
  }
});

test("failed operation owner cannot write a receipt or clear credentials under a changed operation ID", async () => {
  const h = setup({ enabled: true, revokePause: async () => {
    h.db.tables[TABLE][0].revoke_operation_id = "11111111-1111-4111-8111-111111111111";
  } }), a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  assert.equal((await h.disconnect(a.id)).status, 503);
  assert.equal(h.db.tables[TABLE][0].status, "revocation_pending");
  assert.equal(h.db.tables[TABLE][0].revoke_confirmed_at, undefined); assert.ok(h.db.tables[TABLE][0].access_token_encrypted);
  assert.equal((await h.disconnect(a.id)).status, 409); assert.equal(h.calls.length, 2);
});

for (const failure of [
  { revokeTimeout: true }, { revokeThrow: true }, { revokeRaw: "not JSON" },
  { revokeRaw: "{}", revokeStatus: 500 }, { revokePayload: { code: 40105, message: "Invalid or revoked fixture token" } },
  { revokePayload: { data: { app_id: "different-app", advertiser_ids: [] } } },
]) {
  test(`ambiguous/failed provider outcome is never a revocation receipt (${Object.keys(failure).join()})`, async () => {
    const h = setup({ enabled: true, ...failure }), a = await h.begin();
    await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
    const result = await h.disconnect(a.id);
    assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /fixture-|private-|token|secret/);
    assert.equal(h.db.tables[TABLE][0].status, "revocation_pending");
    assert.equal(h.db.tables[TABLE][0].revoke_confirmed_at, undefined); assert.ok(h.db.tables[TABLE][0].access_token_encrypted);
    assert.equal((await h.disconnect(a.id)).status, 409); assert.equal(h.calls.length, 2); assert.equal(h.logs.length, 0);
  });
}

test("a corrupt credential cannot revoke a different fingerprint", async () => {
  const h = setup({ enabled: true }), a = await h.begin();
  await h.callback({ state: a.state, auth_code: "code" }, a.cookie);
  h.db.tables[TABLE][0].access_token_encrypted = h.load("lib/channels/channel-token-crypto.ts").encryptChannelCredential("different-token");
  assert.equal((await h.disconnect(a.id)).status, 503); assert.equal(h.calls.length, 1);
});

test("missing ownership RPCs fail closed and defer cleanup before any revocation", async () => {
  const h = setup({ enabled: true }), a = await h.begin();
  h.db.failures.push({ op: "rpc", name: "tenh_save_tiktok_advertiser_grant" });
  assert.equal(reason(await h.callback({ state: a.state, auth_code: "code" }, a.cookie)), "provider_cleanup_required");
  assert.equal(h.calls.length, 1);
});
