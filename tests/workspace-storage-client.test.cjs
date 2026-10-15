/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');

const identity = { businessId: 'workspace-a', memberId: 'member-a' };
const upload = { uploadId: 'attempt-a', bucket: 'workspace-files', path: 'workspace-a/attempt-a.pdf', token: 'mock-token' };
const record = { id: 'file-a', name: 'a.pdf' };
const attempt = id => ({ id, file: { name: `${id}.pdf`, type: ' APPLICATION/PDF ', size: 3 }, categoryId: null, state: 'waiting' });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const client = fetcher => loader({}, { fetch: fetcher, DOMException, AbortController })('lib/storage/workspace-storage-client.ts');

test('every Storage read and mutation pins workspace and member using the supported headers', async () => {
  const calls = [];
  const api = client(async (url, init) => { calls.push({ url, init }); return Response.json({ success: true, ...identity }); });
  const controller = new AbortController();
  await api.workspaceStorageRequest(identity, undefined, controller.signal, new URLSearchParams({ limit: '30', view: 'favorites' }));
  await api.workspaceStorageRequest(identity, { action: 'toggle-favorite', fileId: 'a', favorite: true }, controller.signal);
  await api.workspaceStorageRequest(identity, { action: 'create', name: 'Category' }, controller.signal, undefined, true);
  assert.equal(calls[0].url, '/api/workspace-storage/files?limit=30&view=favorites');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[2].url, '/api/workspace-storage/categories');
  assert.deepEqual(JSON.parse(calls[1].init.body), { action: 'toggle-favorite', fileId: 'a', favorite: true });
  for (const { init } of calls) {
    assert.equal(init.headers['x-tenh-business-id'], identity.businessId);
    assert.equal(init.headers['x-tenh-member-id'], identity.memberId);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.signal, controller.signal);
  }
});

test('successful and partial responses reject mismatched workspace/member before exposing private records', async () => {
  for (const status of [200, 207]) for (const returned of [
    { ...identity, businessId: 'workspace-b' },
    { ...identity, memberId: 'member-b' },
    {},
  ]) {
    const api = client(async () => Response.json({ success: true, files: [record], ...returned }, { status }));
    await assert.rejects(api.workspaceStorageRequest(identity), error => error.status === 403 && /workspace or membership changed/.test(error.message));
  }
});

test('late workspace A/B responses remain bound to their initiating identity', async () => {
  const lateA = deferred(), earlyB = deferred();
  const api = client((_url, init) => init.headers['x-tenh-business-id'] === 'workspace-a' ? lateA.promise : earlyB.promise);
  const identityB = { businessId: 'workspace-b', memberId: 'member-b' };
  const a = api.workspaceStorageRequest(identity), b = api.workspaceStorageRequest(identityB);
  earlyB.resolve(Response.json({ success: true, ...identityB, files: [{ id: 'b' }] }));
  assert.equal((await b).files[0].id, 'b');
  lateA.resolve(Response.json({ success: true, ...identityB, files: [{ id: 'private-b' }] }));
  await assert.rejects(a, error => error.status === 403);
});

test('an aborted request cannot accept a late response even when fetch ignores cancellation', async () => {
  const response = deferred(), controller = new AbortController();
  const api = client(() => response.promise);
  const pending = api.workspaceStorageRequest(identity, undefined, controller.signal);
  controller.abort();
  response.resolve(Response.json({ success: true, ...identity, files: [record] }));
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('authorized 207 deletion responses preserve durable pending-cleanup state', async () => {
  const result = { success: false, ...identity, deletedIds: ['deleted'], pendingIds: ['pending'], failedIds: [], pendingDeletions: [{ id: 'pending', name: 'p.pdf' }] };
  const api = client(async () => Response.json(result, { status: 207 }));
  assert.deepEqual(plain(await api.workspaceStorageRequest(identity, { action: 'delete-files', fileIds: ['deleted', 'pending'] })), result);
});

test('a lost successful finalization response retries only the same finalization without a second object or transfer', async () => {
  const api = client();
  const item = attempt('a'), actions = []; let lost = true, committed = false;
  const request = async body => {
    actions.push(body);
    if (body.action === 'prepare-upload') return { upload };
    assert.equal(body.uploadId, upload.uploadId); assert.equal(body.storagePath, upload.path);
    committed = true;
    if (lost) { lost = false; throw new Error('Network response lost'); }
    return { success: true, clientFile: record };
  };
  let transfers = 0;
  const bytes = async () => { transfers++; };
  await assert.rejects(api.runStorageUpload(item, request, bytes), /Network response lost/);
  assert.equal(committed, true);
  assert.equal((await api.runStorageUpload(item, request, bytes)).clientFile.id, record.id);
  assert.deepEqual(actions.map(body => body.action), ['prepare-upload', 'finalize-upload', 'finalize-upload']);
  assert.equal(transfers, 1);
  assert.equal(actions[0].mimeType, 'application/pdf');
});

test('an incomplete retry reconciles first and reuses its upload identifier and object path', async () => {
  const api = client();
  const item = { ...attempt('a'), upload }, actions = []; let incomplete = true;
  const request = async body => {
    actions.push(body);
    if (body.action === 'finalize-upload' && incomplete) {
      incomplete = false; throw new api.StorageApiError('Missing object', 409, 'UPLOAD_INCOMPLETE');
    }
    if (body.action === 'prepare-upload') { assert.equal(body.uploadId, upload.uploadId); return { upload }; }
    return { success: true, clientFile: record };
  };
  const transferred = [];
  await api.runStorageUpload(item, request, async capability => transferred.push(capability.path));
  assert.deepEqual(actions.map(body => body.action), ['finalize-upload', 'prepare-upload', 'finalize-upload']);
  assert.deepEqual(transferred, [upload.path]);
  for (const body of actions.filter(body => body.action === 'finalize-upload')) {
    assert.equal(body.uploadId, upload.uploadId); assert.equal(body.storagePath, upload.path);
  }
});

test('non-incomplete finalization failures never silently prepare or upload another object', async () => {
  const api = client();
  for (const failure of [new Error('Offline'), new api.StorageApiError('No access', 403), new api.StorageApiError('Bad category', 400)]) {
    const actions = [];
    await assert.rejects(api.runStorageUpload({ ...attempt('a'), upload }, async body => { actions.push(body.action); throw failure; }, async () => assert.fail('Unexpected transfer')));
    assert.deepEqual(actions, ['finalize-upload']);
  }
});

test('mixed uploads reconcile and retry only the failed attempt while retaining each result independently', async () => {
  const api = client(), items = [attempt('good'), attempt('bad')], actions = [], transfers = [];
  const stored = new Set(); let interrupted = true;
  const request = async body => {
    actions.push({ name: body.fileName, action: body.action });
    const name = body.fileName.replace('.pdf', '');
    if (body.action === 'prepare-upload') return { upload: { ...upload, uploadId: name, path: `workspace-a/${name}.pdf` } };
    if (!stored.has(name)) throw new api.StorageApiError('Interrupted upload', 409, 'UPLOAD_INCOMPLETE');
    return { success: true, clientFile: { id: name } };
  };
  const bytes = async (_capability, file) => {
    const name = file.name.replace('.pdf', ''); transfers.push(name);
    if (name === 'bad' && interrupted) { interrupted = false; throw new Error('Connection interrupted for bad.pdf'); }
    stored.add(name);
  };
  const results = await Promise.allSettled(items.map(item => api.runStorageUpload(item, request, bytes)));
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[0].value.clientFile.id, 'good');
  assert.equal(results[1].status, 'rejected'); assert.match(results[1].reason.message, /bad.pdf/);
  const goodActions = actions.filter(action => action.name === 'good.pdf').length;
  const retried = await api.runStorageUpload(items[1], request, bytes);
  assert.equal(retried.clientFile.id, 'bad');
  assert.equal(actions.filter(action => action.name === 'good.pdf').length, goodActions);
  assert.deepEqual(transfers, ['good', 'bad', 'bad']);
  assert.equal(items[1].upload.uploadId, 'bad');
});
