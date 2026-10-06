const test = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./tenh-seven/harness.cjs");

/*
 * Conversation action feedback -- guards, one toast per action, Mark Unread
 * ordering and count, and Facebook comment outcomes -- with synthetic data and
 * mocked providers only. No real Facebook calls and no database.
 */

const nextServer = {
  NextResponse: {
    json: (data, init = {}) => new Response(JSON.stringify(data), {
      status: init.status || 200,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    }),
  },
  NextRequest: Request,
};

const feedback = loader({})("lib/inbox/action-feedback.ts");

/* ------------------------------------------------------------ guards */

test("double click: the second identical action on one conversation is refused synchronously", () => {
  const guard = new feedback.ActionGuard();
  assert.equal(guard.begin("c1", "pin", "Saving"), true);
  assert.equal(guard.begin("c1", "pin", "Saving"), false, "refused before any render");
  assert.equal(guard.label("c1", "pin"), "Saving");
  guard.end("c1", "pin");
  assert.equal(guard.begin("c1", "pin", "Saving"), true, "usable again once settled");
});

test("independent conversations stay usable while one is pending", () => {
  const guard = new feedback.ActionGuard();
  guard.begin("c1", "pin", "Saving");
  assert.equal(guard.begin("c2", "pin", "Saving"), true, "another conversation is not blocked");
  assert.equal(guard.begin("c1", "status", "Saving"), true, "another action on the same conversation is not blocked");
  assert.equal(guard.isPending("c2", "status"), false);
});

test("Assign and Assign to me share one per-conversation slot (claim conflict guard)", () => {
  const guard = new feedback.ActionGuard();
  guard.begin("c1", "assign", "Assigning to you");
  assert.equal(guard.begin("c1", "assign", "Assigning"), false);
});

/* ------------------------------------------------- one toast per action */

const activity = (overrides = {}) => ({
  conversation_id: "c1", activity_type: "pinned", actor_member_id: "me", ...overrides,
});

test("response first, then our own realtime echo: exactly one toast", () => {
  const ledger = new feedback.ActionNotificationLedger();
  const token = ledger.expect("c1", ["pinned"], "me");
  assert.equal(ledger.confirmLocal(token), true, "the response shows it");
  assert.equal(ledger.claimRealtime(activity()), "suppress", "the echo does not");
});

test("realtime echo first, then the response: exactly one toast", () => {
  const ledger = new feedback.ActionNotificationLedger();
  const token = ledger.expect("c1", ["status_changed"], "me");
  assert.equal(ledger.claimRealtime(activity({ activity_type: "status_changed" })), "show");
  assert.equal(ledger.confirmLocal(token), false, "the response does not toast again");
});

test("a teammate's activity and my own from another device are always shown", () => {
  const ledger = new feedback.ActionNotificationLedger();
  const token = ledger.expect("c1", ["pinned"], "me");
  ledger.confirmLocal(token);
  assert.equal(ledger.claimRealtime(activity({ actor_member_id: "teammate" })), "show");
  assert.equal(ledger.claimRealtime(activity({ conversation_id: "c2" })), "show", "other conversation");
  const fresh = new feedback.ActionNotificationLedger();
  assert.equal(fresh.claimRealtime(activity()), "show", "no local action here: another device");
});

test("a failed action releases its entry; a late echo past the window is shown", () => {
  let now = 1_000;
  const ledger = new feedback.ActionNotificationLedger(() => now);
  const failed = ledger.expect("c1", ["pinned"], "me");
  ledger.cancel(failed);
  assert.equal(ledger.claimRealtime(activity()), "show");
  const ok = ledger.expect("c1", ["pinned"], "me");
  ledger.confirmLocal(ok);
  now += 25_000;
  assert.equal(ledger.claimRealtime(activity()), "show", "a much later identical action is new");
});

test("rapid toggles with out-of-order echoes: each action gets one toast", () => {
  const ledger = new feedback.ActionNotificationLedger();
  const pin = ledger.expect("c1", ["pinned"], "me");
  const unpin = ledger.expect("c1", ["unpinned"], "me");
  assert.equal(ledger.claimRealtime(activity({ activity_type: "unpinned" })), "show", "unpin echo pairs with unpin");
  assert.equal(ledger.confirmLocal(pin), true, "pin still shows once");
  assert.equal(ledger.claimRealtime(activity()), "suppress");
  assert.equal(ledger.confirmLocal(unpin), false);
});

test("rapid toggles: each action gets its own single toast", () => {
  const ledger = new feedback.ActionNotificationLedger();
  const pin = ledger.expect("c1", ["pinned"], "me");
  assert.equal(ledger.confirmLocal(pin), true);
  assert.equal(ledger.claimRealtime(activity()), "suppress");
  const unpin = ledger.expect("c1", ["unpinned"], "me");
  assert.equal(ledger.claimRealtime(activity({ activity_type: "unpinned" })), "show");
  assert.equal(ledger.confirmLocal(unpin), false);
});

test("rollback never overwrites a teammate's newer value", () => {
  const ours = { id: "c1", assigned_to: "me-target" };
  const theirs = { id: "c1", assigned_to: "teammate" };
  assert.equal(feedback.revertIfStillOurs(ours, "assigned_to", "me-target", { assigned_to: null }).assigned_to, null);
  assert.equal(feedback.revertIfStillOurs(theirs, "assigned_to", "me-target", { assigned_to: null }).assigned_to, "teammate");
});

/* ------------------------------------------------- Mark Unread ordering */

test("late auto-read: awaiting the exact read keeps Mark Unread the later write (old 5 s poll did not)", async () => {
  // Server state is the last write it applied.
  const scenario = async ({ readLatencyMs, pollCapMs }) => {
    let clock = 0; const writes = [];
    const timers = [];
    const sleep = (ms) => new Promise((resolve) => timers.push({ at: clock + ms, resolve }));
    const advanceTo = async (until) => {
      timers.sort((a, b) => a.at - b.at);
      while (timers.length && timers[0].at <= until) { const t = timers.shift(); clock = t.at; t.resolve(); await null; await null; timers.sort((a, b) => a.at - b.at); }
      clock = until;
    };
    const readDone = sleep(readLatencyMs).then(() => writes.push(["read", clock]));
    let unreadSent;
    if (pollCapMs != null) {
      // Old: poll every 25 ms up to the cap, then send regardless.
      unreadSent = (async () => { for (let t = 0; t < pollCapMs; t += 25) { if (writes.length) break; await sleep(25); } writes.push(["unread", clock]); })();
    } else {
      unreadSent = (async () => { await readDone; writes.push(["unread", clock]); })();
    }
    await advanceTo(readLatencyMs + 6_000);
    await unreadSent;
    return writes.map(([kind]) => kind);
  };
  assert.deepEqual(await scenario({ readLatencyMs: 7_000, pollCapMs: 5_000 }), ["unread", "read"], "reproduction: the slow read lands last and erases Unread");
  assert.deepEqual(await scenario({ readLatencyMs: 7_000 }), ["read", "unread"], "fixed: Unread is always the later write");
  assert.deepEqual(await scenario({ readLatencyMs: 40 }), ["read", "unread"]);
});

/* --------------------------------------------- Mark Unread server count */

function fakeSupabase(messages, { conversation = { id: "c1", business_id: "b1", unread_count: 0 } } = {}) {
  const log = [];
  const from = (table) => {
    const q = { table, filters: [], head: false, count: null, selectCols: null, orderDesc: false, limit: Infinity, update: null, or: null };
    const chain = {
      select(cols, opts = {}) { q.selectCols = cols; if (opts.head) q.head = true; if (opts.count) q.count = opts.count; return chain; },
      eq(k, v) { q.filters.push((r) => r[k] === v); return chain; },
      gt(k, v) { q.filters.push((r) => r[k] > v); return chain; },
      or(expr) { q.or = expr; q.filters.push((r) => r.direction == null || r.direction !== "incoming"); return chain; },
      order(_k, { ascending }) { q.orderDesc = !ascending; return chain; },
      limit(n) { q.limit = n; return chain; },
      update(body) { q.update = body; return chain; },
      maybeSingle() { return run(true); },
      then(resolve, reject) { return run(false).then(resolve, reject); },
    };
    const run = async (single) => {
      log.push({ table, head: q.head, limit: q.limit, update: Boolean(q.update) });
      if (table === "conversations") {
        if (q.update) Object.assign(conversation, q.update);
        return { data: { ...conversation }, error: null };
      }
      let rows = messages.filter((r) => q.filters.every((f) => f(r)));
      if (q.orderDesc) rows = rows.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
      rows = rows.slice(0, q.limit);
      if (q.head) return { data: null, count: rows.length, error: null };
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    return chain;
  };
  return { supabaseAdmin: { from }, log, conversation };
}

function loadUnread(messages) {
  const db = fakeSupabase(messages);
  const route = loader({
    "next/server": nextServer,
    "@/lib/supabase/admin": { supabaseAdmin: db.supabaseAdmin },
    "@/lib/inbox/get-inbox-resource-access": { getInboxConversationAccess: async () => ({ success: true, member: { id: "m1", business_id: "b1" } }) },
  }, { performance })("app/api/conversations/[conversationId]/unread/route.ts");
  return { route, db };
}

const oldCount = (messages) => {
  let n = 0;
  for (const m of messages.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))) { if (m.direction !== "incoming") break; n += 1; }
  return n === 0 ? 1 : n;
};

const thread = (dirs) => dirs.map((direction, i) => ({ id: `m${i}`, business_id: "b1", conversation_id: "c1", direction,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() }));

test("unread count: identical to the old full-history walk on varied threads", async () => {
  const cases = [
    ["incoming", "incoming", "outgoing", "incoming", "incoming", "incoming"],
    ["outgoing", "incoming", "incoming", "outgoing"],
    ["incoming", "incoming"],
    ["outgoing"],
    [],
    ["incoming", null, "incoming", "incoming"],
  ];
  for (let seed = 0; seed < 40; seed += 1) {
    cases.push(Array.from({ length: 1 + (seed * 7) % 30 }, (_, i) => ((seed + i * 3) % 5 === 0 ? "outgoing" : "incoming")));
  }
  for (const dirs of cases) {
    const messages = thread(dirs);
    const { route, db } = loadUnread(messages);
    const response = await route.PATCH(new Request("http://x"), { params: Promise.resolve({ conversationId: "c1" }) });
    const body = await response.json();
    assert.equal(body.conversation.unread_count, oldCount(messages), JSON.stringify(dirs));
    const reads = db.log.filter((entry) => entry.table === "messages");
    assert.equal(reads.length, 2, "two bounded reads");
    assert.ok(reads.every((entry) => entry.head || entry.limit === 1), "no full-history read");
  }
});

test("unread route reports per-phase Server-Timing", async () => {
  const { route } = loadUnread(thread(["outgoing", "incoming"]));
  const response = await route.PATCH(new Request("http://x"), { params: Promise.resolve({ conversationId: "c1" }) });
  const timing = response.headers.get("Server-Timing");
  assert.match(timing, /auth;dur=/); assert.match(timing, /count;dur=/); assert.match(timing, /db;dur=/);
  console.log(JSON.stringify({ unreadServerTiming: timing }));
});

/* ---------------------------------------- Facebook comment route outcomes */

function loadCommentRoute(name, { graph, dbError = null, reconcileThrows = false }) {
  const calls = [];
  const graphFetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ method: init.method || "GET", url: u });
    const reply = graph({ method: init.method || "GET", url: u, calls });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
  const db = { from: () => { const c = { update: () => c, eq: () => c, then: (resolve) => resolve({ error: dbError }) }; return c; } };
  const route = loader({
    "next/server": nextServer,
    "@/lib/supabase/admin": { supabaseAdmin: db },
    "@/lib/facebook/get-facebook-page-access-token": { isFacebookAccessTokenError: () => false, refreshFacebookPageAccessToken: async () => "fresh" },
    "@/lib/auth/require-permission": { memberHasPermission: async () => true, permissionDenied: () => new Response("{}", { status: 403 }) },
    "../_shared": {
      FacebookCommentContextError: class extends Error {},
      loadAuthorizedFacebookCommentActionContext: async () => ({ member: { id: "m1", business_id: "b1" }, message: { id: "msg1" }, pageId: "p1", pageAccessToken: "tok" }),
    },
    "@/lib/facebook/mark-comment-thread-deleted": {
      markFacebookCommentThreadDeleted: async () => { if (reconcileThrows) throw new Error("reconcile failed"); },
    },
  }, { performance, fetch: graphFetch, AbortSignal, URLSearchParams })(`app/api/facebook/comments/${name}/route.ts`);
  return { route, calls };
}

const post = (body) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const missing = { status: 400, body: { error: { code: 100, error_subcode: 33, message: "(#100) Object does not exist" } } };

test("deleted only on structured, twice-confirmed evidence", async () => {
  {
    const { route } = loadCommentRoute("like", { graph: () => missing });
    const response = await route.POST(post({ commentId: "cm1", liked: true }));
    assert.equal(response.status, 410); assert.equal((await response.json()).code, "COMMENT_DELETED");
  }
  {
    // (#100) with another subcode -- generic parameter error -- is not deletion.
    const { route } = loadCommentRoute("like", { graph: () => ({ status: 400, body: { error: { code: 100, error_subcode: 1, message: "(#100) Invalid parameter" } } }) });
    const body = await (await route.POST(post({ commentId: "cm1", liked: true }))).json();
    assert.equal(body.code, undefined); assert.equal(body.success, false);
  }
  {
    // The action says missing but a direct read finds it: not deleted.
    const { route } = loadCommentRoute("hide", { graph: ({ method }) => method === "GET" ? { status: 200, body: { id: "cm1" } } : missing });
    const body = await (await route.POST(post({ commentId: "cm1", hidden: true }))).json();
    assert.equal(body.code, undefined);
  }
});

test("provider accepted, local save failed: partial success, not failure (Like and Hide)", async () => {
  {
    const { route } = loadCommentRoute("like", { graph: () => ({ status: 200, body: { success: true } }), dbError: { message: "db down" } });
    const response = await route.POST(post({ commentId: "cm1", liked: true }));
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.success, true); assert.equal(body.partial, true);
  }
  {
    const { route } = loadCommentRoute("hide", { graph: ({ method }) => method === "GET" ? { status: 200, body: { is_hidden: true } } : { status: 200, body: { success: true } }, dbError: { message: "db down" } });
    const body = await (await route.POST(post({ commentId: "cm1", hidden: true }))).json();
    assert.equal(body.success, true); assert.equal(body.partial, true);
  }
});

test("Hide keeps its verification: Meta accepted but still visible is reported", async () => {
  const { route, calls } = loadCommentRoute("hide", { graph: ({ method }) => method === "GET" ? { status: 200, body: { is_hidden: false } } : { status: 200, body: { success: true } } });
  const response = await route.POST(post({ commentId: "cm1", hidden: true }));
  assert.equal(response.status, 502);
  assert.equal(calls.filter((c) => c.method === "GET").length, 1, "one verification read");
});

test("Delete: reconciliation runs after Facebook confirms, and succeeds normally", async () => {
  const { route } = loadCommentRoute("delete", { graph: () => ({ status: 200, body: { success: true } }) });
  const response = await route.POST(post({ commentId: "cm1" }));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.partial, undefined); assert.equal(body.success, true);
  assert.match(response.headers.get("Server-Timing"), /reconcile;dur=/);
});

test("Delete: Facebook deleted it but reconciliation failed is partial, not a 500", async () => {
  const { route } = loadCommentRoute("delete", { graph: () => ({ status: 200, body: { success: true } }), reconcileThrows: true });
  const response = await route.POST(post({ commentId: "cm1" }));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.partial, true);
});

test("comment routes report per-phase Server-Timing", async () => {
  const { route } = loadCommentRoute("hide", { graph: ({ method }) => method === "GET" ? { status: 200, body: { is_hidden: true } } : { status: 200, body: { success: true } } });
  const timing = (await route.POST(post({ commentId: "cm1", hidden: true }))).headers.get("Server-Timing");
  for (const phase of ["auth", "meta", "verify", "db"]) assert.match(timing, new RegExp(`${phase};dur=`));
  console.log(JSON.stringify({ hideServerTiming: timing }));
});

/* ------------------------------------------- browser-side comment outcomes */

const { requestCommentAction } = loader({})("lib/inbox/comment-action-request.ts");
const send = (status, body) => async () => new Response(body == null ? "" : JSON.stringify(body), { status });

test("client outcomes: deleted, partial, failed, uncertain timeout and network loss", async () => {
  assert.equal((await requestCommentAction("/x", {}, "fail", send(410, { success: false, code: "COMMENT_DELETED" }))).kind, "deleted");
  assert.equal((await requestCommentAction("/x", {}, "fail", send(200, { success: true, partial: true, warning: "w" }))).kind, "partial");
  assert.equal((await requestCommentAction("/x", {}, "fail", send(400, { success: false, error: "(#100) Invalid parameter" }))).kind, "failed", "error text alone never means deleted");
  assert.equal((await requestCommentAction("/x", {}, "fail", send(504, null))).kind, "uncertain", "gateway timeout after the call");
  assert.equal((await requestCommentAction("/x", {}, "fail", async () => { throw new TypeError("network"); })).kind, "uncertain");
  assert.equal((await requestCommentAction("/x", {}, "fail", send(200, { success: true }))).kind, "ok");
});
