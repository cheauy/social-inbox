/*
 * Telegram Personal chats live in the shared inbox tables but are visible only
 * to the account holder and the teammates allowed by the account's team-access
 * setting. Server code reads those tables with the admin client, so every file
 * that reads them must apply lib/telegram-personal/visibility (directly or via
 * the inbox access gates), or be listed below with the reason it is safe.
 * Adding a new read path without either fails this test.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loader } = require("./tenh-seven/harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const TABLES = [
  "conversations", "messages", "contacts", "conversation_activity", "conversation_reminders",
  "customer_files", "contact_tags", "contact_notes", "team_notifications",
];
const READ = new RegExp(`\\.from\\(\\s*["'](${TABLES.join("|")})["']\\s*\\)`);
const GUARDED = /telegram-personal\/visibility|getInbox(Conversation|Contact)Access|getInboxResourceAccess|get-inbox-resource-access/;

const FACEBOOK_ONLY = "Facebook pipeline: rows are selected by a Facebook Page, PSID or Facebook platform filter";
const TELEGRAM_BOT_ONLY = "Telegram Bot pipeline: rows are selected by Bot chat/message ids";
const AFTER_GATE = "helper called only with a conversation/contact already authorized by the inbox gates";
const EXTENSION_FB = "browser extension: threads resolve only through Facebook Page + PSID (lib/extension/facebook-thread)";
const AGGREGATE = "numbers only (counts per member/status/day), no conversation, customer or message content";
const OPERATOR = "TENH operator console: timestamps/counts across workspaces, no message or customer content";
const WRITE_ONLY = "inserts notifications not tied to any conversation";

const ALLOW = {
  "app/api/extension/conversations/open-context/route.ts": EXTENSION_FB,
  "app/api/extension/observations/route.ts": EXTENSION_FB,
  "app/api/extension/observed-message/route.ts": EXTENSION_FB,
  "app/api/extension/tags/route.ts": EXTENSION_FB,
  "app/api/facebook/auto-reply/route.ts": FACEBOOK_ONLY,
  "app/api/facebook/avatar-discovery/route.ts": FACEBOOK_ONLY,
  "app/api/facebook/comments/_shared.ts": FACEBOOK_ONLY,
  "app/api/facebook/comments/hide/route.ts": FACEBOOK_ONLY,
  "app/api/facebook/comments/like/route.ts": FACEBOOK_ONLY,
  "app/api/facebook/comments/reply/route.ts": FACEBOOK_ONLY,
  "app/api/facebook/stickers/send/route.ts": FACEBOOK_ONLY,
  "app/api/inbox/smart-view-options/route.ts": "tag usage counts only (contact_tags tag_id), no customer content",
  "app/api/manual-payments/admin/route.ts": WRITE_ONLY,
  "app/api/save-profile-url/route.ts": FACEBOOK_ONLY,
  "app/api/telegram/send-sticker/route.ts": TELEGRAM_BOT_ONLY,
  "app/api/tenh-admin/billing/route.ts": OPERATOR,
  "app/api/tenh-admin/channel-health/route.ts": OPERATOR,
  "app/api/tenh-admin/customer-reports/route.ts": WRITE_ONLY,
  "app/api/tenh-admin/facebook-avatar-backfill/route.ts": FACEBOOK_ONLY,
  "lib/analytics/read-channel-messages.ts": "called by analytics/channels with conversation ids already filtered for visibility",
  "lib/bot/execution-store.ts": FACEBOOK_ONLY,
  "lib/bot/facebook-comment-hide-transport.ts": FACEBOOK_ONLY,
  "lib/bot/facebook-text-transport.ts": FACEBOOK_ONLY,
  "lib/extension/facebook-thread.ts": EXTENSION_FB,
  "lib/facebook/auto-reply.ts": FACEBOOK_ONLY,
  "lib/facebook/capture-native-reply.ts": FACEBOOK_ONLY,
  "lib/facebook/facebook-connection-health.ts": FACEBOOK_ONLY,
  "lib/facebook/facebook-profile-photo.ts": FACEBOOK_ONLY,
  "lib/facebook/get-facebook-page-access-token.ts": FACEBOOK_ONLY,
  "lib/facebook/mark-comment-thread-deleted.ts": FACEBOOK_ONLY,
  "lib/facebook/messenger-reply-policy.ts": FACEBOOK_ONLY,
  "lib/facebook/process-comment.ts": FACEBOOK_ONLY,
  "lib/facebook/process-message-reaction.ts": FACEBOOK_ONLY,
  "lib/facebook/process-message-status.ts": FACEBOOK_ONLY,
  "lib/facebook/process-message.ts": FACEBOOK_ONLY,
  "lib/facebook/process-messenger-referral.ts": FACEBOOK_ONLY,
  "lib/facebook/recover-facebook-missed-data.ts": FACEBOOK_ONLY,
  "lib/facebook/recover-facebook-today.ts": FACEBOOK_ONLY,
  "lib/facebook/repair-facebook-avatar.ts": FACEBOOK_ONLY,
  "lib/facebook/send-reply-context.ts": FACEBOOK_ONLY,
  "lib/inbox/create-conversation-activity.ts": AFTER_GATE,
  "lib/inbox/get-conversation-activity.ts": AFTER_GATE,
  "lib/inbox/get-messages.ts": AFTER_GATE,
  "lib/inbox/get-search-matches.ts": AFTER_GATE,
  "lib/inbox/mutate-message-metadata.ts": AFTER_GATE,
  "lib/inbox/save-detected-customer-phone.ts": "called only by the Facebook and Telegram Bot ingest pipelines",
  "lib/telegram/process-edited-message.ts": TELEGRAM_BOT_ONLY,
  "lib/telegram/process-message.ts": TELEGRAM_BOT_ONLY,
  "lib/telegram/reaction-store.ts": TELEGRAM_BOT_ONLY,
  "lib/telegram/telegram-profile-photo.ts": TELEGRAM_BOT_ONLY,
};

function serverFiles(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) serverFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(rel);
  }
  return out;
}

test("every server read of inbox tables applies Telegram Personal visibility or is allowlisted with a reason", () => {
  const unguarded = [];
  for (const file of [...serverFiles("app"), ...serverFiles("lib")]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (!READ.test(source) || GUARDED.test(source)) continue;
    if (typeof ALLOW[file] === "string" && ALLOW[file].length > 10) continue;
    unguarded.push(file);
  }
  assert.deepEqual(unguarded, [], `Apply lib/telegram-personal/visibility or allowlist with a reason:\n${unguarded.join("\n")}`);
});

test("allowlist has no stale entries", () => {
  const stale = Object.keys(ALLOW).filter((file) => {
    const full = path.join(ROOT, file);
    return !fs.existsSync(full) || !READ.test(fs.readFileSync(full, "utf8"));
  });
  assert.deepEqual(stale, []);
});

test("allowlisted Facebook and Bot helpers never mention telegram_personal reads", () => {
  for (const [file, reason] of Object.entries(ALLOW)) {
    if (reason !== FACEBOOK_ONLY && reason !== TELEGRAM_BOT_ONLY) continue;
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(!/telegram_personal/.test(source), `${file} is allowlisted as single-platform but mentions telegram_personal`);
  }
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const BUSINESS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FLAG_ON = { TENH_TELEGRAM_PERSONAL_ENABLED: "true", TENH_TELEGRAM_PERSONAL_BUSINESS_IDS: BUSINESS };
const ACCOUNTS = [
  { id: ACCOUNT, business_id: BUSINESS, platform: "telegram_personal" },
  { id: OTHER, business_id: BUSINESS, platform: "telegram_personal" },
];

function visibility(seed = {}, canSee = () => false, env = FLAG_ON, rpcError = null) {
  const calls = [];
  const admin = {
    rpc: async (name, args) => { calls.push({ name, args }); return rpcError ? { data: null, error: rpcError } : { data: canSee(args), error: null }; },
    from: (name) => {
      const rows = seed[name] ?? (name === "social_accounts" ? ACCOUNTS : []);
      const filters = [];
      const q = {
        select: () => q,
        eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
        in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return q; },
        or: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
        then: (res, rej) => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej),
      };
      return q;
    },
  };
  const memo = new Map();
  const mod = loader({
    "@/lib/supabase/admin": { supabaseAdmin: admin },
    "@/lib/server/request-scope": { requestMemo: (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); } },
  }, { process: { env }, console: { ...console, error: () => {} } })("lib/telegram-personal/visibility.ts");
  return { mod, calls };
}

test("identity keys map back to their Personal account", () => {
  const { mod } = visibility();
  assert.equal(mod.personalAccountFromMessageKey(`tgp:${ACCOUNT}:42:7`), ACCOUNT);
  assert.equal(mod.personalAccountFromMessageKey("telegram:42:7"), null);
  assert.equal(mod.personalAccountFromContact({ platform: "telegram_personal", platform_user_id: `${ACCOUNT}:42` }), ACCOUNT);
  assert.equal(mod.personalAccountFromContact({ platform: "telegram", platform_user_id: `${ACCOUNT}:42` }), null);
  assert.equal(mod.isHiddenMessage({ platform_message_id: `tgp:${ACCOUNT}:1:2` }, [ACCOUNT]), true);
  assert.equal(mod.isHiddenMessage({ platform_message_id: `tgp:${OTHER}:1:2` }, [ACCOUNT]), false);
  assert.equal(mod.isHiddenConversation({ social_account_id: ACCOUNT }, [ACCOUNT]), true);
  assert.equal(mod.hiddenAccountInList([]), null);
  assert.equal(mod.hiddenAccountInList([ACCOUNT, OTHER]), `(${ACCOUNT},${OTHER})`);
  assert.deepEqual([...mod.hiddenMessagePatterns([ACCOUNT])], [`tgp:${ACCOUNT}:%`]);
  assert.equal(mod.visibleIdOrFilter("conversation_id", []), null);
  assert.equal(mod.visibleIdOrFilter("conversation_id", [ACCOUNT]), `conversation_id.is.null,conversation_id.not.in.(${ACCOUNT})`);
});

test("hidden accounts are those the member may not see; visibility is asked per account", async () => {
  const businessId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const { mod, calls } = visibility(
    { social_accounts: [
      { id: ACCOUNT, business_id: businessId, platform: "telegram_personal" },
      { id: OTHER, business_id: businessId, platform: "telegram_personal" },
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", business_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", platform: "telegram_personal" },
    ] },
    (args) => args.p_social_account === OTHER,
  );
  const hidden = await mod.hiddenPersonalAccountIds([businessId], "user-1");
  assert.deepEqual([...hidden], [ACCOUNT]);
  assert.ok(calls.every((c) => c.name === "tgp_member_can_see" && c.args.p_user === "user-1"));
});

test("visibility fails closed when the check errors", async () => {
  const failing = visibility({}, () => true, FLAG_ON, { code: "42883" }).mod;
  assert.equal(await failing.canSeePersonalAccount(ACCOUNT, "user-1"), false);
  assert.equal(await failing.canSeePersonalAccount("not-a-uuid", "user-1"), false);
});

test("with the feature flag off every Personal account is hidden, even for the holder", async () => {
  const { mod, calls } = visibility({}, () => true, {});
  assert.deepEqual([...(await mod.hiddenPersonalAccountIds([BUSINESS], "user-1"))].sort(), [ACCOUNT, OTHER].sort());
  assert.equal(await mod.canSeePersonalAccount(ACCOUNT, "user-1"), false);
  assert.equal(calls.length, 0);
  const otherWorkspace = visibility({}, () => true, { ...FLAG_ON, TENH_TELEGRAM_PERSONAL_BUSINESS_IDS: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }).mod;
  assert.equal(await otherWorkspace.canSeePersonalAccount(ACCOUNT, "user-1"), false);
  const on = visibility({}, () => true).mod;
  assert.equal(await on.canSeePersonalAccount(ACCOUNT, "user-1"), true);
});

test("a non-Personal conversation is never hidden; a Personal one follows the member check", async () => {
  const seed = { conversations: [
    { id: "c-fb", platform: "facebook", social_account_id: OTHER },
    { id: "c-tp", platform: "telegram_personal", social_account_id: ACCOUNT },
  ] };
  const denied = visibility(seed, () => false).mod;
  assert.equal(await denied.isConversationHiddenFor("c-fb", "u"), false);
  assert.equal(await denied.isConversationHiddenFor("c-tp", "u"), true);
  const allowed = visibility(seed, () => true).mod;
  assert.equal(await allowed.isConversationHiddenFor("c-tp", "u"), false);
});

test("a missing user id hides every Personal account (fails closed)", async () => {
  const businessId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const { mod, calls } = visibility(
    { social_accounts: [{ id: ACCOUNT, business_id: businessId, platform: "telegram_personal" }] },
    () => true,
  );
  assert.deepEqual([...(await mod.hiddenPersonalAccountIds([businessId], ""))], [ACCOUNT]);
  assert.equal(await mod.canSeePersonalAccount(ACCOUNT, ""), false);
  assert.equal(calls.length, 0);
});
