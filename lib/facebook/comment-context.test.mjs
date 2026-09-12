import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../../app/api/facebook/comments/_shared.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ authorized = true, active = true, missing = false } = {}) {
  const reads = [];
  let tokens = 0;
  const rows = {
    messages: missing ? null : { id: "message", business_id: "business", conversation_id: "chat", platform_message_id: "comment" },
    conversations: { id: "chat", business_id: "business", social_account_id: "account" },
    social_accounts: { id: "account", business_id: "business", platform: "facebook", platform_account_id: "page", is_active: active },
  };
  const dependencies = {
    "@/lib/supabase/admin": { supabaseAdmin: { from(table) {
      const filters = {};
      return { select() { return this; }, eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() { reads.push({ table, filters }); return { data: rows[table], error: null }; } };
    } } },
    "@/lib/inbox/get-inbox-resource-access": { authorizeInboxBusinessAccess: async (business) => {
      assert.equal(business, "business");
      return authorized ? { success: true, member: { id: "agent" } } : { success: false, status: 403, error: "Denied" };
    } },
    "@/lib/facebook/get-facebook-page-access-token": { resolveStoredFacebookPageAccessToken: (account) => {
      assert.equal(account.platform_account_id, "page"); tokens++; return "test-token";
    } },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => dependencies[name], module, module.exports);
  return { load: module.exports.loadAuthorizedFacebookCommentActionContext, reads, tokens: () => tokens };
}
test("authorized action reads the comment once and retains workspace filters", async () => {
  const app = setup();
  const context = await app.load({ commentId: "comment", conversationId: "chat" });
  assert.equal(context.pageId, "page");
  assert.deepEqual(app.reads.map((item) => item.table), ["messages", "conversations", "social_accounts"]);
  assert.deepEqual(app.reads[0].filters, { platform_message_id: "comment", conversation_id: "chat" });
  assert.equal(app.reads[1].filters.business_id, "business");
  assert.equal(app.reads[2].filters.business_id, "business");
});
test("denied access stops before Page/token access; parallel routing read is read-only", async () => {
  const app = setup({ authorized: false });
  await assert.rejects(app.load({ commentId: "comment" }), (error) => error.status === 403);
  assert.deepEqual(app.reads.map(item => item.table), ["messages", "conversations"]);
  assert.equal(app.tokens(), 0);
});
test("inactive Page still blocks the action", async () => {
  const app = setup({ active: false });
  await assert.rejects(app.load({ commentId: "comment" }), (error) => error.status === 400);
  assert.equal(app.tokens(), 0);
});
test("missing comment still returns not found", async () => {
  const app = setup({ missing: true });
  await assert.rejects(app.load({ commentId: "comment" }), (error) => error.status === 404);
  assert.equal(app.tokens(), 0);
});
