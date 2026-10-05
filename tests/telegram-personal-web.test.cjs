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
const SEND_ENV = { ...ENABLED_ENV, TENH_TELEGRAM_PERSONAL_SEND_ENABLED: "true" };

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
    is(k, v) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
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
  assert.deepEqual(conn.can, { useLogin: false, pause: false, resume: false, disconnect: false, setTeamAccess: false, manageChats: false, removeData: false });
  assert.ok(!JSON.stringify(body).includes("SECRET"));
});

test("ended sessions are hidden once a newer session exists for the same account or holder", () => {
  const { selectVisibleSessions } = loader({ "@/lib/supabase/admin": { supabaseAdmin: {} }, "qrcode": {} }, { Buffer })("lib/telegram-personal/server.ts");
  const rows = [ // newest first
    { id: "new", holder_user_id: HOLDER, status: "connected", telegram_user_id: "7001" },
    { id: "old-signed-out", holder_user_id: HOLDER, status: "disconnected", telegram_user_id: "7001" },
    { id: "old-expired-attempt", holder_user_id: HOLDER, status: "expired", telegram_user_id: null },
    { id: "other-owner-ended", holder_user_id: OTHER_OWNER, status: "revoked", telegram_user_id: "7002" },
  ];
  assert.deepEqual([...selectVisibleSessions(rows).map((r) => r.id)], ["new", "other-owner-ended"]);
  assert.deepEqual([...selectVisibleSessions([rows[1]]).map((r) => r.id)], ["old-signed-out"], "an ended session alone stays visible");
});

// ---------------------------------------------------------------- D1 routes
const ACC1 = "22222222-2222-4222-8222-222222222221";
const ACC2 = "22222222-2222-4222-8222-222222222222";
const CHAT1 = "33333333-3333-4333-8333-333333333331";
const CHAT2 = "33333333-3333-4333-8333-333333333332";
const CHAT_OTHER = "33333333-3333-4333-8333-333333333339";

function d1Seed() {
  const chat = (id, account, business, title) => ({ id, business_id: business, social_account_id: account, title, username: null, shared_at: "2026-10-05T00:00:00Z", unshared_at: null, last_message_at: "2026-10-05T10:00:00Z", last_message_preview: "hi", last_direction: "incoming", unread_count: 2, history_import: "none" });
  return {
    telegram_personal_sessions: [session({ status: "connected", social_account_id: ACC1 })],
    social_accounts: [
      { id: ACC1, business_id: B1, platform: "telegram_personal", account_name: "Holder" },
      { id: ACC2, business_id: B1, platform: "telegram_personal", account_name: "Other owner account" },
    ],
    telegram_personal_chats: [chat(CHAT1, ACC1, B1, "Visible chat"), chat(CHAT2, ACC2, B1, "Hidden chat"), chat(CHAT_OTHER, ACC1, B2, "Other workspace")],
    telegram_personal_messages: [{ id: "m1", chat_row_id: CHAT1, telegram_message_id: 10, direction: "incoming", message_type: "text", body: "hello", placeholder_kind: null, sent_at: "2026-10-05T10:00:00Z" }],
    telegram_personal_unshared_activity: [],
  };
}

function visibilityDb(visibleAccounts) {
  const db = fakeDb(d1Seed());
  db.rpcResults.tgp_member_can_see = (args) => ({ data: visibleAccounts.includes(args.p_social_account), error: null });
  return db;
}

const CONV = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";

/** The D2 send route, with the shared inbox gate replaced by a fixed answer. */
function sendRoute({ db, userId = HOLDER, role = "owner", env = SEND_ENV, visible = true, platform = "telegram_personal", permission = true }) {
  const member = { id: `m-${userId.slice(-2)}`, user_id: userId, business_id: B1, role };
  return loader({
    "next/server": {
      NextResponse: { json: (data, init = {}) => new Response(JSON.stringify(data), { status: init.status || 200, headers: { "Content-Type": "application/json", ...(init.headers || {}) } }) },
    },
    "@/lib/supabase/admin": { supabaseAdmin: db },
    "@/lib/auth/require-permission": { memberHasPermission: async () => permission },
    "@/lib/inbox/get-inbox-resource-access": {
      getInboxConversationAccess: async () => visible
        ? { success: true, user: { id: userId }, member, conversation: { id: CONV, business_id: B1, social_account_id: ACC1, platform } }
        : { success: false, status: 404, error: "Conversation was not found." },
    },
  }, { process: { env }, Buffer, setTimeout, crypto, File, FormData })("app/api/telegram-personal/send/route.ts");
}

const sendReq = (body) => Object.assign(new Request("https://tenh.test/api/telegram-personal/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {});
const getReq = (query) => { const url = `https://tenh.test/api/telegram-personal/send?${query}`; return Object.assign(new Request(url), { nextUrl: new URL(url) }); };

/** fakeDb plus a Supabase Storage double that records uploads and removals. */
function fakeDbWithStorage(seed) {
  const db = fakeDb(seed);
  db.objects = new Map();
  db.removed = [];
  db.storage = {
    from: (bucket) => ({
      upload: async (path, bytes, options) => { db.objects.set(`${bucket}/${path}`, { size: bytes.length, contentType: options?.contentType }); return { error: null }; },
      remove: async (paths) => { for (const p of paths) { db.removed.push(`${bucket}/${p}`); db.objects.delete(`${bucket}/${p}`); } return { error: null }; },
    }),
  };
  return db;
}

function sendDb() {
  const db = fakeDbWithStorage({
    ...d1Seed(),
    telegram_personal_chats: [{ id: CHAT1, business_id: B1, social_account_id: ACC1, conversation_id: CONV, unshared_at: null }],
  });
  return db;
}

test("send: reply status is holder only; teammates who can see the chat read only", async () => {
  const db = sendDb();
  const holder = await (await sendRoute({ db }).GET(getReq(`conversationId=${CONV}`))).json();
  assert.deepEqual([holder.canReply, holder.reason], [true, null]);
  const agent = await (await sendRoute({ db, userId: AGENT, role: "agent" }).GET(getReq(`conversationId=${CONV}`))).json();
  assert.deepEqual([agent.canReply, agent.reason], [false, "HOLDER_ONLY"]);
  const noPermission = await (await sendRoute({ db, permission: false }).GET(getReq(`conversationId=${CONV}`))).json();
  assert.equal(noPermission.reason, "NO_PERMISSION");
  db.tables.telegram_personal_sessions[0].status = "paused";
  assert.equal((await (await sendRoute({ db }).GET(getReq(`conversationId=${CONV}`))).json()).reason, "NOT_CONNECTED");
});

test("send: off by default (separate switch); receiving stays read only until it is turned on", async () => {
  const db = sendDb();
  const route = sendRoute({ db, env: ENABLED_ENV });
  const status = await (await route.GET(getReq(`conversationId=${CONV}`))).json();
  assert.deepEqual([status.canReply, status.reason], [false, "SEND_DISABLED"]);
  const refused = await route.POST(sendReq({ conversationId: CONV, clientRequestId: REQ, text: "hi" }));
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).code, "SEND_DISABLED");
  assert.equal(db.rpcCalls.filter((c) => c.name === "tgp_enqueue_send_v2").length, 0);
});

test("send: hidden, non-Personal or flag-off conversations are 404 and never reach the queue", async () => {
  const db = sendDb();
  const body = { conversationId: CONV, clientRequestId: REQ, text: "hi" };
  assert.equal((await sendRoute({ db, visible: false }).POST(sendReq(body))).status, 404);
  assert.equal((await sendRoute({ db, platform: "telegram" }).POST(sendReq(body))).status, 404);
  assert.equal((await sendRoute({ db, env: {} }).POST(sendReq(body))).status, 404);
  assert.equal((await sendRoute({ db }).POST(sendReq({ ...body, clientRequestId: "not-a-uuid" }))).status, 400);
  assert.equal((await sendRoute({ db }).POST(sendReq({ ...body, text: "   " }))).status, 400);
  assert.equal((await sendRoute({ db }).POST(sendReq({ ...body, text: "x".repeat(4097) }))).status, 400);
  assert.equal(db.rpcCalls.filter((c) => c.name === "tgp_enqueue_send_v2").length, 0);
});

test("send: queue refusals map to clear errors; identity comes from the session, not the body", async () => {
  const db = sendDb();
  const body = { conversationId: CONV, clientRequestId: REQ, text: "hello", userId: OTHER_OWNER, memberId: "forged" };
  for (const [code, status] of [["HOLDER_ONLY", 403], ["RATE_LIMITED", 429], ["CHAT_NOT_SHARED", 409], ["NOT_CONNECTED", 409]]) {
    db.rpcResults.tgp_enqueue_send_v2 = { data: { ok: false, code }, error: null };
    const response = await sendRoute({ db }).POST(sendReq(body));
    assert.equal(response.status, status, code);
    assert.equal((await response.json()).code, code);
  }
  const call = db.rpcCalls.find((c) => c.name === "tgp_enqueue_send_v2");
  assert.deepEqual([call.args.p_user, call.args.p_member, call.args.p_business, call.args.p_client_request_id], [HOLDER, "m-c1", B1, REQ]);
  db.rpcResults.tgp_enqueue_send_v2 = { data: null, error: { code: "XX000" } };
  const failed = await sendRoute({ db }).POST(sendReq(body));
  assert.equal(failed.status, 500);
  assert.match((await failed.json()).error, /Nothing was sent/);
});

test("send: reports sent, failed and uncertain outcomes and never re-enqueues", async () => {
  for (const [state, expected] of [["done", "sent"], ["failed", "failed"], ["uncertain", "uncertain"]]) {
    const db = sendDb();
    db.rpcResults.tgp_enqueue_send_v2 = { data: { ok: true, command_id: "k", state: "queued" }, error: null };
    db.rpcResults.tgp_send_state = { data: { state, code: state === "done" ? null : "X", message_id: "msg" }, error: null };
    const response = await sendRoute({ db }).POST(sendReq({ conversationId: CONV, clientRequestId: REQ, text: "hello" }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, expected);
    assert.equal(db.rpcCalls.filter((c) => c.name === "tgp_enqueue_send_v2").length, 1, "enqueued exactly once");
  }
  const db = sendDb();
  db.rpcResults.tgp_send_state = { data: { state: "uncertain", code: "OUTCOME_UNKNOWN" }, error: null };
  const polled = await (await sendRoute({ db }).GET(getReq(`conversationId=${CONV}&clientRequestId=${REQ}`))).json();
  assert.equal(polled.state, "uncertain");
  assert.equal(db.rpcCalls.filter((c) => c.name === "tgp_enqueue_send_v2").length, 0, "status checks never send");
});

test("chat sharing routes: holder only, validated input, chooser results from the worker", async () => {
  const db = visibilityDb([ACC1]);
  const req = (url, method = "GET", body) => Object.assign(new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), { nextUrl: new URL(url) });
  const asOwner = load("app/api/telegram-personal/connections/[sessionId]/chats/route.ts", { db, userId: OTHER_OWNER });
  assert.equal((await asOwner.GET(req("https://tenh.test/x"), ctx())).status, 404, "other owner cannot manage holder chats");
  assert.equal((await asOwner.POST(req("https://tenh.test/x", "POST", { action: "list" }), ctx())).status, 404);

  const holder = load("app/api/telegram-personal/connections/[sessionId]/chats/route.ts", { db });
  const list = await holder.GET(req("https://tenh.test/x"), ctx());
  assert.equal(list.status, 200);
  db.rpcResults.tgp_request_chat_list = { data: "44444444-4444-4444-8444-444444444444", error: null };
  const requested = await holder.POST(req("https://tenh.test/x", "POST", { action: "list" }), ctx());
  assert.equal(requested.status, 202);
  assert.equal((await holder.GET(req("https://tenh.test/x?commandId=bad"), ctx())).status, 400);
  assert.equal((await holder.POST(req("https://tenh.test/x", "POST", { action: "share", chatId: "12; drop", history: "none" }), ctx())).status, 400);
  db.rpcResults.tgp_share_chat = { data: { ok: false, code: "CHAT_NOT_LISTED" }, error: null };
  assert.equal((await holder.POST(req("https://tenh.test/x", "POST", { action: "share", chatId: "5001", history: "none" }), ctx())).status, 409);
  db.rpcResults.tgp_share_chat = { data: { ok: true, chat_row_id: CHAT1 }, error: null };
  assert.equal((await holder.POST(req("https://tenh.test/x", "POST", { action: "share", chatId: "5001", history: "last_50", title: "spoofed" }), ctx())).status, 200);
  const share = db.rpcCalls.filter((x) => x.name === "tgp_share_chat").pop();
  assert.deepEqual([share.args.p_chat_id, share.args.p_history, share.args.p_user], ["5001", "last_50", HOLDER]);
  assert.ok(!("p_title" in share.args), "title is never taken from the browser");

  const unshare = load("app/api/telegram-personal/connections/[sessionId]/chats/[chatRowId]/route.ts", { db });
  const uctx = { params: Promise.resolve({ sessionId: S1, chatRowId: CHAT1 }) };
  assert.equal((await unshare.DELETE(json("DELETE", { deleteHistory: true }), uctx)).status, 400, "confirmation required");
  db.rpcResults.tgp_unshare_chat = { data: "OK", error: null };
  assert.equal((await unshare.DELETE(json("DELETE", { confirm: "UNSHARE", deleteHistory: true }), uctx)).status, 200);
  assert.equal(db.rpcCalls.filter((x) => x.name === "tgp_unshare_chat").pop().args.p_delete_history, true);
});

test("remove imported data requires explicit confirmation", async () => {
  const db = visibilityDb([ACC1]);
  const route = load("app/api/telegram-personal/connections/[sessionId]/route.ts", { db, userId: OTHER_OWNER });
  assert.equal((await route.PATCH(json("PATCH", { action: "remove_data" }), ctx())).status, 400);
  db.rpcResults.tgp_remove_imported_data = { data: "OK", error: null };
  assert.equal((await route.PATCH(json("PATCH", { action: "remove_data", confirm: "REMOVE_DATA" }), ctx())).status, 200);
  db.rpcResults.tgp_remove_imported_data = { data: "FORBIDDEN", error: null };
  const agent = load("app/api/telegram-personal/connections/[sessionId]/route.ts", { db, userId: AGENT, role: "agent" });
  assert.equal((await agent.PATCH(json("PATCH", { action: "remove_data", confirm: "REMOVE_DATA" }), ctx())).status, 403);
});

test("automatic sharing: holder only, boolean input, state reported, not installed is explained", async () => {
  const db = visibilityDb([ACC1]);
  const req = (url, method = "GET", body) => Object.assign(new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), { nextUrl: new URL(url) });
  const asOwner = load("app/api/telegram-personal/connections/[sessionId]/chats/route.ts", { db, userId: OTHER_OWNER });
  assert.equal((await asOwner.POST(req("https://tenh.test/x", "POST", { action: "auto_share", enabled: true }), ctx())).status, 404);
  const holder = load("app/api/telegram-personal/connections/[sessionId]/chats/route.ts", { db });
  assert.equal((await holder.POST(req("https://tenh.test/x", "POST", { action: "auto_share", enabled: "yes" }), ctx())).status, 400);
  db.rpcResults.tgp_set_auto_share = { data: "OK", error: null };
  const on = await holder.POST(req("https://tenh.test/x", "POST", { action: "auto_share", enabled: true }), ctx());
  assert.equal(on.status, 200);
  const call = db.rpcCalls.find((c) => c.name === "tgp_set_auto_share");
  assert.deepEqual([call.args.p_user, call.args.p_business, call.args.p_enabled], [HOLDER, B1, true]);
  db.rpcResults.tgp_set_auto_share = { data: null, error: { code: "42883" } };
  const missing = await holder.POST(req("https://tenh.test/x", "POST", { action: "auto_share", enabled: true }), ctx());
  assert.equal((await missing.json()).code, "NOT_INSTALLED");
  db.tables.telegram_personal_sessions[0].auto_share = true;
  const state = await (await holder.GET(req("https://tenh.test/x"), ctx())).json();
  assert.deepEqual([state.autoShare, state.autoShareAvailable], [true, true]);
});

const fileReq = (fields, file) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) form.set("file", file, file.name);
  return new Request("https://tenh.test/api/telegram-personal/send", { method: "POST", body: form });
};

test("send file: staged privately under this request, queued with its details, quote passed through", async () => {
  const db = sendDb();
  db.rpcResults.tgp_enqueue_send_v2 = { data: { ok: true, command_id: "k", state: "queued" }, error: null };
  db.rpcResults.tgp_send_state = { data: { state: "done", message_id: "m" }, error: null };
  const quote = "77777777-7777-4777-8777-777777777777";
  const file = new File([new Uint8Array(2048)], "../../Price list.pdf", { type: "application/pdf" });
  const response = await sendRoute({ db }).POST(fileReq({ conversationId: CONV, clientRequestId: REQ, text: "prices", replyToMessageId: quote }, file));
  assert.equal(response.status, 200);
  const path = `${B1}/tgp-outbox/${REQ}/Price_list.pdf`;
  assert.deepEqual(db.objects.get(`tenh-message-media/${path}`), { size: 2048, contentType: "application/pdf" });
  const call = db.rpcCalls.find((c) => c.name === "tgp_enqueue_send_v2");
  assert.deepEqual({ ...call.args.p_media }, { kind: "document", storage_path: path, size: 2048, mime_type: "application/pdf", name: "Price_list.pdf" });
  assert.equal(call.args.p_reply_to, quote);
  assert.equal(call.args.p_text, "prices");
});

test("send file: photos are photos; refused sends remove the staged file; size and caption limits", async () => {
  const db = sendDb();
  db.rpcResults.tgp_enqueue_send_v2 = { data: { ok: false, code: "RATE_LIMITED" }, error: null };
  const photo = new File([new Uint8Array(10)], "cat.jpg", { type: "image/jpeg" });
  const refused = await sendRoute({ db }).POST(fileReq({ conversationId: CONV, clientRequestId: REQ, text: "" }, photo));
  assert.equal(refused.status, 429);
  assert.equal(db.rpcCalls.find((c) => c.name === "tgp_enqueue_send_v2").args.p_media.kind, "photo");
  assert.deepEqual([...db.removed], [`tenh-message-media/${B1}/tgp-outbox/${REQ}/cat.jpg`]);
  assert.equal(db.objects.size, 0);
  const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.bin");
  assert.equal((await sendRoute({ db }).POST(fileReq({ conversationId: CONV, clientRequestId: REQ, text: "" }, big))).status, 413);
  const longCaption = await sendRoute({ db }).POST(fileReq({ conversationId: CONV, clientRequestId: REQ, text: "x".repeat(1025) }, photo));
  assert.equal(longCaption.status, 400);
  const badQuote = await sendRoute({ db }).POST(sendReq({ conversationId: CONV, clientRequestId: REQ, text: "hi", replyToMessageId: "nope" }));
  assert.equal(badQuote.status, 400);
});

test("send: works on the earlier SQL for plain text; files and quotes explain the missing update", async () => {
  const db = sendDb();
  db.rpcResults.tgp_enqueue_send_v2 = { data: null, error: { code: "42883" } };
  db.rpcResults.tgp_enqueue_send = { data: { ok: true, command_id: "k", state: "queued" }, error: null };
  db.rpcResults.tgp_send_state = { data: { state: "done" }, error: null };
  const text = await sendRoute({ db }).POST(sendReq({ conversationId: CONV, clientRequestId: REQ, text: "hi" }));
  assert.equal(text.status, 200);
  assert.equal(db.rpcCalls.filter((c) => c.name === "tgp_enqueue_send").length, 1);
  const quote = await sendRoute({ db }).POST(sendReq({ conversationId: CONV, clientRequestId: REQ, text: "hi", replyToMessageId: "77777777-7777-4777-8777-777777777777" }));
  assert.equal((await quote.json()).code, "NOT_INSTALLED");
  const file = await sendRoute({ db }).POST(fileReq({ conversationId: CONV, clientRequestId: REQ, text: "" }, new File([new Uint8Array(5)], "a.txt", { type: "text/plain" })));
  assert.equal(file.status, 409);
  assert.equal(db.objects.size, 0, "staged file removed when the queue is not installed");
});

test("Telegram Personal messages can be quoted, not edited, deleted or pinned from TENH", () => {
  const actions = loader({})("lib/inbox/message-actions.ts");
  const message = { id: "m1", platform_message_id: `tgp:${ACC1}:5001:10`, conversation_id: CONV, direction: "incoming", message_type: "text", message_text: "hi", attachment_url: null, raw_payload: {} };
  assert.deepEqual({ ...actions.getMessageActions(message, "telegram_personal") }, { reply: true, pin: false, edit: false, delete: false });
  assert.deepEqual({ ...actions.getMessageActions({ ...message, direction: "outgoing" }, "facebook") }, { reply: true, pin: false, edit: false, delete: false });
});
