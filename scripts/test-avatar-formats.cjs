const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const sharp = require('sharp');
function loader(mocks) {
  const modules = new Map();
  function load(name) {
    if (name in mocks) return mocks[name];
    if (name === 'server-only') return {};
    if (!name.startsWith('@/')) return require(name);
    if (modules.has(name)) return modules.get(name).exports;
    const module = { exports: {} }; modules.set(name, module);
    const source = fs.readFileSync(path.join(process.cwd(), name.slice(2) + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(load, module, module.exports);
    return module.exports;
  }
  return load;
}
async function fixture() {
  return sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 30, g: 80, b: 140, alpha: 0.5 } } }).png().toBuffer();
}
test('JPEG variant produces actual JPEG bytes bounded to avatar dimensions', async () => {
  const { avatarThumbnail } = loader({})('@/lib/media/avatar-thumbnail');
  const result = await avatarThumbnail(await fixture(), 'jpeg');
  assert.equal(result[0], 0xff); assert.equal(result[1], 0xd8);
  const meta = await sharp(result).metadata();
  assert.equal(meta.format, 'jpeg'); assert(meta.width <= 256 && meta.height <= 256);
  assert.equal(meta.hasAlpha, false);
});
test('JPEG and WebP requests never share incompatible cached bytes', async () => {
  const input = await fixture(); let reads = 0;
  const load = loader({
    'next/cache': { unstable_cache: fn => fn },
    '@/lib/supabase/admin': { supabaseAdmin: { storage: { from: () => ({ download: async () => { reads++; await new Promise(r => setTimeout(r, 5)); return { data: new Blob([input]), error: null }; } }) } } },
  });
  const { loadStoredAvatar } = load('@/lib/media/load-stored-avatar');
  const [jpeg, webp, sameJpeg] = await Promise.all([
    loadStoredAvatar('private', 'workspace/contact', 'jpeg'),
    loadStoredAvatar('private', 'workspace/contact'),
    loadStoredAvatar('private', 'workspace/contact', 'jpeg'),
  ]);
  assert.equal(reads, 2);
  for (const [result, format] of [[jpeg, 'jpeg'], [webp, 'webp'], [sameJpeg, 'jpeg']]) {
    assert.equal(result.error, false);
    assert.equal(result.data.type, 'image/' + format);
    assert.equal((await sharp(Buffer.from(await result.data.arrayBuffer())).metadata()).format, format);
  }
});
for (const platform of ['facebook', 'telegram']) test(platform + ' avatar route authenticates and returns requested format', async () => {
  const formats = []; let allowed = true;
  const chain = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'contact', platform }, error: null }) };
  const load = loader({
    'next/server': { NextResponse: class extends Response { static json(data, opts) { return Response.json(data, opts); } } },
    '@/lib/inbox/get-inbox-resource-access': { getInboxContactAccess: async () => allowed ? { success: true, member: { business_id: 'workspace' } } : { success: false, status: 403, error: 'Denied' } },
    '@/lib/supabase/admin': { supabaseAdmin: { from: () => chain } },
    '@/lib/facebook/repair-facebook-avatar': { repairFacebookAvatar: async () => false },
    ['@/lib/' + platform + '/' + platform + '-profile-photo']: {
      [platform.toUpperCase() + '_AVATAR_BUCKET']: 'private',
      [platform + 'AvatarStoragePath']: ({ businessId, contactId }) => businessId + '/' + contactId,
    },
    '@/lib/media/load-stored-avatar': { loadStoredAvatar: async (bucket, key, format) => {
      assert.equal(bucket, 'private'); assert.equal(key, 'workspace/contact'); formats.push(format);
      return { data: new Blob(['image'], { type: 'image/' + format }), error: false };
    } },
  });
  const route = load('@/app/api/contacts/[contactId]/' + platform + '-avatar/route');
  for (const [query, expected] of [['?format=jpeg', 'jpeg'], ['', 'webp'], ['?format=anything', 'webp']]) {
    const response = await route.GET({ nextUrl: new URL('https://app.test/api/avatar' + query) }, { params: Promise.resolve({ contactId: 'contact' }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/' + expected);
    assert.equal(response.headers.get('cache-control'), 'private, max-age=3600');
  }
  assert.deepEqual(formats, ['jpeg', 'webp', 'webp']);
  allowed = false;
  assert.equal((await route.GET({ nextUrl: new URL('https://app.test/api/avatar?format=jpeg') }, { params: Promise.resolve({ contactId: 'contact' }) })).status, 403);
  assert.equal(formats.length, 3);
});
