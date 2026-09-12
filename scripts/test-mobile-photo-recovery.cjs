const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}
const photos = {};
vm.runInNewContext(compile(fs.readFileSync('mobile/lib/customer-photo.ts', 'utf8')), { exports: photos, encodeURIComponent, URL });
test('Facebook missing URL still requests stored/recoverable avatar', () => {
  assert.equal(photos.customerPhotoCandidates(null, 'customer-a', 'facebook')[0], '/api/contacts/customer-a/facebook-avatar?format=jpeg');
});
test('Facebook tries stable copy before expiring CDN link', () => {
  assert.equal(photos.customerPhotoCandidates('https://cdn.test/photo', 'customer-a', 'facebook').join(','), '/api/contacts/customer-a/facebook-avatar?format=jpeg,https://cdn.test/photo');
});
test('Telegram tries saved URL then stored copy, including missing saved URL', () => {
  assert.equal(photos.customerPhotoCandidates('https://cdn.test/photo', 'customer-a', 'telegram').join(','), 'https://cdn.test/photo,/api/contacts/customer-a/telegram-avatar?format=jpeg');
  assert.equal(photos.customerPhotoCandidates(null, 'customer-a', 'telegram')[0], '/api/contacts/customer-a/telegram-avatar?format=jpeg');
});
test('duplicate avatar paths are tried once; ordinary team avatars have no customer lookup', () => {
  assert.equal(photos.customerPhotoCandidates('/api/contacts/customer-a/telegram-avatar?format=jpeg', 'customer-a', 'telegram').length, 1);
  assert.equal(photos.customerPhotoCandidates(null).length, 0);
  assert.equal(photos.customerPhotoCandidates('https://cdn.test/team')[0], 'https://cdn.test/team');
});
test('older stored API paths are upgraded to JPEG without duplicate fallback requests', () => {
  for (const platform of ['facebook', 'telegram']) {
    const candidates = photos.customerPhotoCandidates(`/api/contacts/customer-a/${platform}-avatar`, 'customer-a', platform);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0], `/api/contacts/customer-a/${platform}-avatar?format=jpeg`);
  }
});

function harness({ local = null, privatePhoto = true, warm = false } = {}) {
  const states = [], effects = [], errors = [], removed = [], downloads = [];
  let index = 0, effectIndex = 0;
  const target = { uri: 'https://app.tenhchat.com/api/contacts/customer-a/telegram-avatar?format=jpeg', cacheScope: 'user:workspace', ...(privatePhoto ? { headers: { Cookie: 'test-session' } } : {}) };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compile(fs.readFileSync('mobile/components/auth-image.tsx', 'utf8') + '\nexport { CachedImage };'), {
    exports, URL, process: { env: {} },
    require(name) {
      if (name === 'react') return {
        useState(initial) { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useEffect(fn, deps) { const i = effectIndex++; if (!effects[i] || deps.some((v, n) => v !== effects[i][n])) { effects[i] = deps; fn(); } },
      };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native') return { View: 'View' };
      if (name === 'expo-image') return { Image: 'ExpoImage' };
      if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
      if (name === '../lib/media') return { useMediaSource: () => () => target };
      if (name === '../lib/media-key') return { stableMediaKey: value => value };
      if (name === '../lib/media-cache') return {
        getCachedMedia: () => warm ? local : null,
        cacheMedia: async (...args) => { downloads.push(args); return local; },
        removeCachedMedia: (...args) => removed.push(args),
      };
      throw Error(name);
    },
  });
  const render = () => {
    index = 0; effectIndex = 0;
    return exports.CachedImage({ uri: '/api/contacts/customer-a/telegram-avatar?format=jpeg', onError: () => errors.push('failed') });
  };
  render();
  return { render, errors, removed, downloads, target };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('disk-cache failure falls back to private image with its session header', async () => {
  const h = harness(); await tick();
  const source = h.render().props.source;
  assert.equal(source.uri, h.target.uri);
  assert.equal(source.headers.Cookie, 'test-session');
  assert.equal(h.errors.length, 0);
});
test('public CDN fallback never receives TENH authentication', async () => {
  const h = harness({ privatePhoto: false }); await tick();
  assert.equal(h.render().props.source.headers, undefined);
});
test('healthy cached image is used without another native remote download', async () => {
  const h = harness({ local: 'file:///cache/photo' }); await tick();
  assert.equal(h.render().type, 'ExpoImage');
  assert.equal(h.render().props.cachePolicy, 'none');
  assert.equal(h.render().props.contentFit, 'cover');
  assert.equal(h.render().props.source.uri, 'file:///cache/photo');
  assert.equal(h.downloads.length, 1);
  assert.equal(h.removed.length, 0);
});

test('a warm photo is available on the first render without a queued download', () => {
  const h = harness({ local: 'file:///cache/photo', warm: true });
  assert.equal(h.render().props.source.uri, 'file:///cache/photo');
  assert.equal(h.downloads.length, 0);
});

test('a refreshed session retries the image request with fresh authentication', async () => {
  const h = harness(); await tick();
  h.render().props.onError();
  h.target.headers.Cookie = 'refreshed-session';
  h.render(); await tick();
  assert.equal(h.render().type, 'ExpoImage');
  assert.equal(h.render().props.source.headers.Cookie, 'refreshed-session');
  assert.equal(h.downloads.length, 2);
});
test('corrupt disk image is evicted and native retry happens once before avatar fallback', async () => {
  const h = harness({ local: 'file:///cache/photo' }); await tick();
  h.render().props.onError();
  assert.equal(h.removed.length, 1);
  assert.equal(h.removed[0][1], 'user:workspace');
  assert.equal(h.errors.length, 0);
  assert.equal(h.render().props.source.uri, h.target.uri);
  assert.equal(h.render().props.source.headers.Cookie, 'test-session');
  h.render().props.onError();
  assert.equal(h.errors.length, 1);
  assert.equal(h.removed.length, 1);
});
