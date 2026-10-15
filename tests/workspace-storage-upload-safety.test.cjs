/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');

function fixture(options = {}) {
  const db = database({ workspace_storage_uploads: [], workspace_files: [], workspace_file_categories: [], workspace_file_favorites: [] });
  const objects = new Map(), storageCalls = [];
  let committed = 0, queue = Promise.resolve();
  db.storage = { from: bucket => ({
    createSignedUploadUrl: async (path, config) => { storageCalls.push(['prepare', path, config]); return { data: { token: 'signed' }, error: null }; },
    info: async path => { storageCalls.push(['info', path]); return options.infoError ? { data: null, error: options.infoError } : objects.has(path) ? { data: objects.get(path), error: null } : { data: null, error: { status: 404 } }; },
    remove: async paths => { storageCalls.push(['remove', ...paths]); paths.forEach(path => objects.delete(path)); return { data: [], error: options.removeError ?? null }; },
    createSignedUrls: async (paths, seconds) => { storageCalls.push(['sign', bucket, paths, seconds]); return { data: paths.map(path => ({ path, signedUrl: `https://private.invalid/${path}?token=fresh` })), error: null }; },
  }) };
  db.rpc = (name, args) => {
    assert.equal(name, 'finalize_workspace_storage_upload');
    const result = queue.then(() => {
      if (options.rpcError) return { data: null, error: { message: 'insert unavailable' } };
      const attempt = db.tables.workspace_storage_uploads.find(row => row.id === args.p_upload_id && row.business_id === args.p_business_id && row.member_id === args.p_member_id);
      if (attempt.category_id && !db.tables.workspace_file_categories.some(row => row.id === attempt.category_id && row.business_id === attempt.business_id)) return { data: null, error: { code: '22023', message: 'category removed' } };
      if (attempt.state === 'finalized') return { data: structuredClone(db.tables.workspace_files.find(row => row.id === attempt.id)), error: null };
      const row = { ...attempt, storage_bucket: 'tenh-workspace-files', uploaded_by_member_id: attempt.member_id, created_at: new Date().toISOString(), deleted_at: null };
      db.tables.workspace_files.push(row); attempt.state = 'finalized'; committed++;
      return { data: structuredClone(row), error: null };
    });
    queue = result.then(() => {});
    return result;
  };
  const load = loader({
    '@/lib/storage/workspace-storage-access': { getWorkspaceStorageAccess: async () => options.denied ? { success: false, error: 'Revoked membership', status: 403 } : { success: true, member: { id: options.memberId ?? 'member-a', business_id: options.businessId ?? 'shop-a' } } },
    '@/lib/auth/require-permission': { memberHasPermission: async () => options.canManage !== false },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/media/signed-urls': { cachedSignedUrls: async (_bucket, paths) => paths.map(path => ({ path, signedUrl: `https://private.invalid/${path}` })) },
  });
  const route = load('app/api/workspace-storage/files/route.ts');
  const post = async body => { const response = await route.POST(new Request('https://app.tenhchat.com/api/workspace-storage/files', { method: 'POST', body: JSON.stringify(body) })); return { status: response.status, ...await response.json() }; };
  const get = async () => { const response = await route.GET(new Request('https://app.tenhchat.com/api/workspace-storage/files')); return { status: response.status, ...await response.json() }; };
  const metadata = { fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 3 };
  const prepare = async extra => { const response = await post({ action: 'prepare-upload', ...metadata, ...extra }); assert.equal(response.status, 200); return response.upload; };
  const finalize = (upload, extra = {}) => post({ action: 'finalize-upload', ...metadata, uploadId: upload.uploadId, storagePath: upload.path, ...extra });
  return { db, objects, storageCalls, post, get, prepare, finalize, metadata, committed: () => committed };
}

test('Agent, revoked, forged and registered-object finalization never touches Storage', async () => {
  for (const options of [{ canManage: false }, { denied: true }]) {
    const f = fixture(options); const result = await f.post({ action: 'finalize-upload', ...f.metadata, storagePath: 'shop-a/existing.jpg' });
    assert.equal(result.status, 403); assert.deepEqual(f.storageCalls, []); assert.deepEqual(f.db.history, []);
  }
  const f = fixture();
  f.db.tables.workspace_files.push({ id: 'registered', storage_path: 'shop-a/existing.jpg' });
  for (const body of [{ uploadId: 'forged', storagePath: 'shop-a/existing.jpg' }, { storagePath: 'shop-a/existing.jpg' }, { storagePath: 'shop-b/other.jpg' }]) {
    assert.ok((await f.post({ action: 'finalize-upload', ...f.metadata, ...body })).status >= 400);
  }
  assert.deepEqual(f.storageCalls, []); assert.equal(f.db.tables.workspace_files.length, 1);
});

test('prepared finalization binds member, path, metadata and category without cleanup', async () => {
  const f = fixture(); const upload = await f.prepare(); f.objects.set(upload.path, { contentType: 'image/jpeg', size: 3 });
  for (const changes of [{ storagePath: 'shop-a/other.jpg' }, { fileName: 'different.jpg' }, { sizeBytes: 4 }, { categoryId: 'forged-category' }]) assert.equal((await f.finalize(upload, changes)).status, 400);
  f.db.tables.workspace_storage_uploads[0].member_id = 'another-member';
  assert.equal((await f.finalize(upload)).status, 404);
  assert.ok(f.objects.has(upload.path)); assert.equal(f.storageCalls.filter(call => call[0] === 'remove').length, 0);
});

test('duplicate, legacy-path and concurrent finalization return one committed file', async () => {
  const f = fixture(); const upload = await f.prepare(); f.objects.set(upload.path, { contentType: 'image/jpeg', size: 3 });
  const results = await Promise.all([f.finalize(upload), f.finalize(upload)]);
  results.forEach(result => { assert.equal(result.status, 200); assert.equal(result.clientFile.id, upload.uploadId); assert.equal(result.memberId, 'member-a'); });
  const infoCount = f.storageCalls.filter(call => call[0] === 'info').length;
  assert.equal((await f.post({ action: 'finalize-upload', ...f.metadata, storagePath: upload.path })).status, 200);
  assert.equal(f.storageCalls.filter(call => call[0] === 'info').length, infoCount);
  assert.equal(f.committed(), 1); assert.equal(f.db.tables.workspace_files.length, 1); assert.ok(f.objects.has(upload.path));
  f.db.tables.workspace_file_favorites.push({ member_id: 'member-a', file_id: upload.uploadId });
  assert.equal((await f.finalize(upload)).clientFile.favorite, true, 'retry preserves an independently completed Favorite');
});

test('interrupted upload retries the same prepared path and reconciles a lost response', async () => {
  const f = fixture(); const upload = await f.prepare();
  assert.equal((await f.finalize(upload)).code, 'UPLOAD_INCOMPLETE');
  const reopened = await f.get(); assert.deepEqual(reopened.pendingUploads.map(row => row.uploadId), [upload.uploadId]);
  assert.equal(reopened.pendingUploads[0].storagePath, upload.path);
  const retried = await f.prepare({ uploadId: upload.uploadId }); assert.equal(retried.path, upload.path); assert.equal(f.db.tables.workspace_storage_uploads.length, 1);
  f.objects.set(upload.path, { contentType: 'image/jpeg', size: 3 });
  await f.finalize(upload); // The caller may lose this response after the commit.
  assert.equal((await f.finalize(upload)).clientFile.id, upload.uploadId); assert.equal(f.committed(), 1);
  const pending = await f.prepare(); f.db.tables.workspace_storage_uploads.find(row => row.id === pending.uploadId).expires_at = '2000-01-01T00:00:00Z';
  assert.equal((await f.finalize(pending)).status, 410); assert.equal(f.storageCalls.filter(call => call[0] === 'remove').length, 0);
  assert.deepEqual((await f.get()).pendingUploads, []);
});

test('malformed metadata and action bodies fail validation before issuing capabilities', async () => {
  const f = fixture();
  for (const body of [null, [], { action: 'prepare-upload', fileName: {}, mimeType: [] },
    { action: 'prepare-upload', ...f.metadata, sizeBytes: 1.5 },
    { action: 'prepare-upload', ...f.metadata, categoryId: {} }]) assert.equal((await f.post(body)).status, 400);
  assert.deepEqual(f.storageCalls, []); assert.equal(f.db.tables.workspace_storage_uploads.length, 0);
});

test('oversized paged selections are rejected instead of silently truncating successful mutations', async () => {
  const f = fixture();
  const fileIds = Array.from({ length: 201 }, (_, index) => `local-${index}`);
  for (const action of ['set-category', 'delete-files']) {
    assert.equal((await f.post({ action, fileIds })).status, 400);
  }
  assert.deepEqual(f.storageCalls, []);
  assert.equal(f.db.history.some(entry => entry.op !== 'read'), false);
});

test('metadata mismatch, removed category, insert failure and network ambiguity retain objects', async () => {
  for (const options of [{ rpcError: true }, { infoError: { status: 503 } }, {}]) {
    const f = fixture(options); const upload = await f.prepare(); f.objects.set(upload.path, { contentType: 'image/jpeg', size: options.rpcError || options.infoError ? 3 : 99 });
    const result = await f.finalize(upload); assert.ok(result.status >= 400); assert.ok(f.objects.has(upload.path)); assert.equal(f.storageCalls.filter(call => call[0] === 'remove').length, 0);
  }
  const f = fixture(); f.db.tables.workspace_file_categories.push({ id: 'category', business_id: 'shop-a' });
  const upload = await f.prepare({ categoryId: 'category' }); f.objects.set(upload.path, { contentType: 'image/jpeg', size: 3 }); f.db.tables.workspace_file_categories.length = 0;
  assert.equal((await f.finalize(upload, { categoryId: 'category' })).code, 'UPLOAD_REJECTED'); assert.ok(f.objects.has(upload.path));
});

test('object removal followed by metadata failure survives reopening and retries idempotently', async () => {
  const f = fixture(); const upload = await f.prepare(); f.objects.set(upload.path, { contentType: 'image/jpeg', size: 3 }); await f.finalize(upload);
  f.db.failures.push({ table: 'workspace_files', op: 'delete', once: true });
  const deleted = await f.post({ action: 'delete-files', fileIds: [upload.uploadId] });
  assert.equal(deleted.status, 207); assert.deepEqual(deleted.pendingIds, [upload.uploadId]); assert.deepEqual(deleted.failedIds, []); assert.equal(f.objects.has(upload.path), false);
  const reopened = await f.get(); assert.deepEqual(reopened.files, []); assert.deepEqual(reopened.pendingDeletions.map(row => row.id), [upload.uploadId]);
  assert.deepEqual((await f.post({ action: 'delete-files', fileIds: [upload.uploadId] })).deletedIds, [upload.uploadId]);
  assert.deepEqual((await f.get()).pendingDeletions, []); assert.equal(f.db.tables.workspace_files.length, 0);
});

test('ambiguous object removal stays hidden and durable; preview signing excludes deleted/foreign files', async () => {
  const f = fixture({ removeError: { status: 503 }, infoError: { status: 503 } });
  f.db.tables.workspace_files.push({ id: 'pending', business_id: 'shop-a', storage_bucket: 'tenh-workspace-files', storage_path: 'shop-a/pending.jpg', display_name: 'pending', deleted_at: null });
  assert.deepEqual((await f.post({ action: 'delete-files', fileIds: ['pending'] })).pendingIds, ['pending']);
  assert.ok(f.db.tables.workspace_files[0].deleted_at); assert.deepEqual((await f.get()).files, []);
  f.db.tables.workspace_files.push({ id: 'active', business_id: 'shop-a', storage_bucket: 'tenh-workspace-files', storage_path: 'shop-a/active.jpg', deleted_at: null }, { id: 'foreign', business_id: 'shop-b', storage_bucket: 'tenh-workspace-files', storage_path: 'shop-b/private.jpg', deleted_at: null });
  const renewed = await f.post({ action: 'refresh-previews', fileIds: ['active', 'active', 'pending', 'foreign'] });
  assert.equal(renewed.previews.length, 1); assert.equal(renewed.previews[0].id, 'active'); assert.ok(renewed.previews[0].previewExpiresAt > Date.now()); assert.deepEqual(renewed.unavailableIds, ['pending', 'foreign']);
  const signed = f.storageCalls.find(call => call[0] === 'sign'); assert.deepEqual(signed[2], ['shop-a/active.jpg']); assert.equal(signed[3], 600);
  const denied = fixture({ denied: true }); assert.equal((await denied.post({ action: 'refresh-previews', fileIds: ['active'] })).status, 403); assert.deepEqual(denied.storageCalls, []);
});
