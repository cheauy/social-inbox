const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('../tenh-seven/harness.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(closed = false) {
  const states = [], requests = [];
  let stateIndex = 0;
  const node = (type, props) => ({ type, props });
  const load = loader({
    react: {
      useEffect() {},
      useRef: value => ({ current: value === null ? { getBoundingClientRect: () => ({ left: 40, right: 72, top: 250, bottom: 280 }), focus() {} } : value }),
      useState(value) {
        const index = stateIndex++;
        states[index] = index === 0 ? !closed : index === 4 ? (closed ? null : { top: 10, left: 10 }) : value;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
    },
    'react/jsx-runtime': { jsx: node, jsxs: node, Fragment: 'fragment' },
    './message-action-toolbar': { MessageActionToolbar: 'toolbar' },
    'react-dom': { createPortal: value => value },
    'lucide-react': { Loader2: 'loader', SmilePlus: 'smile' },
    '@/lib/auth/use-workspace-permissions': { useWorkspacePermissions: () => ({ can: () => true }) },
  }, { window: { innerWidth: 400, innerHeight: 800 }, document: { body: {} }, fetch: (url, init) => new Promise(resolve => requests.push({ body: JSON.parse(init.body), resolve })) });
  const message = { id: 'm1', conversation_id: 'c1', platform_message_id: 'mid1', direction: 'incoming', message_type: 'text', raw_payload: {} };
  const patches = [];
  const tree = load('components/inbox/messenger-message-actions.tsx').MessengerMessageActions({
    message, platform: 'facebook', outgoing: false, actions: {}, onMessagePatched: row => patches.push(row),
  });
  function find(value, label) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) return value.map(item => find(item, label)).find(Boolean);
    if (value.props?.['aria-label'] === label) return value;
    return find(value.props?.children, label) || find(value.props?.reactionControl, label);
  }
  return { states, requests, patches, open: () => find(tree, "React to message").props.onClick(), click: label => find(tree, `React with ${label}`).props.onClick() };
}

test('reaction previews immediately, and rapid choices send only the latest after confirmation', async () => {
  const h = setup(); h.click('Love');
  assert.equal(h.states[2], '❤️'); assert.equal(h.requests.length, 1);
  h.click('Laugh'); h.click('Wow');
  assert.equal(h.states[2], '😮'); assert.equal(h.requests.length, 1);
  h.requests[0].resolve(Response.json({ success: true, timestamp: 100 })); await tick();
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].body.reaction, '😮');
  h.requests[1].resolve(Response.json({ success: true, timestamp: 200 })); await tick();
  assert.equal(h.states[1], false); assert.equal(h.states[2], undefined);
  assert.equal(h.patches.at(-1).raw_payload.tenh_messenger_reactions.page.emoji, '😮');
});

test('an uncertain result rolls back the preview and does not dispatch queued choices', async () => {
  const h = setup(); h.click('Love'); h.click('Wow');
  h.requests[0].resolve(Response.json({ success: false, error: 'Check Messenger before trying again.' }, { status: 502 })); await tick();
  assert.equal(h.requests.length, 1); assert.equal(h.patches.length, 0);
  assert.equal(h.states[2], undefined); assert.match(h.states[3], /Check Messenger/);
});

test('repeated identical selections do not send a second mutation', async () => {
  const h = setup(); h.click('Love'); h.click('Love');
  h.requests[0].resolve(Response.json({ success: true, timestamp: 100 })); await tick();
  assert.equal(h.requests.length, 1);
});

test('opening the picker positions it in the click handler without waiting for an effect or network', () => {
  const h = setup(true);
  assert.equal(h.states[0], false); assert.equal(h.states[4], null);
  h.open();
  assert.equal(h.states[0], true);
  assert.ok(Number.isFinite(h.states[4].top));
  assert.ok(Number.isFinite(h.states[4].left));
  assert.equal(h.requests.length, 0);
});
