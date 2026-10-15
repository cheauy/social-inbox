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

test('independent overlapping mutations both commit in either response order', async () => {
  for (const reverse of [false, true]) {
    const key = cache.workspaceStorageCacheKey(`shop-${reverse}`, 'member-a');
    await cache.refreshWorkspaceStorageCache(key, async () => snapshot(['one', 'two']));
    const operations = ['one', 'two'].map(id => ({ id, owner: cache.beginWorkspaceStorageMutation(key) }));
    if (reverse) operations.reverse();
    for (const { id, owner } of operations) {
      assert.equal(cache.commitWorkspaceStorageMutation(key, owner, current => ({
        ...current, files: current.files.map(file => file.id === id ? { ...file, favorite: true } : file),
      })), true);
    }
    assert.ok(cache.readWorkspaceStorageCache(key).files.every(file => file.favorite));
    assert.equal(cache.commitWorkspaceStorageMutation(key, operations[0].owner, () => snapshot([])), false);
  }
});

test('a failed independent operation does not roll back a successful cache commit', async () => {
  const key = cache.workspaceStorageCacheKey('shop-a', 'member-a');
  await cache.refreshWorkspaceStorageCache(key, async () => snapshot(['one', 'two']));
  const success = cache.beginWorkspaceStorageMutation(key);
  cache.beginWorkspaceStorageMutation(key);
  assert.equal(cache.commitWorkspaceStorageMutation(key, success, current => ({
    ...current, files: current.files.filter(file => file.id !== 'one'),
  })), true);
  assert.deepEqual(Array.from(cache.readWorkspaceStorageCache(key).files, file => file.id), ['two']);
});

test('drop, logout and member changes reject late reads and mutation commits', async () => {
  for (const invalidate of [
    key => cache.dropWorkspaceStorageCache(key),
    () => cache.clearWorkspaceStorageCache(),
    () => cache.workspaceStorageCacheKey('shop-a', 'member-b'),
  ]) {
    const key = cache.workspaceStorageCacheKey('shop-a', 'member-a');
    await cache.refreshWorkspaceStorageCache(key, async () => snapshot(['private']));
    const owner = cache.beginWorkspaceStorageMutation(key);
    let resolve;
    const late = cache.refreshWorkspaceStorageCache(key, () => new Promise(done => { resolve = done; }));
    invalidate(key);
    resolve(snapshot(['private']));
    assert.equal((await late).current, false);
    assert.equal(cache.commitWorkspaceStorageMutation(key, owner, () => snapshot(['private'])), false);
    assert.equal(cache.readWorkspaceStorageCache(key), null);
  }
});

test('mutation handles cannot commit into another workspace or survive renewed access', async () => {
  const key = cache.workspaceStorageCacheKey('shop-a', 'member-a');
  const otherKey = cache.workspaceStorageCacheKey('shop-b', 'member-a');
  await cache.refreshWorkspaceStorageCache(key, async () => snapshot(['old']));
  await cache.refreshWorkspaceStorageCache(otherKey, async () => snapshot(['other']));
  const old = cache.beginWorkspaceStorageMutation(key);
  cache.beginWorkspaceStorageMutation(otherKey);
  assert.equal(cache.commitWorkspaceStorageMutation(otherKey, old, () => snapshot([])), false);
  cache.dropWorkspaceStorageCache(key);
  await cache.refreshWorkspaceStorageCache(key, async () => snapshot(['renewed']));
  cache.beginWorkspaceStorageMutation(key);
  assert.equal(cache.commitWorkspaceStorageMutation(key, old, () => snapshot(['old'])), false);
  assert.deepEqual(Array.from(cache.readWorkspaceStorageCache(key).files, file => file.id), ['renewed']);
});

test('logout or a member change cannot reset a cold read generation and resurrect private files', async () => {
  for (const invalidate of [
    () => cache.clearWorkspaceStorageCache(),
    () => cache.workspaceStorageCacheKey('shop-a', 'member-b'),
  ]) {
    const key = cache.workspaceStorageCacheKey('shop-a', 'member-a');
    let resolve;
    const late = cache.refreshWorkspaceStorageCache(key, () => new Promise(done => { resolve = done; }));
    invalidate();
    resolve(snapshot(['private']));
    assert.equal((await late).current, false);
    assert.equal(cache.readWorkspaceStorageCache(key), null);
  }
});

const file = (id, overrides = {}) => ({
  id, name: `${id}.png`, mimeType: 'image/png', sizeBytes: 20, kind: 'image',
  createdAt: '2026-10-15T00:00:00.000Z', categoryId: null, favorite: false,
  contentVersion: `version-${id}`, previewUrl: `https://preview/${id}`, previewExpiresAt: 20_000,
  ...overrides,
});

test('file merge preserves unchanged identity and valid signed previews but prunes deleted records', () => {
  const first = file('one');
  const deleted = file('deleted');
  const refreshed = file('one', { previewUrl: 'https://preview/re-signed', previewExpiresAt: 30_000 });
  const merged = cache.mergeWorkspaceStorageFiles([first, deleted], [refreshed], false, 10_000);
  assert.equal(merged.length, 1);
  assert.equal(merged[0], first);
});

test('file merge replaces changed content and expired URLs without preserving stale identities', () => {
  const previous = file('one');
  const changed = file('one', { contentVersion: 'replaced', previewUrl: 'https://preview/replaced' });
  assert.equal(cache.mergeWorkspaceStorageFiles([previous], [changed], false, 10_000)[0], changed);
  const renewed = file('one', { previewUrl: 'https://preview/renewed', previewExpiresAt: 40_000 });
  assert.equal(cache.mergeWorkspaceStorageFiles([previous], [renewed], false, 21_000)[0], renewed);
  const noVersion = file('one', { contentVersion: undefined });
  assert.equal(cache.mergeWorkspaceStorageFiles([noVersion], [renewed], false, 10_000)[0], renewed);
  const signingOutage = file('one', { previewUrl: null, previewExpiresAt: undefined });
  assert.equal(cache.mergeWorkspaceStorageFiles([previous], [signingOutage], false, 10_000)[0].previewUrl, previous.previewUrl);
  assert.equal(cache.mergeWorkspaceStorageFiles([previous], [], false, 10_000).length, 0);
  const favorite = file('one', { favorite: true, previewUrl: 'https://preview/new-signature' });
  const merged = cache.mergeWorkspaceStorageFiles([previous], [favorite], false, 10_000)[0];
  assert.equal(merged.favorite, true);
  assert.equal(merged.previewUrl, previous.previewUrl);
  assert.notEqual(merged, previous);
});

test('appended pages deduplicate stable IDs and sort by timestamp with descending ID tie-breaker', () => {
  const first = file('b');
  const other = file('a');
  const newest = file('c', { createdAt: '2026-10-16T00:00:00.000Z' });
  const merged = cache.mergeWorkspaceStorageFiles([first, other], [file('b'), newest, file('a')], true, 10_000);
  assert.deepEqual(Array.from(merged, item => item.id), ['c', 'b', 'a']);
  assert.equal(merged[1], first);
  assert.equal(merged[2], other);
});
