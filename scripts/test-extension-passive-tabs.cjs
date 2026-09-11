const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('tenh-extension/src/background.js', 'utf8');
const tree = ts.createSourceFile('background.js', source, ts.ScriptTarget.Latest, true);
const functions = tree.statements.filter(n => ts.isFunctionDeclaration(n) &&
  ['warmFacebookCompanion', 'handle'].includes(n.name.text)).map(n => n.getText(tree)).join('\n');

function harness() {
  const listeners = {}, probes = [];
  const noTabMutation = () => { throw new Error('Passive operation must not create or navigate tabs'); };
  const context = {
    chrome: {
      runtime: { onInstalled: { addListener: fn => listeners.installed = fn }, onStartup: { addListener: fn => listeners.startup = fn } },
      alarms: { onAlarm: { addListener: fn => listeners.alarm = fn } },
      tabs: { create: noTabMutation, update: noTabMutation, onUpdated: { addListener() {} }, onRemoved: { addListener: fn => listeners.removed = fn } },
      storage: { local: { remove: async () => {} } }, action: { setBadgeText: async () => {} },
    },
    readState: async () => ({ token: 'test', keepFacebookActive: true, managedFacebookTabId: 99 }),
    writeState: async () => {}, heartbeat: async () => {}, flushSyncQueue: async () => {}, deltaSync: async () => {},
    ensureRealtimeConnection: async () => {}, reconnectOpenTabs: async () => {}, createAlarms() {},
    ensureManagedFacebookTab: noTabMutation,
    askFacebook: async (_message, options) => { probes.push(options); assert.equal(options.ensure, false); return {}; },
    setTimeout: noTabMutation,
  };
  vm.createContext(context);
  vm.runInContext(functions + '\n' + source.slice(source.indexOf('chrome.runtime.onInstalled.addListener(')), context);
  return { context, listeners, probes };
}
test('install, startup and pairing never open Business Suite, even with old keep-active preference', async () => {
  const h = harness();
  h.listeners.installed();
  h.listeners.startup();
  await h.context.handle({ type: 'TENH_AUTO_CONNECTED', token: 'test' }, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.probes.length, 3);
});
test('closing an old managed tab does not recreate it', async () => {
  const h = harness();
  h.listeners.removed(99);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.probes.length, 0);
});
test('reply availability probe does not create or navigate a Facebook tab', async () => {
  const h = harness();
  await h.context.handle({ type: 'CHECK_FACEBOOK_REPLY_AVAILABILITY', pageId: '123456', threadId: '987654' }, {});
  assert.equal(h.probes.length, 1);
});
