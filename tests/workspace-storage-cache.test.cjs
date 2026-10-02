/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');

const cache = loader({}, { AbortController })('lib/storage/workspace-storage-cache.ts');
const snapshot = (ids) => ({
  files: ids.map(id => ({ id })), categories: [], canManage: true, organizationAvailable: true,
});

test.beforeEach(() => cache.clearWorkspaceStorageCache());

test('cold load deduplicates, then warm data is immediately readable until TTL expiry', async () => {
  const key = cache.workspaceStorageCacheKey('shop-a', 'member-a');
  let calls = 0;
  let resolve;
  const fetcher = () => { calls += 1; return new Promise(done => { resolve = done; }); };
  assert.equal(cache.readWorkspaceStorageCache(key), null);
  const first = cache.refreshWorkspaceStorageCache(key, fetcher);
  const duplicate = cache.refreshWorkspaceStorageCache(key, fetcher);
  assert.equal(calls, 1);
  resolve(snapshot(['one']));
  await Promise.all([first, duplicate]);
  assert.deepEqual(Array.from(cache.readWorkspaceStorageCache(key).files, file => file.id), ['one']);
  assert.equal(cache.readWorkspaceStorageCache(key, Date.now() + cache.WORKSPACE_STORAGE_CACHE_TTL_MS + 1), null);
});

test('workspace entries are member-scoped, bounded, and cleared on member/logout change', async () => {
  const keys = [];
  for (let index = 0; index < 5; index += 1) {
    const key = cache.workspaceStorageCacheKey(`shop-${index}`, 'member-a');
    keys.push(key);
    await cache.refreshWorkspaceStorageCache(key, async () => snapshot([String(index)]));
  }
  assert.equal(cache.readWorkspaceStorageCache(keys[0]), null);
  assert.ok(cache.readWorkspaceStorageCache(keys[4]));
  cache.workspaceStorageCacheKey('shop-4', 'member-b');
  assert.equal(cache.readWorkspaceStorageCache(keys[4]), null);
  cache.clearWorkspaceStorageCache();
  assert.equal(cache.readWorkspaceStorageCache(cache.workspaceStorageCacheKey('shop-4', 'member-b')), null);
});

test('mutation generation blocks a late refresh from resurrecting deleted files', async () => {
  const key = cache.workspaceStorageCacheKey('shop-a', 'member-a');
  await cache.refreshWorkspaceStorageCache(key, async () => snapshot(['keep', 'delete']));
  let resolve;
  const stale = cache.refreshWorkspaceStorageCache(key, () => new Promise(done => { resolve = done; }));
  const owner = cache.beginWorkspaceStorageMutation(key);
  cache.commitWorkspaceStorageMutation(key, owner, current => ({
    ...current, files: current.files.filter(file => file.id !== 'delete'),
  }));
  resolve(snapshot(['keep', 'delete']));
  assert.equal((await stale).current, false);
  assert.deepEqual(Array.from(cache.readWorkspaceStorageCache(key).files, file => file.id), ['keep']);
});

test('failed refresh preserves warm data and access invalidation drops it', async () => {
  const key = cache.workspaceStorageCacheKey('shop-a', 'member-a');
  await cache.refreshWorkspaceStorageCache(key, async () => snapshot(['safe']));
  await assert.rejects(cache.refreshWorkspaceStorageCache(key, async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(Array.from(cache.readWorkspaceStorageCache(key).files, file => file.id), ['safe']);
  cache.dropWorkspaceStorageCache(key);
  assert.equal(cache.readWorkspaceStorageCache(key), null);
});
