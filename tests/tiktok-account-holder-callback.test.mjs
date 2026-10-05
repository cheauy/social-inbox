import test from "node:test";
import assert from "node:assert/strict";
import harness from "./tenh-seven/harness.cjs";

const { loader } = harness;

const SECRET = "fixture-only-secret-with-at-least-32-bytes";
const NOW = Date.parse("2026-10-02T20:00:00Z");
const COOKIE = "tenh_tiktok_account_holder_oauth_state";

function stateHarness() {
  const load = loader({}, { Buffer });
  return load("lib/tiktok/account-holder-oauth-state.ts");
}

test("state is signed, time limited, and bound to member and workspace", () => {
  const { createTikTokOAuthState, verifyTikTokOAuthState } = stateHarness();
  const fixture = createTikTokOAuthState(
    { memberId: "member-1", businessId: "workspace-1" },
    SECRET,
    NOW,
  );
  const verify = (overrides = {}) => verifyTikTokOAuthState({
    cookieValue: fixture.cookieValue,
    returnedState: fixture.state,
    memberId: "member-1",
    businessId: "workspace-1",
    secret: SECRET,
    now: NOW + 1,
    ...overrides,
  });

  assert.equal(verify().success, true);
  assert.equal(verify({ memberId: "member-2" }).reason, "identity_mismatch");
  assert.equal(verify({ businessId: "workspace-2" }).reason, "identity_mismatch");
  assert.equal(verify({ returnedState: "wrong-state" }).reason, "identity_mismatch");
  assert.equal(verify({ now: NOW + 10 * 60 * 1000 }).reason, "expired");

  const tampered = `${fixture.cookieValue.slice(0, -1)}x`;
  assert.equal(verify({ cookieValue: tampered }).reason, "invalid");
});

function callbackHarness(options = {}) {
  const writes = [];
  const redirects = [];
  let fetches = 0;
  const member = {
    id: options.memberId ?? "member-1",
    business_id: options.businessId ?? "workspace-1",
    role: "owner",
  };
  const env = {
    NODE_ENV: options.production ? "production" : "development",
    ...(options.configMissing ? {} : { TIKTOK_OAUTH_STATE_SECRET: SECRET }),
  };
  const load = loader({
    "next/server": {
      NextResponse: {
        redirect(url) {
          redirects.push(url);
          return {
            status: 307,
            headers: new Headers(),
            cookies: { set: (...args) => writes.push(args) },
          };
        },
      },
    },
    "@/lib/auth/get-current-member": {
      getCurrentMember: async () => options.unauthorized
        ? { success: false, status: 401, error: "private auth detail" }
        : { success: true, member },
    },
    "@/lib/auth/require-permission": {
      memberHasPermission: async () => !options.permissionDenied,
    },
    "@/lib/subscription/get-business-subscription-access": {
      getBusinessSubscriptionAccess: async () => {
        if (options.planFailure) throw new Error("private database detail");
        return { locked: Boolean(options.locked) };
      },
    },
  }, {
    Buffer,
    process: { env },
    fetch: async () => {
      fetches += 1;
      throw new Error("TikTok network calls are forbidden in this foundation");
    },
  });
  const state = load("lib/tiktok/account-holder-oauth-state.ts")
    .createTikTokOAuthState({ memberId: member.id, businessId: member.business_id }, SECRET);
  const { GET } = load("app/api/tiktok/oauth/callback/route.ts");

  async function get(query = {}, cookieValue = state.cookieValue, origin = "http://localhost:3000") {
    const url = new URL("/api/tiktok/oauth/callback", origin);
    for (const [key, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item);
    }
    return GET({
      nextUrl: url,
      cookies: { get: (name) => name === COOKIE && cookieValue ? { value: cookieValue } : undefined },
    });
  }

  return { get, state, writes, redirects, fetches: () => fetches };
}

test("valid account-holder callback consumes state but stays disabled without network or persistence", async () => {
  const h = callbackHarness();
  const response = await h.get({ state: h.state.state, code: "fixture-auth-code" });

  assert.equal(response.status, 307);
  assert.equal(h.redirects[0].origin, "http://localhost:3000");
  assert.equal(h.redirects[0].pathname, "/dashboard/integrations");
  assert.equal(h.redirects[0].searchParams.get("reason"), "integration_disabled");
  assert.equal(h.fetches(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0])), [COOKIE, "", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/api/tiktok/oauth/callback",
    maxAge: 0,
  }]);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("callback fails closed for auth, permission, plan, config, state, and malformed input", async () => {
  const cases = [
    [{ unauthorized: true }, "unauthorized"],
    [{ permissionDenied: true }, "permission_denied"],
    [{ locked: true }, "subscription_inactive"],
    [{ planFailure: true }, "access_check_failed"],
    [{ configMissing: true }, "configuration_missing"],
  ];

  for (const [options, reason] of cases) {
    const h = callbackHarness(options);
    await h.get({ state: h.state.state, code: "fixture-auth-code" });
    assert.equal(h.redirects[0].searchParams.get("reason"), reason);
    assert.equal(h.fetches(), 0);
  }

  const invalid = callbackHarness();
  await invalid.get({ state: "wrong", code: "fixture-auth-code" });
  assert.equal(invalid.redirects[0].searchParams.get("reason"), "invalid_state");

  const replayed = callbackHarness();
  await replayed.get({ state: replayed.state.state, code: "fixture-auth-code" }, null);
  assert.equal(replayed.redirects[0].searchParams.get("reason"), "invalid_state");

  const malformed = callbackHarness();
  await malformed.get({ state: malformed.state.state, code: ["one", "two"] });
  assert.equal(malformed.redirects[0].searchParams.get("reason"), "malformed_callback");

  const consumerShape = callbackHarness();
  await consumerShape.get({ state: consumerShape.state.state, auth_code: "wrong-flow-code" });
  assert.equal(consumerShape.redirects[0].searchParams.get("reason"), "malformed_callback");
});

test("provider denial is generic and production redirect cannot follow a hostile host", async () => {
  const h = callbackHarness({ production: true });
  await h.get({
    state: h.state.state,
    error: "provider-private-error",
    error_description: "secret raw provider detail",
  }, h.state.cookieValue, "https://evil.example");

  const redirect = h.redirects[0];
  assert.equal(redirect.origin, "https://app.tenhchat.com");
  assert.equal(redirect.searchParams.get("reason"), "authorization_denied");
  assert.doesNotMatch(redirect.toString(), /provider-private|secret|evil/);
  assert.equal(h.writes[0][2].secure, true);
  assert.equal(h.fetches(), 0);
});
