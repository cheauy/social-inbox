const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const tsSource = fs.readFileSync('lib/facebook/customer-conversation-link.ts', 'utf8')
  .replace(/^import .*?;\s*$/gm, '');
const js = ts.transpileModule(tsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleObj = { exports: {} };
vm.runInNewContext(js, {
  module: moduleObj,
  exports: moduleObj.exports,
  URL,
  AbortSignal,
  fetch: async () => { throw new Error('network not expected'); },
  process: { env: {} },
  getFacebookPageAccessToken: async () => 'token',
});
const api = moduleObj.exports;

const pageId = '393342417206745';
const psid = '28288665770787398';
const globalId = '100073163121418';
const pancake = `https://business.facebook.com/latest/inbox/all?asset_id=${pageId}&nav_ref=diode_page_inbox&mailbox_id=&selected_item_id=${globalId}&thread_type=FB_MESSAGE`;

function payload(link = pancake) {
  return { data: [{
    id: 't_graph',
    link,
    participants: { data: [{ id: pageId, name: 'Page' }, { id: psid, name: 'Customer' }] },
  }] };
}

test('Pancake-style empty mailbox Business Suite link is accepted', () => {
  const normalized = api.normalizeFacebookConversationLink(pancake, pageId);
  assert.ok(normalized);
  const url = new URL(normalized);
  assert.equal(url.searchParams.get('asset_id'), pageId);
  assert.equal(url.searchParams.get('mailbox_id'), '');
  assert.equal(url.searchParams.get('selected_item_id'), globalId);
});

test('exact Page/customer mapping yields separate navigation id', () => {
  const result = api.selectCustomerConversationLink(payload(), pageId, psid);
  assert.equal(result.navigationId, globalId);
  assert.notEqual(result.navigationId, psid);
  assert.equal(result.linkSource, 'meta_conversations_api');
});

test('PSID cannot be accepted as a global/navigation id', () => {
  const same = pancake.replace(`selected_item_id=${globalId}`, `selected_item_id=${psid}`);
  const result = api.selectCustomerConversationLink(payload(same), pageId, psid);
  assert.equal(result.navigationId, null);
});

test('wrong participants cannot authorize a navigation id', () => {
  const bad = payload();
  bad.data[0].participants.data[1].id = '999999999';
  assert.equal(api.selectCustomerConversationLink(bad, pageId, psid).reason, 'profile_conversation_participants_unmatched');
});

test('legacy provider Page inbox path remains exact but does not invent a global id', () => {
  const path = `/${pageId}/inbox/1187032264483411/?section=messages`;
  const result = api.selectCustomerConversationLink(payload(path), pageId, psid);
  assert.equal(result.conversationLink, `https://www.facebook.com${path}`);
  assert.equal(result.navigationId, null);
});

const background = fs.readFileSync('tenh-extension/src/background.js', 'utf8');
const facebookTargetSource = background.slice(
  background.indexOf('function facebookTarget('),
  background.indexOf('async function tabById', background.indexOf('function facebookTarget(')),
);
const navSource = background.slice(
  background.indexOf('function navigationIdFromFacebookUrl('),
  background.indexOf('function summarizeFacebookPages', background.indexOf('function navigationIdFromFacebookUrl(')),
);
const sandbox = { URL };
vm.runInNewContext(`${facebookTargetSource}\n${navSource}\nglobalThis.api={facebookTarget,navigationIdFromFacebookUrl};`, sandbox);

test('extension builds Meta/Pancake-style direct Business Suite URL', () => {
  const url = new URL(sandbox.api.facebookTarget({ pageId, threadId: globalId }));
  assert.equal(url.searchParams.get('asset_id'), pageId);
  assert.equal(url.searchParams.get('nav_ref'), 'diode_page_inbox');
  assert.equal(url.searchParams.get('mailbox_id'), '');
  assert.equal(url.searchParams.get('selected_item_id'), globalId);
});

test('extension extracts global id only from the exact Page route', () => {
  assert.equal(sandbox.api.navigationIdFromFacebookUrl(pancake, pageId, psid), globalId);
  assert.equal(sandbox.api.navigationIdFromFacebookUrl(pancake, '111', psid), null);
  assert.equal(sandbox.api.navigationIdFromFacebookUrl(pancake.replace(globalId, psid), pageId, psid), null);
});
