const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');
const mobileRequire = createRequire(path.resolve('mobile/package.json'));
const React = mobileRequire('react');
const babel = mobileRequire('@babel/core');

// Exercise the installed native React reconciler, Sheet and FlatList JavaScript.
// Native host views, virtualization/layout, images, storage and HTTP are isolated
// boundaries: this fixture provides no physical Android/iOS rendering evidence.
function fixture({ platform = 'telegram', os = 'ios', recents = [], load, onSend = async () => {} } = {}) {
  const errors = [], calls = [], roots = new Map(); let closes = 0;
  const manager = {
    createNode: (tag, type, root, props, fiber) => ({ tag, type, props, fiber, children: [] }),
    createChildSet: () => [], appendChild: (node, child) => node.children.push(child),
    appendChildToSet: (set, child) => set.push(child), completeRoot: (root, set) => roots.set(root, set),
    cloneNodeWithNewChildren: node => ({ ...node, children: [] }),
    cloneNodeWithNewProps: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
    cloneNodeWithNewChildrenAndProps: (node, props) => ({ ...node, props: { ...node.props, ...props }, children: [] }),
    registerEventHandler() {}, setIsJSResponder() {},
  };
  const privateInterface = {
    ReactNativeViewConfigRegistry: { get: type => ({ uiViewClassName: type, validAttributes: {} }) },
    createAttributePayload: props => props, diffAttributePayloads: (old, next) => next,
    deepFreezeAndThrowOnMutationInDev() {},
    createPublicInstance: (tag, config, fiber) => ({ tag, fiber }),
    createPublicRootInstance: root => ({ root }), createPublicTextInstance: fiber => ({ fiber }),
    ReactFiberErrorDialog: { showErrorDialog: () => false }, RawEventEmitter: { emit() {} }, UIManager: {},
  };
  const context = vm.createContext({ console, Error, setTimeout, clearTimeout, queueMicrotask, URLSearchParams,
    __DEV__: true, nativeFabricUIManager: manager, RN$enableMicrotasksInReact: true,
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout });
  function evaluate(source, filename, require) {
    const module = { exports: {} };
    const run = vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename });
    run(require, module, module.exports); return module.exports;
  }
  function typed(file, require) {
    return evaluate(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText, file, require);
  }
  const renderer = evaluate(fs.readFileSync(mobileRequire.resolve('react-native/Libraries/Renderer/implementations/ReactFabric-dev.js'), 'utf8'), 'ReactFabric-dev.js', id => {
    if (id.endsWith('ReactNativePrivateInitializeCore')) return {};
    if (id.endsWith('ReactNativePrivateInterface')) return privateInterface;
    return mobileRequire(id);
  });
  const styles = { create: value => value, compose: (a, b) => [a, b], flatten: value => value, hairlineWidth: 1 };
  const native = { View: 'RCTView', Text: 'RCTText', Pressable: 'RCTView', ScrollView: 'RCTScrollView',
    TextInput: 'RCTTextInput', ActivityIndicator: 'RCTActivityIndicator', Modal: 'RCTModalHostView',
    Image: 'RCTImageView', KeyboardAvoidingView: 'RCTView', Keyboard: { dismiss() {} },
    Platform: { OS: os, select: obj => obj[os] ?? obj.default }, StyleSheet: styles };
  function VirtualizedList(props) {
    const rows = Array.from({ length: props.getItemCount(props.data) }, (_, index) => {
      const item = props.getItem(props.data, index);
      return React.createElement(React.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index, separators: {} }));
    });
    return React.createElement('RCTView', null, rows.length ? rows : props.ListEmptyComponent, props.ListFooterComponent);
  }
  const flatPath = mobileRequire.resolve('react-native/Libraries/Lists/FlatList.js');
  native.FlatList = evaluate(babel.transformSync(fs.readFileSync(flatPath, 'utf8'), {
    filename: flatPath, babelrc: false, configFile: false, presets: [mobileRequire.resolve('@react-native/babel-preset')],
  }).code, flatPath, id => {
    if (id === 'react') return React;
    if (id.includes('ReactNativeFeatureFlags')) return new Proxy({}, { get: () => () => false });
    if (id.endsWith('/View')) return { default: native.View, __esModule: true };
    if (id.includes('StyleSheet')) return { default: styles };
    if (id.includes('deepDiffer')) return { default: (a, b) => JSON.stringify(a) !== JSON.stringify(b) };
    if (id.includes('/Platform')) return { default: native.Platform };
    if (id === '@react-native/virtualized-lists') return { VirtualizedList, keyExtractor: (item, i) => item.key ?? String(i) };
    return mobileRequire(id);
  }).default;
  const cache = typed('mobile/lib/api/read-cache.ts', mobileRequire);
  const baseRequire = id => {
    if (id === 'react-native') return native;
    if (id === 'react' || id.startsWith('react/')) return mobileRequire(id);
    if (id === '@expo/vector-icons') return { Ionicons: 'RCTView' };
    if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
    if (id.endsWith('/auth-image')) return { AuthImage: props => React.createElement('RCTImageView', props) };
    if (id.endsWith('/customer-photo')) return {};
    if (id.endsWith('.png')) return 1;
    throw Error(`Unexpected fixture import ${id}`);
  };
  const ui = typed('mobile/components/ui.tsx', baseRequire);
  const catalog = typed('lib/telegram/sticker-catalog.ts', baseRequire);
  const { StickerPicker } = typed('mobile/components/sticker-picker.tsx', id => {
    if (id.endsWith('/auth/provider')) return { useAuth: () => ({ session: { user: { id: 'mock-user' } } }) };
    if (id.endsWith('/sticker-recents')) return { readStickerRecents: async () => recents, rememberSticker: async () => {}, stickerRecentGeneration: () => 0 };
    if (id.endsWith('/api/client')) return { cachedApi: (url, workspace, options) => cache.cachedRead(workspace + url, async () => {
      calls.push(url); return load ? load(url, calls.length, workspace) : url.includes('/packs?') ? { packs: [{ packId: 'mock-pack', name: 'Mock pack' }] } : { stickers: [{ stickerId: 'mock-sticker', setName: 'UtyaDuck', label: 'Mock sticker' }] };
    }, options) };
    if (id === './ui') return ui;
    if (id.endsWith('/sticker-catalog')) return catalog;
    return baseRequire(id);
  });
  let props = { conversationId: 'mock-thread', workspaceId: 'mock-workspace', platform, onClose() { closes++; }, onSend };
  const render = () => renderer.render(React.createElement(StickerPicker, props), 11, null, true,
    { onUncaughtError: e => errors.push(e), onCaughtError: e => errors.push(e) });
  render();
  function nodes() { const out = []; const walk = node => { out.push(node); node.children?.forEach(walk); }; (roots.get(11) ?? []).forEach(walk); return out; }
  const text = node => node.type === 'RCTRawText' ? node.props.text : (node.children ?? []).map(text).join('');
  const press = label => { const node = nodes().find(n => n.props?.onPress && (n.props.accessibilityLabel === label || text(n) === label)); assert.ok(node, `Missing press target: ${label}`); node.props.onPress(); };
  const settle = async (ms = 35) => { await new Promise(resolve => setTimeout(resolve, ms)); assert.deepEqual(errors.map(e => e.message), []); };
  return { calls, errors, nodes, text, press, settle, update: next => { props = { ...props, ...next }; render(); },
    get closes() { return closes; }, close: () => renderer.stopSurface(11) };
}

for (const os of ['ios', 'android']) test(`native JS mount (${os} boundary): empty Telegram recents, pack rows and close`, async () => {
  const f = fixture({ os }); try { await f.settle(); assert.equal(f.calls.length, 0); f.press('🦆 Duck'); await f.settle(); assert.equal(f.calls.length, 1); f.press('Close stickers'); assert.equal(f.closes, 1); } finally { f.close(); }
});

for (const os of ['ios', 'android']) test(`native JS mount (${os} boundary): Facebook pack loading and selected catalog`, async () => {
  const f = fixture({ platform: 'facebook', os }); try { await f.settle(); assert.equal(f.calls.length, 1); f.press('Mock pack'); await f.settle(); assert.equal(f.calls.length, 2); } finally { f.close(); }
});

test('Reload stickers refreshes a fresh Telegram catalog after an isolated send error', async () => {
  const f = fixture({ onSend: async () => { throw Error('Mock send failure'); } });
  try { await f.settle(); f.press('🦆 Duck'); await f.settle(); f.press('Send Mock sticker'); await f.settle(); f.press('Reload stickers'); await f.settle(); assert.equal(f.calls.length, 2); } finally { f.close(); }
});

test('Reload stickers refreshes both fresh Facebook pack and item catalogs', async () => {
  const f = fixture({ platform: 'facebook', onSend: async () => { throw Error('Mock send failure'); } });
  try { await f.settle(); f.press('Mock pack'); await f.settle(); f.press('Send Mock sticker'); await f.settle(); f.press('Reload stickers'); await f.settle(); assert.equal(f.calls.length, 4); } finally { f.close(); }
});

test('Reload stickers refreshes a fresh Facebook search result', async () => {
  const f = fixture({ platform: 'facebook', onSend: async () => { throw Error('Mock send failure'); } });
  try { await f.settle(); f.nodes().find(n => n.props?.accessibilityLabel === 'Search stickers').props.onChangeText('duck');
    await f.settle(450); assert.match(f.calls[1], /\/search\?.*q=duck/); f.press('Send Mock sticker'); await f.settle();
    f.press('Reload stickers'); await f.settle(450); assert.equal(f.calls.filter(url => url.includes('/search?')).length, 2);
  } finally { f.close(); }
});

test('pack revisit after Reload retains normal catalog freshness', async () => {
  const f = fixture({ onSend: async () => { throw Error('Mock send failure'); } });
  try { await f.settle(); f.press('🦆 Duck'); await f.settle(); f.press('Send Mock sticker'); await f.settle();
    f.press('Reload stickers'); await f.settle(); assert.equal(f.calls.length, 2);
    f.press('Recently Used'); await f.settle(); f.press('🦆 Duck'); await f.settle(); assert.equal(f.calls.length, 2);
    f.press('Send Mock sticker'); await f.settle(); f.press('Reload stickers'); await f.settle(); assert.equal(f.calls.length, 3);
  } finally { f.close(); }
});

test('search change and revisit after Reload retain normal result freshness', async () => {
  const f = fixture({ platform: 'facebook', onSend: async () => { throw Error('Mock send failure'); } });
  const search = value => f.nodes().find(n => n.props?.accessibilityLabel === 'Search stickers').props.onChangeText(value);
  const requests = query => f.calls.filter(url => url.includes('/search?') && url.includes(`q=${query}`)).length;
  try { await f.settle(); search('cat'); await f.settle(450); search('duck'); await f.settle(450);
    f.press('Send Mock sticker'); await f.settle(); f.press('Reload stickers'); await f.settle(450); assert.equal(requests('duck'), 2);
    search('cat'); await f.settle(450); assert.equal(requests('cat'), 1);
    search('duck'); await f.settle(450); assert.equal(requests('duck'), 2);
  } finally { f.close(); }
});

test('cancelled debounced Reload does not force the next cached search', async () => {
  const f = fixture({ platform: 'facebook', onSend: async () => { throw Error('Mock send failure'); } });
  const search = value => f.nodes().find(n => n.props?.accessibilityLabel === 'Search stickers').props.onChangeText(value);
  try { await f.settle(); search('cat'); await f.settle(450); search('duck'); await f.settle(450);
    f.press('Send Mock sticker'); await f.settle(); f.press('Reload stickers'); await f.settle();
    search('cat'); await f.settle(450); assert.equal(f.calls.filter(url => url.includes('/search?')).length, 2);
  } finally { f.close(); }
});

test('workspace switch after Reload preserves cache scope and rejects late results', async () => {
  let complete;
  const f = fixture({ onSend: async () => { throw Error('Mock send failure'); }, load: async (url, count, workspace) => {
    if (count === 3) return new Promise(resolve => { complete = resolve; });
    return { stickers: [{ stickerId: workspace, setName: 'UtyaDuck', label: workspace }] };
  } });
  try { await f.settle(); f.press('🦆 Duck'); await f.settle();
    f.update({ workspaceId: 'other-workspace', conversationId: 'other-thread' }); await f.settle();
    f.update({ workspaceId: 'mock-workspace', conversationId: 'mock-thread' }); await f.settle();
    f.press('Send mock-workspace'); await f.settle(); f.press('Reload stickers'); await f.settle();
    f.update({ workspaceId: 'other-workspace', conversationId: 'other-thread' }); await f.settle();
    assert.equal(f.calls.length, 3); complete({ stickers: [{ stickerId: 'late', setName: 'UtyaDuck', label: 'Late old workspace' }] });
    await f.settle(); assert.ok(f.nodes().some(n => n.props?.accessibilityLabel === 'Send other-workspace'));
    assert.ok(!f.nodes().some(n => n.props?.accessibilityLabel === 'Send Late old workspace'));
  } finally { f.close(); }
});

test('catalog failure renders retry and Reload recovers without sending', async () => {
  const f = fixture({ load: async (url, count) => { if (count === 1) throw Error('Mock catalog unavailable'); return { stickers: [] }; } });
  try { await f.settle(); f.press('🦆 Duck'); await f.settle(); assert.ok(f.nodes().some(n => f.text(n) === 'Mock catalog unavailable'));
    f.press('Reload stickers'); await f.settle(); assert.equal(f.calls.length, 2); assert.ok(f.nodes().some(n => f.text(n) === 'No stickers found.')); } finally { f.close(); }
});

test('same-frame double tap sends once and blocks close while the mock send is pending', async () => {
  let complete, sends = 0;
  const f = fixture({ recents: [{ stickerId: 'recent', setName: 'UtyaDuck', label: 'Recent sticker', previewUrl: 'mock://thumbnail' }],
    onSend: () => { sends++; return new Promise(resolve => { complete = resolve; }); } });
  try { await f.settle(); f.press('Send Recent sticker'); f.press('Send Recent sticker'); f.press('Close stickers');
    assert.equal(sends, 1); assert.equal(f.closes, 0); complete(); await f.settle(); f.press('Close stickers'); assert.equal(f.closes, 1);
  } finally { f.close(); }
});

test('catalog completion after unmount does not resurrect the picker', async () => {
  let complete;
  const f = fixture({ load: () => new Promise(resolve => { complete = resolve; }) });
  await f.settle(); f.press('🦆 Duck'); await f.settle(); f.close(); await f.settle();
  complete({ stickers: [{ stickerId: 'late', setName: 'UtyaDuck', label: 'Late sticker' }] }); await f.settle(); assert.equal(f.nodes().length, 0);
});
