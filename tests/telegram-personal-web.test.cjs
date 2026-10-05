const test = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./tenh-seven/harness.cjs");

const B1 = "00000000-0000-4000-8000-0000000000b1";
const B2 = "00000000-0000-4000-8000-0000000000b2";
const S1 = "11111111-1111-4111-8111-111111111111";
const HOLDER = "00000000-0000-4000-8000-0000000000c1";
const OTHER_OWNER = "00000000-0000-4000-8000-0000000000c2";
const AGENT = "00000000-0000-4000-8000-0000000000c3";

const ENABLED_ENV = {
  TENH_TELEGRAM_PERSONAL_ENABLED: "true",
  TENH_TELEGRAM_PERSONAL_BUSINESS_IDS: B1,
};

function workerKeys() {
  const crypto = loader({}, { Buffer })("workers/telegram-personal/src/crypto.ts");
  const pair = crypto.generateSealKeyPair();
  return { crypto, pair };
}

/** Minimal Supabase double: records every rpc and filters selects. */
function fakeDb(seed) {
  const tables = JSON.parse(JSON.stringify(seed));
  const rpcCalls = [];
  const rpcResults = {};
  class Q {
    constructor(name) { this.name = name; this.filters = []; this.single = false; }
    select() { return this; }
    order() { return this; }
    limit() { return this; }
    or() { return this; }
    eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
    in(k, vs) { this.filters.push((r) => vs.includes(r[k])); return this; }
    maybeSingle() { this.single = true; return this.run(); }
    then(res, rej) { return this.run().then(res, rej); }
    async run() {
      const rows = (tables[this.name] || []).filter((r) => this.filters.every((f) => f(r)));
      return { data: this.single ? rows[0] || null : rows, error: null };
    }
  }
  return {
    tables,
    rpcCalls,
    rpcResults,
    from: (name) => new Q(name),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      const result = rpcResults[name];
      if (typeof result === "function") return result(args);
      return result ?? { data: "OK", error: null };
    },
  };
}

function session(overrides = {}) {
  return {
    id: S1, business_id: B1, social_account_id: null, holder_user_id: HOLDER, login_method: "qr",
    status: "waiting_qr", team_access: "holder_only", display_name: null, username: null, phone_masked: null,
    last_error_code: null, connected_at: null, ended_at: null, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z",
    ...overrides,
  };
}

function load(file, { env = ENABLED_ENV, userId = HOLDER, role = "owner", businessId = B1, db, permission = true } = {}) {
  const member = { id: `m-${userId.slice(-2)}`, user_id: userId, business_id: businessId, role, full_name: "Test", email: "t@example.com", profile_picture_url: null, is_active: true };
  const load = loader({
    "next/server": {
      // Like the real NextResponse.json, keep caller headers (the shared harness drops them).
      NextResponse: { json: (data, init = {}) => new Response(JSON.stringify(data), { status: init.status || 200, headers: { "Content-Type": "application/json", ...(init.headers || {}) } }) },
    },
    "@/lib/supabase/admin": { supabaseAdmin: db },
    "@/lib/auth/get-current-member": { getCurrentMember: async () => ({ success: true, user: { id: userId }, member }) },
    "@/lib/auth/require-permission": {
      memberHasPermission: async () => permission,
      permissionDenied: (error) => new Response(JSON.stringify({ success: false, error }), { status: 403 }),
    },
  }, { process: { env }, Buffer });
  return load(file);
}

const ctx = (sessionId = S1) => ({ params: Promise.resolve({ sessionId }) });
const json = (method, body) => new Request("https://tenh.test/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

test("feature flag is off by default and scoped per workspace", () => {
  const { isTelegramPersonalEnabled } = loader({})("lib/telegram-personal/feature-flag.ts");
  assert.equal(isTelegramPersonalEnabled({}, B1), false);
  assert.equal(isTelegramPersonalEnabled({ TENH_TELEGRAM_PERSONAL_ENABLED: "true" }, B1), false, "allowlist required");
  assert.equal(isTelegramPersonalEnabled(ENABLED_ENV, B1), true);
  assert.equal(isTelegramPersonalEnabled(ENABLED_ENV, B2), false);
  assert.equal(isTelegramPersonalEnabled({ ...ENABLED_ENV, TENH_TELEGRAM_PERSONAL_BUSINESS_IDS: "*" }, B2), true);
  assert.equal(isTelegramPersonalEnabled({ ...ENABLED_ENV, TENH_TELEGRAM_PERSONAL_ENABLED: "TRUE" }, B1), false);
});

test("permission matrix: holder, other owner, agent", () => {
  const a = loader({})("lib/telegram-personal/access.ts");
  const ref = { holderUserId: HOLDER, teamAccess: "holder_only" };
  const holder = { userId: HOLDER, memberId: "m1", role: "owner" };
  const owner = { userId: OTHER_OWNER, memberId: "m2", role: "owner" };
  const agent = { userId: AGENT, memberId: "m3", role: "agent" };
  assert.equal(a.canStartPersonalLogin(owner), true);
  assert.equal(a.canStartPersonalLogin(agent), false);
  assert.deepEqual([a.canUseLogin(holder, ref), a.canUseLogin(owner, ref), a.canUseLogin(agent, ref)], [true, false, false]);
  assert.deepEqual([a.canDisconnect(holder, ref), a.canDisconnect(owner, ref), a.canDisconnect(agent, ref)], [true, true, false]);
  assert.deepEqual([a.canResume(holder, ref), a.canResume(owner, ref)], [true, false]);
  assert.deepEqual([a.canSetTeamAccess(holder, ref), a.canSetTeamAccess(owner, ref)], [true, false]);
  const none = new Set();
  assert.equal(a.canSeePersonalConversations(agent, ref, none), false, "default: only the holder");
  assert.equal(a.canSeePersonalConversations(owner, { ...ref, teamAccess: "owners" }, none), true);
  assert.equal(a.canSeePersonalConversations(agent, { ...ref, teamAccess: "owners" }, none), false);
  assert.equal(a.canSeePersonalConversations(agent, { ...ref, teamAccess: "selected_members" }, new Set(["m3"])), true);
  assert.equal(a.canSeePersonalConversations(owner, { ...ref, teamAccess: "selected_members" }, new Set(["m3"])), false);
});

test("web seal opens in the worker only for the same session and kind", () => {
  const { crypto, pair } = workerKeys();
  const { sealTelegramPersonalInput } = loader({}, { Buffer })("lib/telegram-personal/seal.ts");
  const sealed = sealTelegramPersonalInput(pair.publicKeyBase64, S1, "code", "12345");
  assert.ok(!sealed.includes("12345"));
  const priv = crypto.privateKeyFromPem(pair.privateKeyPem);
  assert.equal(crypto.openSealed(priv, crypto.sealAad(S1, "code"), sealed), "12345");
  assert.throws(() => crypto.openSealed(priv, crypto.sealAad("22222222-2222-4222-8222-222222222222", "code"), sealed));
  assert.throws(() => crypto.openSealed(priv, crypto.sealAad(S1, "password"), sealed));
});

test("routes are hidden (404) while the flag is off", async () => {
  const db = fakeDb({ telegram_personal_sessions: [session()] });
  const list = load("app/api/telegram-personal/connections/route.ts", { env: {}, db });
  assert.equal((await list.GET()).status, 404);
  assert.equal((await list.POST(json("POST", { method: "qr", acceptDisclosure: true }))).status, 404);
  const login = load("app/api/telegram-personal/connections/[sessionId]/login/route.ts", { env: {}, db });
  assert.equal((await login.GET(json("GET"), ctx())).status, 404);
  assert.equal(db.rpcCalls.length, 0);
});

test("start login: owner only, disclosure required, identity from the session (not the body)", async () => {
  const { pair } = workerKeys();
  const env = { ...ENABLED_ENV, TELEGRAM_PERSONAL_SEAL_PUBLIC_KEY: pair.publicKeyBase64 };
  const db = fakeDb({});
  db.rpcResults.tgp_begin_login = { data: S1, error: null };

  const asAgent = load("app/api/telegram-personal/connections/route.ts", { env, db, userId: AGENT, role: "agent", permission: false });
  assert.equal((await asAgent.POST(json("POST", { method: "qr", acceptDisclosure: true }))).status, 403);

  const route = load("app/api/telegram-personal/connections/route.ts", { env, db });
  assert.equal((await route.POST(json("POST", { method: "qr" }))).status, 400, "disclosure must be accepted");
  assert.equal((await route.POST(json("POST", { method: "sms", acceptDisclosure: true }))).status, 400);

  const ok = await route.POST(json("POST", { method: "qr", acceptDisclosure: true, businessId: B2, userId: AGENT }));
  assert.equal(ok.status, 201);
  const call = db.rpcCalls.find((c) => c.name === "tgp_begin_login");
  assert.deepEqual([call.args.p_business, call.args.p_user, call.args.p_method], [B1, HOLDER, "qr"]);

  const noKey = load("app/api/telegram-personal/connections/route.ts", { env: ENABLED_ENV, db });
  assert.equal((await noKey.POST(json("POST", { method: "qr", acceptDisclosure: true }))).status, 503, "worker key not configured");
});

test("channel limit and too-many-logins errors map to clear responses", async () => {
  const { pair } = workerKeys();
  const env = { ...ENABLED_ENV, TELEGRAM_PERSONAL_SEAL_PUBLIC_KEY: pair.publicKeyBase64 };
  const db = fakeDb({});
  const route = load("app/api/telegram-personal/connections/route.ts", { env, db });
  db.rpcResults.tgp_begin_login = { data: null, error: { message: "TGP_CHANNEL_LIMIT_REACHED", code: "53400" } };
  let res = await route.POST(json("POST", { method: "qr", acceptDisclosure: true }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "CHANNEL_LIMIT_REACHED");
  db.rpcResults.tgp_begin_login = { data: null, error: { message: "TGP_TOO_MANY_LOGINS", code: "53400" } };
  res = await route.POST(json("POST", { method: "qr", acceptDisclosure: true }));
  assert.equal(res.status, 429);
});

test("login status: QR rendered for the holder only, raw link never returned", async () => {
  const db = fakeDb({
    telegram_personal_sessions: [session()],
    telegram_personal_logins: [{ session_id: S1, qr_link: "tg://login?token=SECRETTOKEN", password_hint: null, error_code: null, deadline_at: "2026-10-05T00:05:00Z" }],
  });
  const holder = load("app/api/telegram-personal/connections/[sessionId]/login/route.ts", { db });
  const res = await holder.GET(json("GET"), ctx());
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes("SECRETTOKEN"), "raw login token never leaves the server");
  assert.match(JSON.parse(text).qr, /^data:image\/png;base64,/);
  assert.match(res.headers.get("cache-control"), /no-store/);

  const owner = load("app/api/telegram-personal/connections/[sessionId]/login/route.ts", { db, userId: OTHER_OWNER });
  assert.equal((await owner.GET(json("GET"), ctx())).status, 404, "another owner cannot see the QR");
  const otherWorkspace = load("app/api/telegram-personal/connections/[sessionId]/login/route.ts", { db, businessId: B2, env: { ...ENABLED_ENV, TENH_TELEGRAM_PERSONAL_BUSINESS_IDS: "*" } });
  assert.equal((await otherWorkspace.GET(json("GET"), ctx())).status, 404, "cross-workspace id rejected");
});

test("login input is validated, sealed before storage and never echoed", async () => {
  const { crypto, pair } = workerKeys();
  const env = { ...ENABLED_ENV, TELEGRAM_PERSONAL_SEAL_PUBLIC_KEY: pair.publicKeyBase64 };
  const db = fakeDb({ telegram_personal_sessions: [session({ status: "waiting_password" })] });
  db.rpcResults.tgp_submit_login_input = { data: true, error: null };
  const route = load("app/api/telegram-personal/connections/[sessionId]/login/route.ts", { env, db });

  assert.equal((await route.POST(json("POST", { kind: "code", value: "12ab" }), ctx())).status, 400);
  const res = await route.POST(json("POST", { kind: "password", value: "correct horse battery" }), ctx());
  assert.equal(res.status, 202);
  assert.ok(!(await res.text()).includes("correct horse"));
  const call = db.rpcCalls.find((c) => c.name === "tgp_submit_login_input");
  assert.ok(!JSON.stringify(call.args).includes("correct horse"), "only ciphertext reaches the database");
  const priv = crypto.privateKeyFromPem(pair.privateKeyPem);
  assert.equal(crypto.openSealed(priv, crypto.sealAad(S1, "password"), call.args.p_sealed), "correct horse battery");

  db.rpcResults.tgp_submit_login_input = { data: false, error: null };
  assert.equal((await route.POST(json("POST", { kind: "password", value: "x" }), ctx())).status, 409);

  const agent = load("app/api/telegram-personal/connections/[sessionId]/login/route.ts", { env, db, userId: AGENT, role: "agent" });
  assert.equal((await agent.POST(json("POST", { kind: "password", value: "x" }), ctx())).status, 404);
});

test("sign-out requires explicit confirmation; RPC decides permission", async () => {
  const db = fakeDb({ telegram_personal_sessions: [session({ status: "connected" })] });
  const route = load("app/api/telegram-personal/connections/[sessionId]/route.ts", { db, userId: OTHER_OWNER });
  assert.equal((await route.DELETE(json("DELETE", {}), ctx())).status, 400);
  const res = await route.DELETE(json("DELETE", { confirm: "SIGN_OUT" }), ctx());
  assert.equal(res.status, 202);
  const call = db.rpcCalls.find((c) => c.name === "tgp_request_action");
  assert.deepEqual([call.args.p_kind, call.args.p_business, call.args.p_user], ["logout", B1, OTHER_OWNER]);

  db.rpcResults.tgp_request_action = { data: "FORBIDDEN", error: null };
  const agent = load("app/api/telegram-personal/connections/[sessionId]/route.ts", { db, userId: AGENT, role: "agent" });
  assert.equal((await agent.DELETE(json("DELETE", { confirm: "SIGN_OUT" }), ctx())).status, 403);
});

test("public connection view hides secrets and narrows identity for agents", async () => {
  const db = fakeDb({ telegram_personal_sessions: [session({ status: "connected", display_name: "Dara", username: "dara", phone_masked: "+855 •••• 678", db_key_wrapped: "v1.SECRET", lease_owner: "w" })] });
  const asAgent = load("app/api/telegram-personal/connections/route.ts", { db, userId: AGENT, role: "agent" });
  const body = await (await asAgent.GET()).json();
  const conn = body.connections[0];
  assert.equal(conn.kind, "telegram_personal");
  assert.equal(conn.username, null);
  assert.equal(conn.phoneMasked, null);
  assert.equal(body.canConnect, false);
  assert.deepEqual(conn.can, { useLogin: false, pause: false, resume: false, disconnect: false, setTeamAccess: false });
  assert.ok(!JSON.stringify(body).includes("SECRET"));
});
