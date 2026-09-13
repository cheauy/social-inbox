const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const req = require('node:module').createRequire(path.resolve(__dirname, '../../package.json'));
const { JSDOM } = require('jsdom');
const { loader } = require('../tenh-seven/harness.cjs');
const { broadcastAgentPresence } = loader()('lib/inbox/broadcast-agent-presence.ts');
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client');

for (const [state, connected, expected] of [
  ['joined', true, 'socket'], ['joined', false, 'rest'], ['joining', true, 'rest'], ['closed', false, 'rest'],
]) {
  test(`${state} channel, socket ${connected}: delivers once via ${expected}`, async () => {
    const calls = [], payload = { agent: { conversation_id: 'c1', revision: 2 } };
    const channel = { state, socket: { isConnected: () => connected },
      send: async args => { calls.push({ mode: 'socket', event: args.event, payload: args.payload }); return 'ok'; },
      httpSend: async (event, body) => { calls.push({ mode: 'rest', event, payload: body }); return { success: true }; },
    };
    await broadcastAgentPresence(channel, 'presence', payload);
    assert.deepEqual(calls, [{ mode: expected, event: 'presence', payload }]);
  });
}

test('an uncertain socket delivery is reported without duplicate REST delivery', async () => {
  let restCalls = 0;
  await assert.rejects(broadcastAgentPresence({ state: 'joined', socket: { isConnected: () => true },
    send: async () => 'timed out', httpSend: async () => { restCalls++; },
  }, 'presence', {}), /timed out/);
  assert.equal(restCalls, 0);
});

test('REST delivery failure remains visible to the caller', async () => {
  await assert.rejects(broadcastAgentPresence({ state: 'closed', httpSend: async () => { throw new Error('HTTP 503'); } }, 'presence', {}), /HTTP 503/);
});

async function mount(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com' });
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  const channels = [], warnings = [];
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'agent@example.com' } } }),
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    realtime: { setAuth: async () => {} }, removeChannel: async channel => { channel.state = 'closed'; },
    channel: () => {
      const channel = { state: 'joining', connected: true, socketCalls: [], restCalls: [], tracks: [],
        socket: { isConnected: () => channel.connected },
        track: async payload => { channel.tracks.push(payload); return channel.pendingTrack ? channel.pendingTrack() : 'ok'; },
        send: async payload => {
          assert.equal(channel.state, 'joined'); assert.equal(channel.connected, true);
          channel.socketCalls.push(payload); return 'ok';
        },
        httpSend: async (event, payload) => { channel.restCalls.push({ event, payload }); return { success: true }; },
        presenceState: () => ({}), on() { return this; },
        subscribe(callback) { channel.subscribed = callback; return this; },
      };
      channels.push(channel); return channel;
    },
  };
  const { useAgentPresence } = loader({ react: React, '@/lib/supabase/client': { createClient: () => supabase } }, {
    window: dom.window, document: dom.window.document, crypto: require('node:crypto').webcrypto,
    console: { info() {}, warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
  })('lib/inbox/use-agent-presence.ts');
  function Probe(props) { useAgentPresence({ teamMembers: [], typingText: '', conversationId: 'c1', ...props }); return null; }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  const render = async props => act(async () => root.render(React.createElement(Probe, { businessId: 'b1', ...props })));
  await render();
  return { channels, warnings, render };
}

test('real hook handles a disconnect during track and resumes socket delivery on reconnect', async t => {
  const hook = await mount(t), channel = hook.channels[0];
  channel.state = 'joined';
  channel.pendingTrack = async () => { channel.connected = false; return 'timed out'; };
  await act(async () => channel.subscribed('SUBSCRIBED'));
  assert.equal(channel.restCalls.length, 1);
  assert.equal(channel.socketCalls.length, 0);
  assert.equal(channel.restCalls[0].payload.agent.conversation_id, 'c1');
  channel.pendingTrack = null; channel.connected = true;
  await act(async () => channel.subscribed('SUBSCRIBED'));
  assert.equal(channel.socketCalls.length, 1);
  assert.ok(channel.socketCalls[0].payload.agent.revision > channel.restCalls[0].payload.agent.revision);
  assert.equal(hook.warnings.length, 0);
});

test('real hook drops a removed workspace channel after pending track completes', async t => {
  const hook = await mount(t), old = hook.channels[0];
  let finish;
  old.state = 'joined'; old.pendingTrack = () => new Promise(resolve => { finish = resolve; });
  await act(async () => { void old.subscribed('SUBSCRIBED'); });
  await hook.render({ businessId: 'b2', conversationId: 'c2' });
  const next = hook.channels[1]; next.state = 'joined';
  await act(async () => { void next.subscribed('SUBSCRIBED'); });
  await act(async () => finish('ok'));
  assert.equal(old.socketCalls.length + old.restCalls.length, 0);
  assert.equal(next.socketCalls.length, 1);
  assert.equal(next.socketCalls[0].payload.agent.conversation_id, 'c2');
  assert.equal(hook.warnings.length, 0);
});
