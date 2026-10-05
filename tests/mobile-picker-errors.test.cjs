const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { loader } = require('./tenh-seven/harness.cjs');
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
// Synthetic points and recipients only. Native modules and transport are mocked.
const point = { latitude: 0.125, longitude: -0.25 };
const position = { coords: point };

function locationSend(overrides = {}) {
  const file = 'mobile/app/conversation/[id].tsx', src = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = {};
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ['sendLocation', 'openLocationPicker', 'closeLocationPicker'].includes(node.name?.text)) handlers[node.name.text] = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(handlers.sendLocation);
  let saved = null;
  const state = {}, calls = [];
  const c = {
    Error,
    id: 'mock-conversation', scopeId: 'mock-workspace', platform: 'facebook', recipientId: 'mock-recipient',
    sending: false, screenAlive: { current: true }, ownerRef: { current: 'mock-workspace:mock-conversation' },
    locationFlight: { current: null }, locationAttempts: { current: new Map() },
    locationSequence: { current: 0 }, locationModalEpoch: { current: 0 },
    session: { user: { id: 'mock-account' } }, URLSearchParams,
    locationAttemptKey: (...ids) => ids.join('.'),
    readLocationAttempt: async () => saved,
    saveLocationAttempt: async (_, attempt) => { saved = attempt; },
    clearLocationAttempt: async (_, requestId) => { if (saved?.requestId === requestId) saved = null; },
    setLocationRecovery: value => { state.recovery = value; }, setLocationReady: value => { state.ready = value; },
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    load: async () => {}, api: async (...args) => { calls.push(args); return { delivery: args[2]?.method === "POST" ? "confirmed" : "not_found", locationTracking: "v1" }; },
    setSending: value => { state.sending = value; }, setError: value => { state.error = value; },
    setLocationError: value => { state.locationError = value; }, setMapOpen: value => { state.open = value; },
    ...overrides,
  };
  vm.createContext(c);
  vm.runInContext(ts.transpileModule(Object.values(handlers).join('\n') + '\nglobalThis.run = sendLocation; globalThis.open = openLocationPicker; globalThis.close = closeLocationPicker;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, c);
  return { c, state, calls, run: (value, check) => c.run(value ?? point, check), open: () => c.open(), close: () => c.close(), saved: () => saved };

}

test('Facebook location supplies the customer recipient and a valid stable send receipt', async () => {
  const f = locationSend(); await f.run();
  const [path, workspace, init] = f.calls[0];
  assert.equal(path, '/api/facebook/send'); assert.equal(workspace, 'mock-workspace');
  assert.equal(init.method, 'POST'); assert.equal(init.body.recipientId, 'mock-recipient');
  assert.equal(init.body.conversationId, 'mock-conversation');
  assert.match(init.body.message, /https:\/\/www\.google\.com\/maps\?q=0\.125,-0\.25/);
  assert.match(init.body.clientRequestId, /^optimistic:[\w.-]{1,100}$/);
  assert.equal(f.state.open, false); assert.equal(f.state.sending, false);
});

test('Telegram verifies tracking and durably saves the point before its native send', async () => {
  const f = locationSend({ platform: 'telegram', recipientId: '' }); await f.run();
  assert.match(f.calls[0][0], /^\/api\/telegram\/send-location\?/);
  assert.equal(f.calls[0][2], undefined);
  assert.equal(f.calls[1][0], '/api/telegram/send-location');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1][2].body)), { conversationId: 'mock-conversation', requestId: '00000000-0000-4000-8000-000000000001', ...point });
  assert.equal(f.saved(), null); assert.equal(f.state.recovery, null);
});

test('same-frame duplicate location taps invoke transport once', async () => {
  const pending = deferred(); let calls = 0;
  const f = locationSend({ api: () => { calls++; return pending.promise; } });
  const first = f.run(); await f.run(); assert.equal(calls, 1);
  pending.resolve({}); await first;
  assert.equal(f.c.locationFlight.current, null);
});

test('Facebook retry keeps its receipt and shows the provider error in the map', async () => {
  let count = 0; const bodies = [];
  const f = locationSend({ api: async (_, __, init) => {
    bodies.push(init.body); if (++count === 1) throw new Error('Mock reply window expired');
  } });
  await f.run(); assert.equal(f.state.locationError, 'Mock reply window expired');
  assert.equal(f.state.open, undefined); assert.equal(f.state.sending, false);
  await f.run(); assert.equal(bodies[0].clientRequestId, bodies[1].clientRequestId);
  assert.equal(f.state.locationError, ''); assert.equal(f.state.open, false);
});

test('a refresh rejection after confirmed location delivery does not report send failure', async () => {
  const f = locationSend({ load: async () => { throw new Error('Mock refresh failed'); } });
  await f.run(); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.state.open, false); assert.equal(f.state.locationError, '');
});

for (const value of [{ latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }]) {
  test(`invalid synthetic location ${JSON.stringify(value)} never reaches transport`, async () => {
    const f = locationSend(); await f.run(value);
    assert.equal(f.calls.length, 0); assert.match(f.state.locationError, /valid location/);
  });
}

test('missing Facebook recipient gives a visible local error without transport', async () => {
  const f = locationSend({ recipientId: '' }); await f.run();
  assert.equal(f.calls.length, 0); assert.match(f.state.locationError, /recipient ID/);
});

for (const fails of [false, true]) test(`late location send ${fails ? 'failure' : 'success'} cannot update another thread`, async () => {
  const pending = deferred(), f = locationSend({ api: () => pending.promise });
  const work = f.run(); f.c.ownerRef.current = 'other-workspace:other-conversation';
  const before = JSON.stringify(f.state);
  if (fails) pending.reject(new Error('Old send failed')); else pending.resolve({});
  await work; assert.equal(JSON.stringify(f.state), before);
});

for (const fails of [false, true]) test(`actual close and reopen callbacks protect the new map from old ${fails ? 'failure' : 'success'}`, async () => {
  const pending = deferred(), f = locationSend({ api: () => pending.promise });
  await f.open(); const work = f.run(); f.close(); await f.open();
  const epoch = f.c.locationModalEpoch.current;
  assert.equal(epoch, 3); assert.equal(f.state.open, true);
  if (fails) pending.reject(new Error('Old failure')); else pending.resolve({});
  await work; assert.equal(f.state.open, true); assert.equal(f.state.locationError, '');
  assert.equal(f.c.locationFlight.current, null); assert.equal(f.state.sending, false);
  assert.equal(f.c.locationModalEpoch.current, epoch);
});

test('Telegram lost response preserves selected point and blocks blind retry after reopening', async () => {
  let posts = 0;
  const f = locationSend({ platform: 'telegram', api: async (_, __, init) => {
    if (!init) return { delivery: 'not_found', locationTracking: 'v1' };
    posts++; throw new Error('Mock timeout after acceptance');
  } });
  await f.open(); await f.run(); assert.equal(posts, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.saved())), { requestId: '00000000-0000-4000-8000-000000000001', ...point });
  f.close(); await f.open(); assert.equal(f.state.recovery.requestId, f.saved().requestId);
  await f.run({ latitude: 1, longitude: 2 }); assert.equal(posts, 1);
  await f.run(point, true); assert.equal(posts, 1); assert.ok(f.saved());
  assert.match(f.state.locationError, /still unknown/);
});

test('Telegram completed reconciliation clears the saved request without another POST', async () => {
  const f = locationSend({ platform: 'telegram' });
  await f.c.saveLocationAttempt('', { requestId: '00000000-0000-4000-8000-000000000001', ...point });
  f.c.api = async (path, _, init) => { assert.equal(init, undefined); return { delivery: 'confirmed', locationTracking: 'v1' }; };
  await f.open(); await f.run(point, true); assert.equal(f.saved(), null); assert.equal(f.state.open, false);
});

test('old server and failed secure storage never dispatch a native Telegram location', async () => {
  for (const overrides of [
    { api: async () => { throw new Error('405 old deployment'); } },
    { saveLocationAttempt: async () => { throw new Error('Secure storage unavailable'); } },
    { api: async () => ({ success: true }) },
  ]) {
    let posts = 0; const f = locationSend({ platform: 'telegram', ...overrides }); const transport = f.c.api;
    f.c.api = async (...args) => { if (args[2]?.method === 'POST') posts++; return transport(...args); };
    await f.run(); assert.equal(posts, 0); assert.equal(f.state.sending, false);
  }
});

test('actual opening fails closed when persistent location tracking cannot be read', async () => {
  const f = locationSend({ platform: 'telegram', readLocationAttempt: async () => { throw Error('Storage locked'); } });
  await f.open(); assert.equal(f.state.ready, false); assert.match(f.state.locationError, /Could not read/);
});

for (const lifecycle of ['unmount', 'account/thread switch']) {
  for (const stage of ['saved request read', 'tracking GET', 'secure save']) {
    test(`actual Telegram handler stops POST after ${lifecycle} during ${stage}`, async () => {
      const pending = deferred(); let entered = false, posts = 0, saves = 0, clears = 0;
      const f = locationSend({ platform: 'telegram' });
      if (stage === 'saved request read') f.c.readLocationAttempt = async () => { entered = true; return pending.promise; };
      const transport = f.c.api;
      f.c.api = async (...args) => {
        if (args[2]?.method === 'POST') posts++;
        if (!args[2] && stage === 'tracking GET') { entered = true; return pending.promise; }
        return transport(...args);
      };
      const save = f.c.saveLocationAttempt, clear = f.c.clearLocationAttempt;
      f.c.saveLocationAttempt = async (...args) => {
        saves++; await save(...args);
        if (stage === 'secure save') { entered = true; await pending.promise; }
      };
      f.c.clearLocationAttempt = async (...args) => { clears++; return clear(...args); };
      const work = f.run(); await flush(); assert.equal(entered, true);
      if (lifecycle === 'unmount') f.c.screenAlive.current = false;
      else f.c.ownerRef.current = 'other-account-workspace:other-thread';
      const before = JSON.stringify(f.state);
      pending.resolve(stage === 'saved request read' ? null : { delivery: 'not_found', locationTracking: 'v1' });
      await work; assert.equal(posts, 0); assert.equal(JSON.stringify(f.state), before);
      if (stage !== 'secure save') { assert.equal(saves, 0); assert.equal(clears, 0); }
      else { assert.equal(clears, 1); assert.equal(f.saved(), null); }
    });
  }
}

function picker(options = {}) {
  const hooks = [], effects = [], timers = new Map(); let index = 0, nextTimer = 0, closes = 0;
  const locationCalls = [];
  const Location = {
    Accuracy: { Balanced: 3 },
    getForegroundPermissionsAsync: async () => { locationCalls.push('check'); return { granted: false }; },
    requestForegroundPermissionsAsync: async () => { locationCalls.push('request'); return { granted: false }; },
    getLastKnownPositionAsync: async () => { locationCalls.push('cached'); return null; },
    getCurrentPositionAsync: async () => { locationCalls.push('fresh'); return position; },
    ...options.location,
  };
  const react = {
    useState(initial) {
      const slot = index++; hooks[slot] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[slot].value, value => { hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value; }];
    },
    useRef(initial) { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useMemo: fn => { index++; return fn(); },
    useEffect(fn, deps) {
      const slot = index++, previous = hooks[slot];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); hooks[slot] = { deps, cleanup: fn() }; });
      }
    },
  };
  const components = Object.fromEntries(['ActivityIndicator', 'Image', 'Modal', 'Pressable', 'Text', 'View'].map(name => [name, name]));
  const load = loader({
    react, 'expo-location': Location, '@expo/vector-icons': { Ionicons: 'Icon' },
    'react-native': { ...components, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Linking: { openURL: async () => {} }, PanResponder: { create: () => ({ panHandlers: {} }) } },
    '../lib/map-tile-cache': { MAP_TILE_URL: '', cachedMapTile: () => null, loadMapTile: async () => 'file:///mock-tile', discardInvalidMapTile() {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    './ui': { colors: {}, styles: {} },
  }, {
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const { LocationPicker } = load('mobile/components/location-picker.tsx');
  let props = { open: true, sending: false, onSend() {}, onClose: () => { closes++; }, ...options.props }, tree;
  const render = changes => {
    props = { ...props, ...changes }; index = 0; tree = LocationPicker(props);
    effects.splice(0).forEach(fn => fn()); return tree;
  };
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const child of node) { const result = find(predicate, child); if (result) return result; } return null; }
    if (predicate(node)) return node;
    return node.props?.children === undefined ? null : find(predicate, node.props.children);
  }
  const press = label => { render(); const target = find(node => node.props?.accessibilityLabel === label); assert.ok(target, label); return target.props.onPress(); };
  render();
  return { render, press, find, hooks, timers, locationCalls, closes: () => closes,
    centre: () => hooks[0].value, locating: () => hooks[3].value, error: () => hooks[4].value,
    unmount: () => hooks.forEach(hook => hook?.cleanup?.()), tick: () => { for (const fn of [...timers.values()]) fn(); },
  };
}

test('picker-open permission denial is handled without requesting OS permission', async () => {
  const f = picker(); await flush();
  assert.match(f.error(), /Allow location/); assert.deepEqual(f.locationCalls, ['check']);
});

test('picker-open permission-check rejection becomes a visible notice', async () => {
  const f = picker({ location: { getForegroundPermissionsAsync: async () => { throw Error('Mock permission unavailable'); } } });
  await flush(); assert.match(f.error(), /Could not check/);
  f.render(); assert.ok(f.find(node => node.props?.accessibilityRole === 'alert'));
});

test('Use my location denial releases the spinner and keeps the manual pin available', async () => {
  const f = picker(); await flush(); f.press('Use where this phone is'); await flush();
  assert.equal(f.locating(), false); assert.match(f.error(), /Allow location/);
});

test('Use my location permission-request rejection releases the spinner', async () => {
  const f = picker({ location: { requestForegroundPermissionsAsync: async () => { throw Error('Mock permission request failed'); } } });
  await flush(); f.press('Use where this phone is'); await flush();
  assert.equal(f.locating(), false); assert.match(f.error(), /Could not get a location fix/);
});

test('late automatic cached position cannot update a closed picker', async () => {
  const pending = deferred();
  const f = picker({ location: { getForegroundPermissionsAsync: async () => ({ granted: true }), getLastKnownPositionAsync: () => pending.promise } });
  await flush(); f.render({ open: false }); const before = JSON.stringify(f.centre());
  pending.resolve(position); await flush(); assert.equal(JSON.stringify(f.centre()), before);
});

test('late permission result cannot update an unmounted picker', async () => {
  const pending = deferred();
  const f = picker({ location: { getForegroundPermissionsAsync: () => pending.promise } });
  f.unmount(); const before = f.error(); pending.resolve({ granted: false }); await flush();
  assert.equal(f.error(), before);
});

test('closing a pending permission request prevents later coordinate reads', async () => {
  const pending = deferred(); let requests = 0;
  const f = picker({ location: { requestForegroundPermissionsAsync: () => { requests++; return pending.promise; } } });
  await flush(); f.press('Use where this phone is'); f.press('Use where this phone is');
  assert.equal(requests, 1, 'same-frame location requests are serialized');
  f.press('Close the map'); pending.resolve({ granted: true }); await flush();
  assert.equal(f.locating(), false); assert.deepEqual(f.locationCalls, ['check']);
});

test('closing during a fresh fix cancels its timeout and ignores late coordinates', async () => {
  const pending = deferred();
  const f = picker({ location: { requestForegroundPermissionsAsync: async () => ({ granted: true }), getCurrentPositionAsync: () => pending.promise } });
  await flush(); f.press('Use where this phone is'); await flush(); assert.equal(f.timers.size, 1);
  f.press('Close the map'); assert.equal(f.closes(), 1); assert.equal(f.timers.size, 0);
  const before = JSON.stringify(f.centre()); pending.resolve(position); await flush();
  assert.equal(JSON.stringify(f.centre()), before); assert.equal(f.locating(), false);
});

test('fresh fix timeout gives a visible error and releases its spinner', async () => {
  const pending = deferred();
  const f = picker({ location: { requestForegroundPermissionsAsync: async () => ({ granted: true }), getCurrentPositionAsync: () => pending.promise } });
  await flush(); f.press('Use where this phone is'); await flush(); f.tick(); await flush();
  assert.equal(f.locating(), false); assert.equal(f.timers.size, 0); assert.match(f.error(), /Could not get a location fix/);
});

test('a send error is visible inside the location modal', async () => {
  const f = picker({ props: { sendError: 'Mock provider rejected this location' } }); await flush(); f.render();
  const alert = f.find(node => node.props?.accessibilityRole === 'alert');
  assert.ok(alert); assert.equal(alert.props.children, 'Mock provider rejected this location');
});

test('unresolved picker displays preserved point and disables sending with an explicit delivery check', async () => {
  let checked = 0;
  const f = picker({ props: { sendBlocked: true, pendingPoint: point, onCheckDelivery: () => { checked++; } } });
  f.render(); assert.equal(f.find(n => n.props?.accessibilityLabel === 'Send this location').props.disabled, true);
  f.press('Check location delivery'); assert.equal(checked, 1);
  assert.ok(f.find(n => typeof n.props?.children === 'string' && n.props.children.includes('Check delivery')));
});
