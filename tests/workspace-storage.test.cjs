const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader, database } = require('./tenh-seven/harness.cjs');

const {
  WORKSPACE_FILE_BUCKET,
  WORKSPACE_FILE_MAX_BYTES,
  isWorkspaceFilePathOwned,
  workspaceFileKind,
  workspaceFilePath,
} = loader({})('lib/storage/workspace-files.ts');

test('workspace Storage classifies only the supported reusable attachment types', () => {
  assert.equal(workspaceFileKind('photo.bin', 'image/webp'), 'image');
  assert.equal(workspaceFileKind('clip.bin', 'video/mp4'), 'video');
  assert.equal(workspaceFileKind('voice.mp3', 'application/octet-stream'), 'audio');
  assert.equal(workspaceFileKind('invoice.pdf', 'application/octet-stream'), 'file');
  assert.equal(workspaceFileKind('installer.exe', 'application/octet-stream'), null);
  assert.equal(WORKSPACE_FILE_MAX_BYTES, 20 * 1024 * 1024);
  assert.equal(WORKSPACE_FILE_BUCKET, 'tenh-workspace-files');
});

test('workspace object paths are tenant-prefixed, flat, and sanitize traversal', () => {
  const path = workspaceFilePath({ businessId: 'shop-a', fileId: 'file-1', fileName: '../../Price list (final).pdf' });
  assert.equal(path, 'shop-a/file-1-Price_list_final_.pdf');
  assert.equal(isWorkspaceFilePathOwned(path, 'shop-a'), true);
  assert.equal(isWorkspaceFilePathOwned(path, 'shop-b'), false);
  assert.equal(isWorkspaceFilePathOwned('shop-a/nested/file.pdf', 'shop-a'), false);
  assert.equal(isWorkspaceFilePathOwned('shop-a2/file.pdf', 'shop-a'), false);
});

test('workspace API enforces membership tenant filters and verifies uploaded bytes before insert', () => {
  const source = fs.readFileSync('app/api/workspace-storage/files/route.ts', 'utf8');
  assert.match(source, /getCurrentMember\(\)/);
  assert.ok((source.match(/\.eq\("business_id", auth\.member\.business_id\)/g) ?? []).length >= 2);
  assert.match(source, /isWorkspaceFilePathOwned\(path, auth\.member\.business_id\)/);
  assert.match(source, /\.info\(path\)/);
  assert.match(source, /stored\.data\.size !== file\.sizeBytes/);
  assert.match(source, /storedType !== file\.mimeType/);
  assert.match(source, /uploaded_by_member_id: auth\.member\.id/);
});

test('migration draft creates a private service-only workspace store without touching customer files', () => {
  const sql = fs.readFileSync('db/migrations/20261008_workspace_storage.sql', 'utf8');
  const checks = fs.readFileSync('docs/sql/workspace-storage-readonly-checks.sql', 'utf8');
  assert.match(sql, /create table if not exists public\.workspace_files/);
  assert.match(sql, /storage_path like business_id::text \|\| '\/%'/);
  assert.match(sql, /revoke all on table public\.workspace_files from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.workspace_files to service_role/);
  assert.match(sql, /'tenh-workspace-files', 'tenh-workspace-files', false/);
  assert.doesNotMatch(sql, /alter table public\.customer_files|update public\.customer_files/);
  assert.match(checks, /select grantee, privilege_type, is_grantable/);
  assert.doesNotMatch(checks, /select role_name/);
  assert.match(checks, /values \('businesses', 'id', 'uuid'\), \('team_members', 'id', 'uuid'\)/);
  assert.match(checks, /where schemaname = 'storage' and tablename = 'objects'\s*order by policyname/);
  assert.match(checks, /aclexplode\(coalesce\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/);
});

function routeSetup({ businessId = 'shop-a', active = true, rows = [], stored = {} } = {}) {
  const db = database({ workspace_files: rows });
  const removed = [];
  db.storage = {
    from(bucket) {
      assert.equal(bucket, WORKSPACE_FILE_BUCKET);
      return {
        async createSignedUploadUrl(path) { return { data: { token: 'upload-token', path }, error: null }; },
        async createSignedUrl(path) { return { data: { signedUrl: `https://signed.invalid/${path}` }, error: null }; },
        async info(path) { return stored[path] ? { data: stored[path], error: null } : { data: null, error: { message: 'missing' } }; },
        async remove(paths) { removed.push(...paths); return { data: paths, error: null }; },
      };
    },
  };
  const load = loader({
    '@/lib/auth/get-current-member': {
      getCurrentMember: async () => active
        ? { success: true, member: { id: 'member-a', business_id: businessId } }
        : { success: false, status: 403, error: 'Workspace access removed.' },
    },
    '@/lib/media/signed-urls': {
      cachedSignedUrls: async (_bucket, paths) => paths.map((path) => ({ path, signedUrl: `https://preview.invalid/${path}` })),
    },
    '@/lib/supabase/admin': { supabaseAdmin: db },
  });
  const route = load('app/api/workspace-storage/files/route.ts');
  const request = (body) => new Request('https://app.tenhchat.com/api/workspace-storage/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { db, removed, route, request };
}

test('list and download never expose another business file', async () => {
  const own = { id: 'own', business_id: 'shop-a', display_name: 'own.pdf', mime_type: 'application/pdf', size_bytes: 3, file_kind: 'file', storage_path: 'shop-a/own.pdf', created_at: '2026-10-02' };
  const foreign = { ...own, id: 'foreign', business_id: 'shop-b', display_name: 'foreign.pdf', storage_path: 'shop-b/foreign.pdf' };
  const { route, request } = routeSetup({ rows: [own, foreign] });
  const list = await (await route.GET()).json();
  assert.deepEqual(Array.from(list.files, (file) => file.id), ['own']);
  assert.equal((await route.POST(request({ action: 'get-file-url', fileId: 'foreign' }))).status, 404);
  const ownDownload = await route.POST(request({ action: 'get-file-url', fileId: 'own' }));
  assert.equal(ownDownload.status, 200);
});

test('revoked membership blocks list, upload preparation, finalize and download', async () => {
  const { route, request } = routeSetup({ active: false });
  assert.equal((await route.GET()).status, 403);
  for (const body of [
    { action: 'prepare-upload', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
    { action: 'finalize-upload', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3, storagePath: 'shop-a/a.pdf' },
    { action: 'get-file-url', fileId: 'a' },
  ]) assert.equal((await route.POST(request(body))).status, 403);
});

test('upload preparation creates only a flat current-business path', async () => {
  const { route, request } = routeSetup();
  const response = await route.POST(request({ action: 'prepare-upload', fileName: '../../price list.pdf', mimeType: 'application/pdf', sizeBytes: 3 }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.match(result.upload.path, /^shop-a\/[0-9a-f-]+-price_list\.pdf$/);
  assert.equal(isWorkspaceFilePathOwned(result.upload.path, 'shop-a'), true);
});

test('finalize rejects forged paths and removes partial uploads with forged size or MIME', async () => {
  const wrongSize = 'shop-a/wrong-size.pdf';
  const wrongMime = 'shop-a/wrong-mime.pdf';
  const { db, removed, route, request } = routeSetup({ stored: {
    [wrongSize]: { size: 4, contentType: 'application/pdf' },
    [wrongMime]: { size: 3, contentType: 'text/plain' },
  } });
  const base = { action: 'finalize-upload', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3 };
  assert.equal((await route.POST(request({ ...base, storagePath: 'shop-b/foreign.pdf' }))).status, 400);
  assert.equal((await route.POST(request({ ...base, storagePath: wrongSize }))).status, 400);
  assert.equal((await route.POST(request({ ...base, storagePath: wrongMime }))).status, 400);
  assert.deepEqual(removed, [wrongSize, wrongMime]);
  assert.equal(db.tables.workspace_files.length, 0);
});

test('verified upload finalizes under the authenticated business', async () => {
  const path = 'shop-a/verified.pdf';
  const { db, route, request } = routeSetup({ stored: { [path]: { size: 3, contentType: 'application/pdf; charset=binary' } } });
  const response = await route.POST(request({ action: 'finalize-upload', fileName: 'verified.pdf', mimeType: 'application/pdf', sizeBytes: 3, storagePath: path }));
  assert.equal(response.status, 200);
  assert.equal(db.tables.workspace_files.length, 1);
  assert.equal(db.tables.workspace_files[0].business_id, 'shop-a');
  assert.equal(db.tables.workspace_files[0].uploaded_by_member_id, 'member-a');
});

test('database finalize failure removes the uploaded object instead of leaving a partial file', async () => {
  const path = 'shop-a/insert-fails.pdf';
  const { db, removed, route, request } = routeSetup({ stored: { [path]: { size: 3, contentType: 'application/pdf' } } });
  db.failures.push({ table: 'workspace_files', op: 'insert', message: 'insert failed' });
  const response = await route.POST(request({ action: 'finalize-upload', fileName: 'insert-fails.pdf', mimeType: 'application/pdf', sizeBytes: 3, storagePath: path }));
  assert.equal(response.status, 500);
  assert.deepEqual(removed, [path]);
  assert.equal(db.tables.workspace_files.length, 0);
});
