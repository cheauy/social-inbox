const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const req = require('node:module').createRequire(path.resolve(__dirname, '../../package.json'));
const { JSDOM } = require('jsdom');
const React = req('react'), { act } = React;
const { createRoot } = req('react-dom/client');
const { renderToStaticMarkup } = req('react-dom/server');
const { loader } = require('../tenh-seven/harness.cjs');

const context = { pageId: '203981939455120', threadId: '123456789', conversationId: 'c1', businessId: 'b1' };
let installed = true, answer = { opened: true, exactRequested: true }, calls = [];
const overrides = {
  react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'lucide-react': req('lucide-react'),
  '@/lib/extension/use-companion': { useCompanion: () => ({ installed, openInFacebook: async options => { calls.push(options); return typeof answer === 'function' ? answer() : answer; } }) },
  '@/lib/extension/store-listing': { TENH_EXTENSION_STORE_URL: 'https://example.com/extension' },
  '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' },
  '@/lib/supabase/client': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
  './conversation-visuals': { ConversationBookmark: () => null },
  './conversation-status-menu': { ConversationStatusMenu: () => null },
};
const load = loader(overrides);
const { CompanionFacebookAction } = load('components/inbox/companion-facebook-action.tsx');
overrides['./companion-facebook-action'] = { CompanionFacebookAction };
const { ConversationHeader } = load('components/inbox/conversation-header.tsx');

async function mount(t, patch = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.tenhchat.com' });
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  calls = [];
  await act(async () => root.render(React.createElement(CompanionFacebookAction, { ...context, compact: true, ...patch })));
  return { click: async () => act(async () => document.querySelector('button').click()) };
}

test('the compact shortcut sends the exact workspace, conversation, Page and customer on click', async t => {
  installed = true; answer = { opened: true, exactRequested: true };
  const ui = await mount(t);
  assert.equal(calls.length, 0, 'rendering must not navigate');
  await ui.click();
  assert.equal(JSON.stringify(calls), JSON.stringify([context]));
  assert.equal(document.querySelector('[role="alert"]'), null);
});

test('a Page inbox fallback is disclosed instead of claiming the exact chat opened', async t => {
  installed = true; answer = { opened: true, exactRequested: false };
  const ui = await mount(t); await ui.click();
  assert.match(document.querySelector('[role="alert"]').textContent, /exact customer chat could not be selected/);
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Dismiss').click());
  assert.equal(document.querySelector('[role="alert"]'), null);
});

test('a missing Companion shows installation help without attempting navigation', async t => {
  installed = false;
  const ui = await mount(t); await ui.click();
  assert.equal(calls.length, 0);
  assert.match(document.querySelector('[role="alert"]').textContent, /Install or enable TENH Companion/);
  assert.equal(document.querySelector('a').textContent, 'Install TENH Companion');
});

test('a pending navigation disables repeated clicks and restores the button after failure', async t => {
  installed = true; let finish;
  answer = () => new Promise(resolve => { finish = resolve; });
  const ui = await mount(t); await ui.click(); await ui.click();
  assert.equal(calls.length, 1);
  assert.equal(document.querySelector('button').disabled, true);
  await act(async () => finish({ opened: false }));
  assert.equal(document.querySelector('button').disabled, false);
  assert.match(document.querySelector('[role="alert"]').textContent, /Could not open this conversation/);
});

test('the real header exposes the shortcut for Facebook Messenger only', () => {
  installed = true;
  const conversation = { id: 'c1', source_type: 'messenger', status: 'open',
    social_account: { id: 's1', platform: 'facebook', platform_account_id: context.pageId, account_name: 'Page' },
    contact: { id: 'contact1', business_id: 'b1', platform_user_id: context.threadId, full_name: 'Customer' } };
  const render = value => new JSDOM(renderToStaticMarkup(React.createElement(ConversationHeader, {
    conversation: value, teamMembers: [], viewingAgents: [], typingAgents: [], teamPresence: [],
    agentPresenceStatus: 'connected', channelPlatform: 'messenger', channelAccountName: 'Page',
  }))).window.document;
  assert.ok(render(conversation).querySelector('[aria-label="Open in Meta Business Suite"]'));
  for (const other of [
    { ...conversation, source_type: 'comment' },
    { ...conversation, social_account: { ...conversation.social_account, platform: 'telegram' } },
    { ...conversation, social_account: null },
  ]) assert.equal(render(other).querySelector('[aria-label="Open in Meta Business Suite"]'), null);
});
