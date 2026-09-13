const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const req = require('node:module').createRequire(path.resolve(__dirname, '../../package.json'));
const React = req('react'), { act } = React;
const { createRoot } = req('react-dom/client');
const { JSDOM } = require('jsdom');
const { loader } = require('../tenh-seven/harness.cjs');

// Reconcile the real header with BOTH real keyed siblings. A static render or
// a stubbed status menu cannot detect duplicated DOM after changing chats.
async function mount(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.tenhchat.com' });
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  const errors = [], navigations = [], statusChanges = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  const overrides = {
    react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'lucide-react': req('lucide-react'),
    '@/lib/extension/use-companion': { useCompanion: () => ({ installed: true, openInFacebook: async options => {
      navigations.push(options); return { opened: true, exactRequested: false };
    } }) },
    '@/lib/extension/store-listing': { TENH_EXTENSION_STORE_URL: '' },
    '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' },
    '@/lib/supabase/client': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    './conversation-visuals': { ConversationBookmark: () => null },
  };
  const load = loader(overrides, { window: dom.window, document: dom.window.document });
  overrides['./conversation-status-menu'] = load('components/inbox/conversation-status-menu.tsx');
  overrides['./companion-facebook-action'] = load('components/inbox/companion-facebook-action.tsx');
  const { ConversationHeader } = load('components/inbox/conversation-header.tsx');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    try { await act(async () => root.unmount()); }
    finally { console.error = originalError; dom.window.close(); }
  });
  const render = async (id, patch = {}) => {
    const conversation = { id, business_id: 'b1', source_type: 'messenger', status: 'open',
      social_account: { id: 's1', platform: 'facebook', platform_account_id: '203981939455120', account_name: 'Page' },
      contact: { id: `contact-${id}`, business_id: 'b1', platform_user_id: id === 'c1' ? '111111' : '222222', full_name: `Customer ${id}` },
      ...patch };
    await act(async () => root.render(React.createElement(ConversationHeader, {
      conversation, teamMembers: [], viewingAgents: [], typingAgents: [], teamPresence: [],
      agentPresenceStatus: 'connected', channelPlatform: 'messenger', channelAccountName: 'Page',
      onStatusChange: status => statusChanges.push({ conversationId: id, status }),
    })));
  };
  const statusButtons = () => document.querySelectorAll('button[aria-label="Change conversation status"]');
  const shortcutButtons = () => document.querySelectorAll('button[aria-label="Open in Meta Business Suite"]');
  return { render, errors, navigations, statusChanges, statusButtons, shortcutButtons };
}

test('40 chat switches keep exactly one status menu and one shortcut, with no React key warnings', async t => {
  const ui = await mount(t);
  for (let index = 0; index < 40; index++) await ui.render(index % 2 ? 'c1' : 'c2');
  assert.equal(ui.statusButtons().length, 1, 'status controls must not accumulate across conversations');
  assert.equal(ui.shortcutButtons().length, 1);
  assert.deepEqual(ui.errors, []);
});

test('switching chats closes the old status menu and keeps the new menu interactive', async t => {
  const ui = await mount(t);
  await ui.render('c1');
  await act(async () => ui.statusButtons()[0].click());
  assert.equal(document.querySelectorAll('[role="menu"]').length, 1);
  await ui.render('c2');
  assert.equal(document.querySelectorAll('[role="menu"]').length, 0);
  assert.equal(ui.statusButtons().length, 1);
  await act(async () => ui.statusButtons()[0].click());
  await act(async () => [...document.querySelectorAll('[role="menuitemradio"]')].find(button => button.textContent === 'Pending').click());
  assert.deepEqual(ui.statusChanges, [{ conversationId: 'c2', status: 'pending' }]);
  await ui.render('c2', { status: 'pending' });
  assert.equal(ui.statusButtons()[0].textContent, 'Pending');
  assert.deepEqual(ui.errors, []);
});

test('Companion notices reset across chats and the shortcut sends only the selected customer', async t => {
  const ui = await mount(t);
  await ui.render('c1');
  await act(async () => ui.shortcutButtons()[0].click());
  assert.ok(document.querySelector('[role="alert"]'));
  await ui.render('c2');
  assert.equal(document.querySelector('[role="alert"]'), null);
  await act(async () => ui.shortcutButtons()[0].click());
  assert.deepEqual(ui.navigations.map(({ conversationId, threadId }) => ({ conversationId, threadId })), [
    { conversationId: 'c1', threadId: '111111' }, { conversationId: 'c2', threadId: '222222' },
  ]);
  await ui.render('c3', { source_type: 'comment' });
  assert.equal(ui.shortcutButtons().length, 0);
  assert.equal(ui.statusButtons().length, 1);
  await ui.render('c1');
  assert.equal(ui.shortcutButtons().length, 1);
  assert.equal(ui.statusButtons().length, 1);
  assert.deepEqual(ui.errors, []);
});
