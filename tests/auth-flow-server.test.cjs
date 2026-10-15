/* eslint-disable @typescript-eslint/no-require-imports */
// Real route/helper execution with isolated provider, cookie and database boundaries.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const ssr = require("@supabase/ssr");
const root = process.cwd();
const user = { id: "10000000-0000-4000-8000-000000000001", email: "fixture@example.test", email_confirmed_at: "2026-10-15T00:00:00Z" };
const sessionId = "20000000-0000-4000-8000-000000000001";
const accessToken = "private-access-token-fixture";
const refreshToken = "private-refresh-token-fixture";
const envNames = ["TENH_APP_ORIGIN", "TENH_AUTH_COOKIE_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
Object.assign(process.env, { TENH_APP_ORIGIN: "https://app.test", TENH_AUTH_COOKIE_SECRET: "isolated-cookie-signing-key", NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "isolated-public-key" });
test.after(() => { for (const name of envNames) { if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name]; } });

class FakeNextResponse extends Response {
  static json(body, init = {}) { return new FakeNextResponse(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", ...init.headers } }); }
  static redirect(url, init = {}) { return new FakeNextResponse(null, { status: 307, ...init, headers: { ...init.headers, Location: String(url) } }); }
}

function cookieJar() {
  const values = new Map();
  const writes = [];
  return {
    writes, values,
    get: name => values.has(name) ? { name, value: values.get(name) } : undefined,
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    set(name, value, options = {}) { writes.push({ name, value, options }); if (options.maxAge === 0) values.delete(name); else values.set(name, value); },
  };
}

function loader(overrides, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const context = { module: loaded, exports: loaded.exports, Buffer, process, URL, Request, Response, Headers, setTimeout, clearTimeout,
      fetch: () => { throw new Error("Unexpected network request in isolated Auth test"); }, ...globals,
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name === "server-only") return {};
        if (name.startsWith("@/") || name.startsWith(".")) {
          const target = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
          const resolved = [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
          if (!resolved) throw new Error(`Unresolved isolated import ${name}`);
          return load(resolved);
        }
        return require(name);
      },
    };
    vm.runInNewContext(source, context, { filename: file });
    return loaded.exports;
  }
  return load;
}

function fixture() {
  const jar = cookieJar(), calls = [], logs = [];
  const state = { now: Date.now(), claimed: false, policy: null, limit: { allowed: true, retryAfterSeconds: 0 } };
  class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [state.now])); } static now() { return state.now; } }
  const providerSession = { access_token: accessToken, refresh_token: refreshToken, user };
  const success = () => ({ data: { user, session: providerSession }, error: null });
  const establishCookie = () => jar.set("sb-fixture-auth-token.0", accessToken, { path: "/", maxAge: 400 * 86400 });
  const auth = {
    signInWithPassword: async args => { calls.push(["password-login", args]); if (state.loginError) return { data: {}, error: state.loginError }; establishCookie(); return success(); },
    signInWithOAuth: async args => { calls.push(["oauth-start", args]); return { data: { url: state.oauthUrl ?? "https://provider.test/authorize" }, error: state.oauthError ?? null }; },
    exchangeCodeForSession: async code => { calls.push(["oauth-exchange", code]); if (state.exchangeError) return { data: {}, error: state.exchangeError }; establishCookie(); return success(); },
    getUser: async () => ({ data: { user: state.noUser ? null : user }, error: state.userError ?? null }),
    signUp: async args => { calls.push(["signup", args]); return state.signupResult ?? { data: { user: { ...user, identities: [{}] }, session: null }, error: null }; },
    resetPasswordForEmail: async (...args) => { calls.push(["recover-email", ...args]); return { error: state.emailError ?? null }; },
    resend: async args => { calls.push(["resend", args]); return { error: state.emailError ?? null }; },
    verifyOtp: async args => {
      calls.push(["verify-otp", args]);
      if (state.otpError || state.usedOtp || (args.token_hash && args.token_hash !== `${args.type}-valid`)) return { data: {}, error: { message: "private-provider-expired-or-reused-token", status: 403 } };
      state.usedOtp = true; establishCookie(); return success();
    },
    updateUser: async args => { calls.push(["password-update", args]); if (state.updateThrows) throw new Error(`${accessToken} provider response lost`); return { data: { user }, error: state.updateError ?? null }; },
    signOut: async args => { calls.push(["signout", args]); if (state.signoutThrows) throw new Error(`${refreshToken} signout response lost`); return { error: state.signoutError ?? null }; },
  };
  const client = { auth };
  const policyApi = {
    bindSessionPolicy: async (_client, _user, remembered, kind = "normal") => {
      calls.push(["bind", remembered, kind]);
      if (state.bindFailure) return { allowed: false, status: 503, reason: "policy-unavailable" };
      state.policy ??= { allowed: true, sessionId, authenticatedAt: new FixtureDate().toISOString(), expiresAt: new FixtureDate(state.now + (remembered ? 30 : 1) * 86400000).toISOString(), remembered, kind, aal: "aal1", recentMfa: false, recentAuthentication: true };
      return state.policy;
    },
    checkSessionPolicy: async (_client, _user, options = {}) => {
      calls.push(["check", options]);
      if (state.policyFailure) return state.policyFailure;
      if (!state.policy || state.claimed || Date.parse(state.policy.expiresAt) <= state.now) return { allowed: false, status: 401, reason: state.claimed ? "revoked" : "expired" };
      if (state.policy.kind === "recovery" && !options.allowRecovery) return { allowed: false, status: 403, reason: "recovery" };
      return state.policy;
    },
    revokeSessionPolicies: async (...args) => { calls.push(["revoke-ledger", ...args]); return !state.revokeFailure; },
  };
  const admin = { rpc: async (name, args) => {
    calls.push(["rpc", name, args]);
    if (name === "tenh_get_session_policy_settings") return { data: { remember_days: 30 }, error: null };
    if (name === "tenh_claim_recovery_session") {
      if (state.claimError) return { data: null, error: {} };
      const allowed = !state.claimed; state.claimed = true; return { data: allowed, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  } };
  const overrides = {
    "next/server": { NextResponse: FakeNextResponse }, "next/headers": { cookies: async () => jar },
    "@/lib/supabase/server": { createClient: async options => { calls.push(["create-client", options]); return client; } },
    "@/lib/supabase/admin": { supabaseAdmin: admin }, "@/lib/auth/session-policy": policyApi,
    "@/lib/auth/rate-limit": { consumeAuthRateLimit: async (...args) => { calls.push(["rate", args[1], args[2]]); return state.limit; } },
    "@/lib/auth/get-current-member": { TENH_ACTIVE_BUSINESS_COOKIE: "tenh_active_business", resolveActiveWorkspaceSelection: async () => "existing-workspace" },
    "@/lib/onboarding/ensure-user-workspace": { provisionUserWorkspace: async () => { calls.push(["provision"]); return { success: true, trialGranted: true, member: { business_id: "fixture-workspace" } }; } },
    "@/lib/team/subscription-invitations": { loadInvitationByToken: async () => ({ success: true, invitation: { email: user.email, status: "pending", expires_at: new FixtureDate(state.now + 600000).toISOString() } }) },
  };
  const load = loader(overrides, { Date: FixtureDate, console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args), log: (...args) => logs.push(args) } });
  const api = load("app/api/auth/[action]/route.ts");
  const post = (action, body, origin = "https://app.test") => api.POST(new Request(`https://app.test/api/auth/${action}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });
  const get = action => api.GET(new Request(`https://app.test/api/auth/${action}`), { params: Promise.resolve({ action }) });
  return { state, jar, calls, logs, auth, client, policyApi, overrides, load, post, get };
}

test("return paths reject the original newline parser bypass and encoded variants", () => {
  const { safeAuthReturnPath } = loader({})("lib/auth/return-path.ts");
  const originalNext = "/\n/attacker.example";
  assert.equal(originalNext.startsWith("/") && !originalNext.startsWith("//") && !originalNext.includes("\\"), true);
  assert.equal(new URL(originalNext, "https://app.test").origin, "https://attacker.example");
  for (const unsafe of [originalNext, "/\t/attacker.example", "//attacker.example", "/\\attacker.example", "/%0a/attacker.example", "/%250a/attacker.example", "/%252f%252fattacker.example", "/dashboard/%2e%2e/auth/callback", "/login", "https://attacker.example", " /dashboard/inbox"]) {
    assert.equal(safeAuthReturnPath(unsafe, "https://app.test"), "/dashboard/inbox", JSON.stringify(unsafe));
  }
  assert.equal(safeAuthReturnPath("/invite/accept?token=fixture", "https://app.test"), "/invite/accept?token=fixture");
  assert.equal(safeAuthReturnPath("/dashboard/reports?period=7d", "https://app.test"), "/dashboard/reports?period=7d");
});

test("password login uses trusted policy duration, preserves immutable binding and exposes no provider secrets", async () => {
  const f = fixture();
  let response = await f.post("login", { email: " Fixture@Example.test ", password: "Password123", rememberMe: false, rememberDays: 999, expiresAt: "2099-01-01", next: "/\n/attacker.example" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).redirect, "/dashboard/inbox");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(call => call[0] === "password-login")[1])), { email: user.email, password: "Password123" });
  assert.deepEqual(Array.from(f.calls.find(call => call[0] === "bind").slice(1)), [false, "normal"]);
  const firstExpiry = f.state.policy.expiresAt;
  const lastAuthCookie = f.jar.writes.filter(write => write.name === "sb-fixture-auth-token.0").at(-1);
  assert.equal(lastAuthCookie.options.maxAge, undefined);
  assert.equal(lastAuthCookie.options.expires, undefined);
  response = await f.post("login", { email: user.email, password: "Password123", rememberMe: true, next: "/dashboard/inbox" });
  assert.equal(response.status, 200);
  assert.equal(f.state.policy.expiresAt, firstExpiry);
  assert.equal(f.state.policy.remembered, false);
  const signedHint = f.jar.get("tenh_session_hint").value;
  assert.ok(!signedHint.includes(accessToken));
  assert.ok(!JSON.stringify(f.logs).includes("Password123"));
  f.state.loginError = { message: `${accessToken} ${refreshToken}`, status: 400 };
  response = await f.post("login", { email: user.email, password: "Password123", rememberMe: false });
  assert.equal(response.status, 400);
  assert.ok(!JSON.stringify(await response.json()).includes(accessToken));
  f.state.loginError = null; f.state.bindFailure = true;
  response = await f.post("login", { email: user.email, password: "Password123", rememberMe: false });
  assert.equal(response.status, 503);
  assert.equal(f.jar.get("sb-fixture-auth-token.0"), undefined);
  const before = f.calls.length;
  assert.equal((await f.post("login", { email: user.email, password: "Password123", rememberMe: false }, "https://attacker.example")).status, 403);
  assert.equal(f.calls.length, before);
});

test("OAuth callback requires an untampered, unexpired, matching intent and consumes it once", async () => {
  const f = fixture();
  assert.equal((await f.post("oauth", { provider: "google", rememberMe: true, next: "/invite/accept?token=fixture" })).status, 200);
  const callback = f.load("app/auth/callback/route.ts");
  const { verifyAuthTicket, signAuthTicket } = f.load("lib/auth/auth-ticket.ts");
  const original = f.jar.get("tenh_auth_intent").value;
  const intent = verifyAuthTicket(original, "oauth");
  const invoke = nonce => callback.GET(new Request(`https://app.test/auth/callback?code=fixture&intent=${encodeURIComponent(nonce)}`));
  let response = await invoke("wrong-nonce");
  assert.match(response.headers.get("location"), /oauth_callback_failed/);
  assert.equal(f.calls.filter(call => call[0] === "oauth-exchange").length, 0);
  f.jar.set("tenh_auth_intent", `${original}tampered`);
  response = await invoke(intent.nonce);
  assert.match(response.headers.get("location"), /oauth_callback_failed/);
  f.jar.set("tenh_auth_intent", signAuthTicket({ ...intent, issuedAt: f.state.now - 600001 }, "oauth"));
  assert.match((await invoke(intent.nonce)).headers.get("location"), /oauth_callback_failed/);
  f.jar.set("tenh_auth_intent", signAuthTicket({ ...intent, issuedAt: f.state.now + 1 }, "oauth"));
  assert.match((await invoke(intent.nonce)).headers.get("location"), /oauth_callback_failed/);
  f.jar.set("tenh_auth_intent", original);
  response = await invoke(intent.nonce);
  assert.equal(response.headers.get("location"), "https://app.test/invite/accept?token=fixture");
  assert.equal(f.state.policy.remembered, true);
  assert.equal(f.calls.filter(call => call[0] === "provision").length, 0);
  assert.match((await invoke(intent.nonce)).headers.get("location"), /oauth_callback_failed/);
  assert.equal(f.calls.filter(call => call[0] === "oauth-exchange").length, 1);
  assert.equal(verifyAuthTicket(original, "recovery"), null);
});

test("login validates remember selection, throttles before provider calls and keeps failures generic", async () => {
  const f = fixture(), body = { email: user.email, password: "Password123", rememberMe: false };
  assert.equal((await f.post("login", { ...body, rememberMe: "true" })).status, 400);
  assert.equal(f.calls.filter(call => call[0] === "password-login").length, 0);
  f.state.limit = { allowed: false, retryAfterSeconds: 80 };
  let response = await f.post("login", body);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "80");
  f.state.limit.unavailable = true;
  assert.equal((await f.post("login", body)).status, 503);
  assert.equal(f.calls.filter(call => call[0] === "password-login").length, 0);
  f.state.limit = { allowed: true, retryAfterSeconds: 0 };
  const results = [];
  for (const code of ["invalid_credentials", "user_not_found", "email_not_confirmed"]) {
    f.state.loginError = { code, message: `${accessToken} ${refreshToken} ${user.email}` };
    response = await f.post("login", body);
    results.push([response.status, await response.json()]);
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
  assert.ok(!JSON.stringify(results).includes(accessToken));
  assert.equal((await f.get("policy")).status, 200);
  assert.equal((await f.get("session")).status, 401);
  assert.equal((await f.get("not-a-route")).status, 404);
});

test("OAuth provider and policy failures stay generic and policy failures clear auth cookies", async () => {
  const f = fixture();
  await f.post("oauth", { provider: "facebook", rememberMe: false });
  const original = f.jar.get("tenh_auth_intent").value;
  const intent = f.load("lib/auth/auth-ticket.ts").verifyAuthTicket(original, "oauth");
  const callback = f.load("app/auth/callback/route.ts");
  const invoke = () => callback.GET(new Request(`https://app.test/auth/callback?code=fixture&intent=${intent.nonce}`));
  f.state.exchangeError = { message: `${accessToken} ${refreshToken}` };
  assert.match((await invoke()).headers.get("location"), /oauth_callback_failed/);
  f.state.exchangeError = null; f.state.bindFailure = true;
  f.jar.set("tenh_auth_intent", original);
  assert.match((await invoke()).headers.get("location"), /session_unavailable/);
  assert.equal(f.jar.get("sb-fixture-auth-token.0"), undefined);
  assert.ok(!JSON.stringify(f.logs).includes(accessToken));
  assert.ok(!JSON.stringify(f.logs).includes(refreshToken));
});

test("confirmation and recovery require provider-verified typed tokens, not URL flags", async () => {
  const f = fixture(), confirm = f.load("app/auth/confirm/route.ts");
  const invoke = query => confirm.GET(new Request(`https://app.test${query}`));
  for (const query of ["/auth/recovery?success=true", "/auth/recovery?token_hash=email-valid&type=email", "/auth/confirm?token_hash=fixture&type=invite"]) {
    assert.match((await invoke(query)).headers.get("location"), /error=invalid_link/);
  }
  assert.equal(f.calls.filter(call => call[0] === "verify-otp").length, 0);
  assert.match((await invoke("/auth/recovery?token_hash=email-valid&type=recovery")).headers.get("location"), /invalid_link/);
  assert.equal(f.jar.get("tenh_recovery_grant"), undefined);
  f.state.otpError = true;
  assert.match((await invoke("/auth/confirm?token_hash=email-valid&type=email")).headers.get("location"), /invalid_link/);
  f.state.otpError = false;
  let response = await invoke("/auth/confirm?token_hash=signup-valid&type=signup&next=%2Fdashboard%2Freports");
  assert.match(response.headers.get("location"), /login\?confirmed=1/);
  assert.equal(f.calls.filter(call => call[0] === "verify-otp").at(-1)[1].type, "signup");
  assert.equal(f.calls.filter(call => call[0] === "verify-otp").at(-1)[1].token_hash, "signup-valid");
  assert.equal(f.calls.filter(call => call[0] === "bind").length, 0);
  assert.match((await invoke("/auth/confirm?token_hash=signup-valid&type=signup")).headers.get("location"), /invalid_link/);
  f.state.usedOtp = false;
  response = await invoke("/auth/recovery?token_hash=recovery-valid&type=recovery");
  assert.equal(response.headers.get("location"), "https://app.test/reset-password");
  assert.equal(f.state.policy.kind, "recovery");
  const grantCookie = f.jar.writes.find(write => write.name === "tenh_recovery_grant");
  assert.equal(grantCookie.options.httpOnly, true);
  assert.equal((await f.get("recovery-status")).status, 200);
  assert.equal((await f.get("session")).status, 403);
  f.state.now += 600001;
  assert.equal((await f.get("recovery-status")).status, 410);
  assert.ok(!JSON.stringify(f.logs).includes("private-provider"));
});

test("recovery grants reject tampering, wrong identity, normal sessions and wrong session IDs", async () => {
  const f = fixture(), confirm = f.load("app/auth/confirm/route.ts");
  await confirm.GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
  const { signAuthTicket, verifyAuthTicket } = f.load("lib/auth/auth-ticket.ts");
  const original = f.jar.get("tenh_recovery_grant").value;
  const grant = verifyAuthTicket(original, "recovery");
  for (const value of [
    `${original}tampered`,
    signAuthTicket({ ...grant, userId: "another-user" }, "recovery"),
    signAuthTicket({ ...grant, sessionId: "another-session" }, "recovery"),
    signAuthTicket({ ...grant, expiresAt: f.state.now - 1 }, "recovery"),
    signAuthTicket(grant, "oauth"),
  ]) {
    f.jar.set("tenh_recovery_grant", value);
    assert.equal((await f.get("recovery-status")).status, 410);
  }
  f.jar.set("tenh_recovery_grant", original);
  f.state.policy.kind = "normal";
  assert.equal((await f.get("recovery-status")).status, 410);
  assert.equal((await f.post("reset-password", { password: "NewPassword123", confirmPassword: "NewPassword123" })).status, 410);
  assert.equal(f.calls.filter(call => call[0] === "password-update").length, 0);
});

test("session status preserves explicitly classified legacy sessions with nullable policy fields", async () => {
  const f = fixture();
  f.state.policy = { allowed: true, kind: "legacy", sessionId, expiresAt: null, remembered: null };
  const response = await f.get("session");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kind, "legacy");
  assert.equal(body.expiresAt, null);
  assert.equal(body.remembered, null);
  assert.equal(body.userId, user.id);
  assert.equal(body.sessionId, sessionId);
});

test("session and recovery status preserve cookies during temporary Auth and policy failures", async () => {
  const normal = fixture(), recovery = fixture();
  await normal.post("login", { email: user.email, password: "Password123", rememberMe: false });
  await recovery.load("app/auth/confirm/route.ts").GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
  const authCookie = normal.jar.get("sb-fixture-auth-token.0").value;
  const grant = recovery.jar.get("tenh_recovery_grant").value;
  for (const error of [{ status: 503 }, { status: 429 }, { name: "AuthRetryableFetchError" }, { name: "AuthUnknownError" }]) {
    normal.state.userError = error; recovery.state.userError = error;
    assert.equal((await normal.get("session")).status, 503);
    assert.equal((await recovery.get("recovery-status")).status, 503);
    assert.equal(normal.jar.get("sb-fixture-auth-token.0").value, authCookie);
    assert.equal(recovery.jar.get("tenh_recovery_grant").value, grant);
  }
  normal.state.userError = null; recovery.state.userError = null;
  normal.state.policyFailure = { allowed: false, status: 503, reason: "policy-unavailable" };
  recovery.state.policyFailure = { allowed: false, status: 503, reason: "policy-unavailable" };
  assert.equal((await normal.get("session")).status, 503);
  assert.equal((await recovery.get("recovery-status")).status, 503);
  assert.equal(normal.jar.get("sb-fixture-auth-token.0").value, authCookie);
  assert.equal(recovery.jar.get("tenh_recovery_grant").value, grant);
  normal.state.userError = { status: 401 }; recovery.state.userError = { status: 401 };
  assert.equal((await normal.get("session")).status, 401);
  assert.equal((await recovery.get("recovery-status")).status, 410);
});

test("reset authorizes signed recovery grant, claims once, revokes globally and requires fresh login", async () => {
  const f = fixture(), confirm = f.load("app/auth/confirm/route.ts");
  const payload = { password: "NewPassword123", confirmPassword: "NewPassword123" };
  assert.equal((await f.post("reset-password", { ...payload, recovery: true, success: true })).status, 410);
  await confirm.GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
  assert.equal((await f.post("reset-password", { ...payload, confirmPassword: "wrong" })).status, 400);
  assert.equal(f.state.claimed, false);
  const [first, second] = await Promise.all([f.post("reset-password", payload), f.post("reset-password", payload)]);
  assert.deepEqual([first.status, second.status].sort(), [200, 410]);
  assert.equal(f.calls.filter(call => call[0] === "password-update").length, 1);
  assert.equal(f.calls.find(call => call[0] === "revoke-ledger")[2], null);
  assert.equal(f.calls.find(call => call[0] === "signout")[1].scope, "global");
  assert.equal(f.jar.get("tenh_recovery_grant"), undefined);
  assert.equal((await f.post("reset-password", payload)).status, 410);
  const failed = fixture(), failedConfirm = failed.load("app/auth/confirm/route.ts");
  await failedConfirm.GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
  failed.state.updateError = { message: `${accessToken} provider failure` };
  assert.equal((await failed.post("reset-password", payload)).status, 400);
  assert.equal(failed.state.claimed, true);
  assert.equal((await failed.post("reset-password", payload)).status, 410);
  assert.equal(failed.jar.get("tenh_recovery_grant"), undefined);
});

test("reset fails closed when the distributed claim is unavailable and reports pending remote revocation", async () => {
  const f = fixture(), confirm = f.load("app/auth/confirm/route.ts");
  const body = { password: "NewPassword123", confirmPassword: "NewPassword123" };
  await confirm.GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
  f.state.claimError = true;
  assert.equal((await f.post("reset-password", body)).status, 503);
  assert.equal(f.calls.filter(call => call[0] === "password-update").length, 0);
  f.state.claimError = false; f.state.revokeFailure = true; f.state.signoutError = { message: refreshToken };
  const response = await f.post("reset-password", body);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.revocationPending, true);
  assert.equal(result.redirect, "/login?reset=complete");
  assert.ok(!JSON.stringify(result).includes(refreshToken));
});

test("reset distinguishes a committed password with failed signout from an uncertain provider update", async () => {
  const body = { password: "NewPassword123", confirmPassword: "NewPassword123" };
  const committed = fixture();
  await committed.load("app/auth/confirm/route.ts").GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
  committed.state.signoutThrows = true;
  const response = await committed.post("reset-password", body);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.revocationPending, true);
  assert.equal(committed.jar.get("tenh_recovery_grant"), undefined);
  assert.equal(committed.jar.get("sb-fixture-auth-token.0"), undefined);
  assert.equal((await committed.post("reset-password", body)).status, 410);
  const uncertain = fixture();
  await uncertain.load("app/auth/confirm/route.ts").GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
  uncertain.state.updateThrows = true;
  const failed = await uncertain.post("reset-password", body);
  assert.equal(failed.status, 503);
  const failure = await failed.json();
  assert.equal(failure.success, false);
  assert.match(failure.error, /may|uncertain|confirm|new.*link/i);
  assert.equal(uncertain.calls.find(call => call[0] === "revoke-ledger")[2], null);
  assert.equal(uncertain.calls.find(call => call[0] === "signout")[1].scope, "global");
  assert.equal(uncertain.jar.get("tenh_recovery_grant"), undefined);
  assert.equal(uncertain.jar.get("sb-fixture-auth-token.0"), undefined);
  assert.equal((await uncertain.post("reset-password", body)).status, 410);
  assert.ok(!JSON.stringify(failure).includes(accessToken));
  assert.ok(!JSON.stringify(uncertain.logs).includes(accessToken));
});

test("returned transient password errors revoke all sessions while known weak-password errors consume only the grant", async () => {
  const body = { password: "NewPassword123", confirmPassword: "NewPassword123" };
  for (const updateError of [{ status: 503 }, { status: 429 }, { name: "AuthRetryableFetchError" }]) {
    const f = fixture();
    await f.load("app/auth/confirm/route.ts").GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
    f.state.updateError = { ...updateError, message: accessToken };
    const response = await f.post("reset-password", body);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "RESET_OUTCOME_UNCERTAIN");
    assert.equal(f.calls.find(call => call[0] === "revoke-ledger")[2], null);
    assert.equal(f.calls.find(call => call[0] === "signout")[1].scope, "global");
    assert.equal(f.jar.get("tenh_recovery_grant"), undefined);
    assert.equal(f.jar.get("sb-fixture-auth-token.0"), undefined);
    assert.equal((await f.post("reset-password", body)).status, 410);
  }
  const weak = fixture();
  await weak.load("app/auth/confirm/route.ts").GET(new Request("https://app.test/auth/recovery?token_hash=recovery-valid&type=recovery"));
  weak.state.updateError = { status: 400, code: "weak_password", message: "Provider rejected password policy" };
  assert.equal((await weak.post("reset-password", body)).status, 400);
  assert.equal(weak.state.claimed, true);
  assert.equal(weak.calls.filter(call => call[0] === "revoke-ledger").length, 0);
  assert.equal(weak.jar.get("tenh_recovery_grant"), undefined);
  assert.equal((await weak.post("reset-password", body)).status, 410);
});

test("signup returns the same accepted response for new, existing and hidden existing identities", async () => {
  const f = fixture(), register = f.load("app/api/auth/register/route.ts");
  const payload = { fullName: "Fixture Person", workspaceName: "Fixture workspace", email: user.email, password: "Password123", confirmPassword: "Password123" };
  const invoke = body => register.POST(new Request("https://app.test/api/auth/register", { method: "POST", headers: { Origin: "https://app.test", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const outcomes = [];
  for (const signupResult of [
    { data: { user: { ...user, identities: [{}] }, session: null }, error: null },
    { data: { user: { ...user, identities: [] }, session: null }, error: null },
    { data: {}, error: { code: "email_exists", status: 422, message: "User already registered" } },
  ]) {
    f.state.signupResult = signupResult;
    const response = await invoke(payload);
    outcomes.push([response.status, await response.json()]);
  }
  assert.equal(outcomes[0][0], 202);
  assert.deepEqual(outcomes[1], outcomes[0]);
  assert.deepEqual(outcomes[2], outcomes[0]);
  assert.equal((await invoke({ ...payload, confirmPassword: "wrong" })).status, 400);
  f.state.signupResult = { data: { user, session: {} }, error: null };
  f.jar.set("sb-fixture-auth-token.0", accessToken);
  assert.equal((await invoke(payload)).status, 202);
  assert.equal(f.jar.get("sb-fixture-auth-token.0"), undefined);
  assert.equal(f.calls.filter(call => call[0] === "bind").length, 0);
  f.state.signupResult = { data: {}, error: { code: "unexpected_failure", name: "AuthApiError", status: 500, message: `${accessToken} ${refreshToken} ${user.email}` } };
  await invoke(payload);
  assert.ok(!JSON.stringify(f.logs).includes(accessToken));
  assert.ok(!JSON.stringify(f.logs).includes(refreshToken));
  assert.ok(!JSON.stringify(f.logs).includes(user.email));
});

test("server cookie refresh preserves hard expiry, rejects forged hints and guards server getUser", async () => {
  const f = fixture();
  const { signAuthTicket } = f.load("lib/auth/auth-ticket.ts");
  const hardExpiry = new Date(f.state.now + 86400000).toISOString();
  const hint = { remembered: true, expiresAt: hardExpiry, sessionId };
  f.jar.set("tenh_session_hint", signAuthTicket(hint, "persistence"));
  let config;
  class FakeAuthError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
  const load = loader({ ...f.overrides, "@supabase/ssr": { createServerClient: (_url, _key, options) => { config = options; return { auth: { getUser: async () => ({ data: { user }, error: null }) } }; } }, "@supabase/supabase-js": { AuthError: FakeAuthError } });
  const server = load("lib/supabase/server.ts");
  await server.createClient({ authFlow: true });
  const refresh = () => config.cookies.setAll([{ name: "sb-fixture-auth-token.0", value: "refreshed", options: { path: "/", maxAge: 400 * 86400, expires: new Date("2099-01-01") } }]);
  refresh();
  assert.equal(f.jar.writes.at(-1).options.expires.toISOString(), hardExpiry);
  assert.equal(f.jar.writes.at(-1).options.maxAge, undefined);
  f.state.now += 12 * 3600000; refresh();
  assert.equal(f.jar.writes.at(-1).options.expires.toISOString(), hardExpiry);
  f.jar.set("tenh_session_hint", `${signAuthTicket(hint, "persistence")}tampered`); refresh();
  assert.equal(f.jar.writes.at(-1).options.expires, undefined);
  f.jar.set("tenh_session_hint", signAuthTicket({ ...hint, remembered: false }, "persistence")); refresh();
  assert.equal(f.jar.writes.at(-1).options.maxAge, undefined);
  assert.equal(f.jar.writes.at(-1).options.expires, undefined);
  f.jar.values.delete("tenh_session_hint"); refresh();
  assert.equal(f.jar.writes.at(-1).options.maxAge, 400 * 86400);
  assert.equal(f.jar.writes.at(-1).options.expires.toISOString(), "2099-01-01T00:00:00.000Z");
  config.cookies.setAll([{ name: "sb-fixture-auth-token.0", value: "", options: { path: "/", maxAge: 0 } }]);
  assert.equal(f.jar.writes.at(-1).options.maxAge, 0);
  f.state.policyFailure = { allowed: false, status: 503, reason: "policy-unavailable" };
  const protectedClient = await server.createClient();
  const denied = await protectedClient.auth.getUser();
  assert.equal(denied.data.user, null);
  assert.equal(denied.error.status, 503);
  f.state.policyFailure = { allowed: false, status: 403, reason: "recovery" };
  assert.equal((await protectedClient.auth.getUser()).data.user, null);
  f.state.policyFailure = null;
  f.state.policy = { allowed: true, kind: "normal", expiresAt: new Date(f.state.now + 3600000).toISOString() };
  assert.equal((await protectedClient.auth.getUser()).data.user.id, user.id);
  f.state.policy.kind = "recovery";
  assert.equal((await protectedClient.auth.getUser()).data.user, null);
  const recoveryClient = await server.createClient({ allowRecovery: true });
  assert.equal((await recoveryClient.auth.getUser()).data.user.id, user.id);
  const authClient = await server.createClient({ authFlow: true });
  assert.equal((await authClient.auth.getUser()).data.user.id, user.id);
});

test("browser cookie refresh preserves absolute expiry and session-only persistence", () => {
  const f = fixture(), writes = [];
  const { signAuthTicket } = f.load("lib/auth/auth-ticket.ts");
  const expiresAt = new Date(f.state.now + 30 * 86400000).toISOString();
  let cookie = `tenh_session_hint=${signAuthTicket({ remembered: true, expiresAt, sessionId }, "persistence")}`;
  const document = { get cookie() { return cookie; }, set cookie(value) { writes.push(value); } };
  let config;
  const load = loader({ "@supabase/ssr": { ...ssr, createBrowserClient: (_url, _key, options) => { config = options; return {}; } } }, { document });
  load("lib/supabase/client.ts").createClient();
  const refresh = () => config.cookies.setAll([{ name: "sb-fixture-auth-token", value: "refreshed", options: { path: "/", maxAge: 400 * 86400 } }]);
  refresh();
  assert.match(writes.at(-1), new RegExp(`Expires=${new Date(expiresAt).toUTCString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
  assert.doesNotMatch(writes.at(-1), /Max-Age/i);
  const rememberedWrite = writes.at(-1);
  f.state.now += 2 * 86400000; refresh();
  assert.equal(writes.at(-1), rememberedWrite);
  cookie = `tenh_session_hint=${signAuthTicket({ remembered: false, expiresAt, sessionId }, "persistence")}`;
  refresh();
  assert.doesNotMatch(writes.at(-1), /Expires|Max-Age/i);
  cookie = ""; refresh();
  assert.match(writes.at(-1), /Max-Age=34560000/i);
  cookie = "tenh_session_hint=broken"; refresh();
  assert.doesNotMatch(writes.at(-1), /Expires|Max-Age/i);
  config.cookies.setAll([{ name: "sb-fixture-auth-token", value: "", options: { path: "/", maxAge: 0 } }]);
  assert.match(writes.at(-1), /Max-Age=0/i);
});
