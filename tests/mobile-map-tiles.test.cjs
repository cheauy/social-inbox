const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
// Synthetic points, in-memory files, native hosts and transport only. No GPS,
// permissions, live tiles, customer sends or screenshot claims.

function cacheFixture(env = {}) {
  let now = 1000000000, handles = 0, peakWritten = 0;
  const files = new Map(), dirs = new Set(), calls = [], timers = new Map();
  class Directory {
    constructor(...parts) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
    get exists() { return dirs.has(this.uri); }
    create() { dirs.add(this.uri); }
    list() { return [...files.keys()].filter(uri => uri.startsWith(`${this.uri}/`)).map(uri => new File(uri)); }
  }
  class File {
    constructor(...parts) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
    get name() { return this.uri.split('/').at(-1); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.size ?? files.get(this.uri)?.body.length ?? 0; }
    get modificationTime() { return files.get(this.uri)?.time ?? null; }
    textSync() { return files.get(this.uri).body; }
    write(body) { files.set(this.uri, { body, time: now }); }
    create() { this.write(''); }
    open() { handles++; let closed = false; return { writeBytes: bytes => { const data = files.get(this.uri); data.body += Buffer.from(bytes).toString('latin1'); peakWritten = Math.max(peakWritten, data.body.length); }, close() { if (!closed) { closed = true; handles--; } } }; }
    delete() { files.delete(this.uri); }
    move(destination) { files.set(destination.uri, files.get(this.uri)); files.delete(this.uri); this.uri = destination.uri; }
  }
  class Clock extends Date { static now() { return now; } }
  const load = loader({
    'expo-file-system': { Directory, File, Paths: { cache: 'file:///mock-cache' } },
    'expo/fetch': { fetch: async (url, options) => { calls.push({ url, options }); return fixture.download ? fixture.download(url, options) : new Response('synthetic PNG bytes'); } },
  }, {
    AbortController, Date: Clock, process: { env },
    setTimeout: (fn) => { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const fixture = { files, calls, timers, File, Directory, download: null, handles: () => handles, peakWritten: () => peakWritten,
    seed(name, size = 64, age = 0, paired = true) {
      const folder = new Directory('file:///mock-cache', 'tenh-map-tiles-v1'); folder.create();
      const file = new File(folder, name); files.set(file.uri, { body: 'synthetic seed', size, time: now - age });
      if (paired) new File(`${file.uri}.json`).write('https://tiles.invalid/synthetic.png');
      return file;
    },
    advance: ms => { now += ms; }, reload: () => load('mobile/lib/map-tile-cache.ts') };
  fixture.api = fixture.reload(); return fixture;
}
const url = 'https://tile.openstreetmap.org/3/4/4.png';

test('OSM is the no-key default; custom and explicit-disabled configurations remain supported', () => {
  assert.equal(cacheFixture().api.MAP_TILE_URL, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(cacheFixture({ EXPO_PUBLIC_MAP_TILE_URL: '' }).api.MAP_TILE_URL, '');
  assert.equal(cacheFixture({ EXPO_PUBLIC_MAP_TILE_URL: 'https://tiles.invalid/{z}/{x}/{y}.png' }).api.MAP_TILE_URL, 'https://tiles.invalid/{z}/{x}/{y}.png');
});
test('download identifies TENHCHAT, supplies no auth/no-cache headers, and renders from a local file', async () => {
  const f = cacheFixture(), uri = await f.api.loadMapTile(url, new AbortController().signal);
  assert.match(uri, /^file:\/\/\/mock-cache\/tenh-map-tiles-v1\/.*\.png$/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].options.headers)), { 'User-Agent': 'TENHCHAT/1.0 (+https://app.tenhchat.com)' });
  assert.equal(f.calls[0].options.credentials, 'omit'); assert.equal(f.calls[0].options.redirect, 'error');
  assert.equal(f.files.size, 2); assert.equal(f.timers.size, 0);
});
test('repeat visits use the same disk entry for seven days; expiry allows replacement', async () => {
  const f = cacheFixture(), signal = new AbortController().signal;
  const first = await f.api.loadMapTile(url, signal);
  f.advance(f.api.MAP_TILE_TTL - 1);
  assert.equal(await f.api.loadMapTile(url, signal), first); assert.equal(f.calls.length, 1);
  f.advance(1); assert.equal(await f.api.loadMapTile(url, signal), first); assert.equal(f.calls.length, 2);
  assert.equal(f.files.size, 2);
});
test('failed/partial transport is cleaned and can be retried without caching the error', async () => {
  const f = cacheFixture(); f.download = async () => { throw new Error('synthetic 503'); };
  await assert.rejects(f.api.loadMapTile(url, new AbortController().signal), /503/);
  assert.equal(f.files.size, 0); assert.equal(f.api.cachedMapTile(url), null);
  f.download = null; await f.api.loadMapTile(url, new AbortController().signal); assert.equal(f.calls.length, 2);
});
test('closed and timed-out downloads cannot commit partial data', async () => {
  for (const mode of ['close', 'timeout']) {
    const f = cacheFixture(), pending = deferred(), controller = new AbortController();
    f.download = () => pending.promise;
    const work = f.api.loadMapTile(url, controller.signal);
    if (mode === 'close') controller.abort(); else [...f.timers.values()][0]();
    assert.equal(f.calls[0].options.signal.aborted, true);
    pending.resolve(new Response('synthetic late bytes')); await assert.rejects(work); assert.equal(f.files.size, 0); assert.equal(f.handles(), 0);
  }
});
test('an aborted view and unsafe tile URLs never start transport', async () => {
  const f = cacheFixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.api.loadMapTile(url, controller.signal));
  for (const unsafe of ['http://tiles.invalid/3/4/4.png', 'https://user:password@tiles.invalid/3/4/4.png']) {
    await assert.rejects(f.api.loadMapTile(unsafe, new AbortController().signal));
  }
  assert.equal(f.calls.length, 0);
});
test('decode failure discards only the matching invalid cache entry for retry', async () => {
  const f = cacheFixture(), signal = new AbortController().signal;
  const uri = await f.api.loadMapTile(url, signal);
  f.api.discardInvalidMapTile(url, 'file:///different-file'); assert.equal(f.files.size, 2);
  f.api.discardInvalidMapTile(url, uri); assert.equal(f.files.size, 0);
  await f.api.loadMapTile(url, signal); assert.equal(f.calls.length, 2);
});
test('pruning removes expired pairs, orphan images/metadata, and crash partials while preserving fresh pairs', () => {
  const f = cacheFixture(), fresh = f.seed('fresh.png'), expired = f.seed('expired.png', 64, f.api.MAP_TILE_TTL);
  const orphan = f.seed('orphan.png', 64, 0, false), partial = f.seed('crashed.part', 64, 0, false);
  const metadata = new f.File('file:///mock-cache/tenh-map-tiles-v1/missing.png.json'); metadata.write('synthetic orphan metadata');
  const retained = f.api.pruneMapTileCache();
  assert.equal(f.files.size, 2); assert.ok(fresh.exists); assert.equal(retained.entries, 1);
  assert.equal(retained.bytes, fresh.size + new f.File(`${fresh.uri}.json`).size);
  for (const entry of [expired, orphan, partial, metadata]) assert.equal(entry.exists, false);
});
test('an advertised oversized response is aborted before reading or creating a file; retry releases its reservation', async () => {
  const f = cacheFixture(); let reads = 0;
  f.download = async () => ({ ok: true, headers: new Headers({ 'content-length': String(f.api.MAX_MAP_TILE_BYTES + 1) }), body: { getReader() { reads++; throw Error('body must not be read'); } } });
  await assert.rejects(f.api.loadMapTile(url, new AbortController().signal));
  assert.equal(reads, 0); assert.equal(f.files.size, 0); assert.ok(f.calls[0].options.signal.aborted);
  f.download = null; await f.api.loadMapTile(url, new AbortController().signal); assert.equal(f.files.size, 2);
});
test('unknown-length streaming aborts on the first oversized chunk without writing it or reading the remainder', async () => {
  const f = cacheFixture(); let reads = 0, cancels = 0, released = 0;
  f.download = async () => ({ ok: true, headers: new Headers(), body: { getReader: () => ({
    read: async () => { reads++; return { done: false, value: new Uint8Array(64 * 1024) }; },
    cancel: async () => { cancels++; }, releaseLock() { released++; },
  }) } });
  await assert.rejects(f.api.loadMapTile(url, new AbortController().signal), /too large/);
  assert.equal(reads, 5); assert.equal(cancels, 1); assert.equal(released, 1);
  assert.equal(f.peakWritten(), f.api.MAX_MAP_TILE_BYTES); assert.equal(f.files.size, 0); assert.equal(f.handles(), 0);
  assert.ok(f.calls[0].options.signal.aborted);
});
test('a full cache rejects new transport, preserves fresh files, then admits retry after an entry expires', async () => {
  const f = cacheFixture(), signal = new AbortController().signal;
  const cached = await f.api.loadMapTile(url, signal);
  for (let i = 0; i < 127; i++) f.seed(`retained-${i}.png`, f.api.MAX_MAP_TILE_BYTES, i === 0 ? f.api.MAP_TILE_TTL - 1 : 0);
  const before = new Map(f.files);
  await assert.rejects(f.api.loadMapTile('https://tiles.invalid/new.png', signal), /cache is full/);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.files, before);
  assert.equal(await f.api.loadMapTile(url, signal), cached); assert.equal(f.calls.length, 1);
  f.advance(1); await f.api.loadMapTile('https://tiles.invalid/new.png', signal);
  assert.equal(f.calls.length, 2); assert.equal(f.api.pruneMapTileCache().entries, 128);
  assert.ok(f.api.pruneMapTileCache().bytes <= f.api.MAX_MAP_CACHE_BYTES);
});
test('the entry count also bounds filesystem overhead without evicting fresh tiny tiles', async () => {
  const f = cacheFixture(); for (let i = 0; i < f.api.MAX_MAP_CACHE_ENTRIES; i++) f.seed(`tiny-${i}.png`, 1);
  const before = new Map(f.files);
  await assert.rejects(f.api.loadMapTile(url, new AbortController().signal), /cache is full/);
  assert.deepEqual(f.files, before); assert.equal(f.calls.length, 0);
});
test('admission reserves worst-case bytes across concurrent transfers and never prunes their active partials', async () => {
  const f = cacheFixture(), pending = deferred();
  for (let i = 0; i < 124; i++) f.seed(`stored-${i}.png`, f.api.MAX_MAP_TILE_BYTES);
  f.download = () => pending.promise.then(() => new Response('synthetic bytes'));
  const controllers = Array.from({ length: 3 }, () => new AbortController());
  const work = controllers.map((c, i) => f.api.loadMapTile(`https://tiles.invalid/inflight-${i}.png`, c.signal));
  assert.equal(f.calls.length, 3);
  await assert.rejects(f.api.loadMapTile('https://tiles.invalid/fourth.png', new AbortController().signal), /cache is full/);
  pending.resolve();
  await Promise.all(work);
  f.download = null; await f.api.loadMapTile('https://tiles.invalid/retry.png', new AbortController().signal);
  assert.equal(f.handles(), 0); assert.ok(f.api.pruneMapTileCache().bytes <= f.api.MAX_MAP_CACHE_BYTES);
});
test('reserved bytes reject admission before the concurrency limit when only one transfer fits', async () => {
  const f = cacheFixture(), pending = deferred(); for (let i = 0; i < 126; i++) f.seed(`retained-${i}.png`, f.api.MAX_MAP_TILE_BYTES);
  f.download = () => pending.promise;
  const work = f.api.loadMapTile(url, new AbortController().signal);
  await assert.rejects(f.api.loadMapTile('https://tiles.invalid/second.png', new AbortController().signal), /cache is full/);
  assert.equal(f.calls.length, 1); pending.resolve(new Response('synthetic bytes')); await work;
  assert.ok(f.api.pruneMapTileCache().bytes <= f.api.MAX_MAP_CACHE_BYTES);
});
test('pruning preserves a bounded active partial and excludes it from retained bytes covered by reservation', async () => {
  const f = cacheFixture(), pending = deferred(); let reads = 0;
  f.download = async () => ({ ok: true, headers: new Headers(), body: { getReader: () => ({
    read: async () => { reads++; return reads === 1 ? { done: false, value: new Uint8Array(64) } : pending.promise; },
    cancel: async () => {}, releaseLock() {},
  }) } });
  const work = f.api.loadMapTile(url, new AbortController().signal); await flush();
  const partial = [...f.files.keys()].find(uri => uri.endsWith('.part')); assert.ok(partial);
  assert.equal(f.api.pruneMapTileCache().bytes, 0); assert.ok(f.files.has(partial));
  pending.resolve({ done: true }); await work; assert.equal(f.files.size, 2); assert.equal(f.handles(), 0);
});
test('a fresh oversized legacy tile is not evicted and re-downloaded before its seven-day TTL', async () => {
  const f = cacheFixture(), signal = new AbortController().signal;
  const uri = await f.api.loadMapTile(url, signal); f.files.get(uri).size = f.api.MAX_MAP_TILE_BYTES + 1;
  await assert.rejects(f.api.loadMapTile(url, signal), /Cached map tile unavailable/);
  assert.ok(f.files.has(uri)); assert.equal(f.calls.length, 1);
  f.advance(f.api.MAP_TILE_TTL); await f.api.loadMapTile(url, signal); assert.equal(f.calls.length, 2);
});

function pickerFixture(options = {}) {
  const hooks = [], effects = [], timers = new Map(), cache = new Map(), calls = [], sent = [], links = [];
  let index = 0, nextTimer = 0, appStateListener, removed = false, tree;
  const native = Object.fromEntries(['ActivityIndicator', 'Image', 'Modal', 'Pressable', 'Text', 'View'].map(name => [name, name]));
  const react = {
    useState(initial) { const slot = index++; hooks[slot] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[slot].value, v => { hooks[slot].value = typeof v === 'function' ? v(hooks[slot].value) : v; }]; },
    useRef(initial) { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useMemo(fn) { index++; return fn(); },
    useEffect(fn, deps) { const slot = index++, before = hooks[slot]; if (!before || deps.some((v, i) => v !== before.deps[i])) effects.push(() => { before?.cleanup?.(); hooks[slot] = { deps, cleanup: fn() }; }); },
  };
  const tileApi = {
    MAP_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    cachedMapTile: url => cache.get(url) ?? null,
    discardInvalidMapTile: url => cache.delete(url),
    async loadMapTile(url, signal) { calls.push({ url, signal }); const uri = await (options.download?.(url, signal) ?? `file:///synthetic/${calls.length}.png`); if (!signal.aborted) cache.set(url, uri); return uri; },
  };
  const load = loader({
    react, '@expo/vector-icons': { Ionicons: 'Icon' }, '../lib/map-tile-cache': tileApi,
    './ui': { colors: {}, styles: {} }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-location': { getForegroundPermissionsAsync: async () => ({ granted: false }), requestForegroundPermissionsAsync: async () => ({ granted: false }) },
    'react-native': { ...native, AppState: { currentState: 'active', addEventListener(_, listener) { appStateListener = listener; return { remove() { removed = true; } }; } }, Linking: { openURL: async url => { links.push(url); } }, PanResponder: { create: handlers => ({ panHandlers: handlers }) } },
  }, { AbortController, setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  const { LocationPicker } = load('mobile/components/location-picker.tsx');
  let props = { open: true, sending: false, onSend: point => sent.push(point), onClose() {}, ...options.props };
  function render(changes = {}) { props = { ...props, ...changes }; index = 0; tree = LocationPicker(props); effects.splice(0).forEach(fn => fn()); return tree; }
  function nodes(root = tree) {
    const out = [];
    function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; } out.push(node); walk(node.props?.children); }
    walk(root); return out;
  }
  const find = fn => nodes().find(fn);
  const f = { calls, sent, cache, links, nodes, find, render, timers,
    press(label) { render(); const node = find(n => n.props?.accessibilityLabel === label); assert.ok(node, label); if (!node.props.disabled) node.props.onPress(); },
    layout() { render(); find(n => n.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 320, height: 480 } } }); render(); },
    tick() { const work = [...timers]; timers.clear(); work.forEach(([, fn]) => fn()); },
    state(value) { appStateListener(value); render(); },
    unmount() { hooks.forEach(h => h?.cleanup?.()); }, removed: () => removed,
  };
  render(); return f;
}
test('open viewport requests only its intersecting tiles and attribution opens the copyright link', async () => {
  const f = pickerFixture(); assert.equal(f.calls.length, 0); f.layout(); assert.equal(f.calls.length, 0);
  f.tick(); await flush(); f.render(); assert.equal(f.calls.length, 6);
  assert.ok(f.nodes().filter(n => n.type === 'Image').every(n => n.props.source.uri.startsWith('file:///')));
  const marker = f.find(n => n.props?.pointerEvents === 'none'); assert.equal(marker.props.style.left, 142); assert.equal(marker.props.style.top, 204);
  f.press('OpenStreetMap copyright and contributors'); await flush(); assert.deepEqual(f.links, ['https://www.openstreetmap.org/copyright']); f.unmount();
});
test('closed picker never downloads even after layout', async () => {
  const f = pickerFixture({ props: { open: false } }); f.layout(); f.tick(); await flush(); assert.equal(f.calls.length, 0); f.unmount();
});
test('failed map shows retry and keeps manual coordinate sending available', async () => {
  let fail = true; const f = pickerFixture({ download: async () => { if (fail) throw new Error('synthetic outage'); return 'file:///synthetic/retry.png'; } });
  f.layout(); f.tick(); await flush(); f.render();
  assert.ok(f.find(n => typeof n.props?.children === 'string' && n.props.children.startsWith('Map unavailable.')));
  assert.ok(f.find(n => n.type === 'Text' && n.props.children === '11.55640, 104.92820'), 'selected coordinates remain visible alongside the permission notice');
  f.press('Send this location'); assert.equal(f.sent.length, 1);
  fail = false; f.press('Retry map'); f.render(); f.tick(); await flush(); f.render();
  assert.equal(f.find(n => n.props?.accessibilityLabel === 'Retry map'), undefined); assert.equal(f.nodes().filter(n => n.type === 'Image').length, 6); f.unmount();
});
test('viewport concurrency is limited to three; close aborts pending and never starts queued tiles', async () => {
  const pending = deferred(), f = pickerFixture({ download: () => pending.promise });
  f.layout(); f.tick(); assert.equal(f.calls.length, 3); f.press('Close the map');
  assert.ok(f.calls.every(c => c.signal.aborted)); pending.resolve('file:///late.png'); await flush(); f.render();
  assert.equal(f.calls.length, 3); assert.equal(f.nodes().filter(n => n.type === 'Image').length, 0); f.unmount();
});
test('backgrounding aborts viewport transfers; resume reuses cache and unmount removes listener', async () => {
  const f = pickerFixture(); f.layout(); f.tick(); await flush(); f.render(); const count = f.calls.length;
  f.state('background'); assert.ok(f.calls.every(c => c.signal.aborted)); f.tick(); await flush(); assert.equal(f.calls.length, count);
  f.state('active'); f.tick(); await flush(); assert.equal(f.calls.length, count); f.unmount(); assert.equal(f.removed(), true);
});
test('image decode failure triggers a visible retry and invalidates only that tile', async () => {
  const f = pickerFixture(); f.layout(); f.tick(); await flush(); f.render();
  f.find(n => n.type === 'Image').props.onError(); f.render(); assert.equal(f.cache.size, 5);
  f.press('Retry map'); f.render(); f.tick(); await flush(); f.render(); assert.equal(f.calls.length, 7); assert.equal(f.cache.size, 6); f.unmount();
});
test('pixel pan within one tile set never restarts downloads', async () => {
  const f = pickerFixture(); f.layout(); f.tick(); await flush(); f.render();
  const map = f.find(n => n.props?.onPanResponderGrant); map.props.onPanResponderGrant(); map.props.onPanResponderMove(null, { dx: 1, dy: 1 });
  f.render(); f.tick(); await flush(); assert.equal(f.calls.length, 6); assert.ok(f.calls.every(c => !c.signal.aborted)); f.unmount();
});
test('closing before the viewport debounce starts no tile requests', async () => {
  const f = pickerFixture(); f.layout(); f.render({ open: false }); f.tick(); await flush(); assert.equal(f.calls.length, 0); f.unmount();
});
test('viewport changes abort old transfers and late results cannot fill the new view', async () => {
  const pending = deferred(), f = pickerFixture({ download: () => pending.promise });
  f.layout(); f.tick(); const old = [...f.calls];
  const map = f.find(n => n.props?.onPanResponderGrant); map.props.onPanResponderGrant(); map.props.onPanResponderMove(null, { dx: 768, dy: 0 });
  f.render(); assert.ok(old.every(c => c.signal.aborted)); pending.resolve('file:///stale.png'); await flush(); f.render();
  assert.equal(f.nodes().filter(n => n.type === 'Image').length, 0); assert.equal(f.calls.length, 3); f.unmount();
});
test('retry reloads failed tiles and preserves successful cached tiles', async () => {
  let fail = true, firstURL;
  const f = pickerFixture({ download: async url => { firstURL ??= url; if (fail && url === firstURL) throw new Error('synthetic single-tile outage'); return 'file:///healthy.png'; } });
  f.layout(); f.tick(); await flush(); f.render(); assert.equal(f.cache.size, 5); assert.equal(f.calls.length, 6);
  fail = false; f.press('Retry map'); f.render(); f.tick(); await flush(); f.render(); assert.equal(f.calls.length, 7); assert.equal(f.cache.size, 6); f.unmount();
});
test('late native image errors after closing cannot invalidate cached imagery', async () => {
  const f = pickerFixture(); f.layout(); f.tick(); await flush(); f.render();
  const image = f.find(n => n.type === 'Image'); f.press('Close the map'); image.props.onError();
  assert.equal(f.cache.size, 6); f.unmount();
});
test('full real cache reaches the picker unavailable state without transport; expiry permits visible-tile retry', async () => {
  const disk = cacheFixture(); for (let i = 0; i < 127; i++) disk.seed(`retained-${i}.png`, disk.api.MAX_MAP_TILE_BYTES);
  const before = new Map(disk.files), f = pickerFixture({ download: (url, signal) => disk.api.loadMapTile(url, signal) });
  f.layout(); f.tick(); await flush(); f.render();
  assert.ok(f.find(n => typeof n.props?.children === 'string' && n.props.children.startsWith('Map unavailable.')));
  assert.equal(disk.calls.length, 0); assert.deepEqual(disk.files, before);
  f.press('Send this location'); assert.equal(f.sent.length, 1);
  disk.advance(disk.api.MAP_TILE_TTL); f.press('Retry map'); f.render(); f.tick(); await flush(); await flush(); f.render();
  assert.equal(f.find(n => n.props?.accessibilityLabel === 'Retry map'), undefined); assert.equal(disk.calls.length, 6); f.unmount();
});
