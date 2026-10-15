/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');

function fixture({ deferred = false } = {}) {
  let now = 1_000_000;
  const calls = [];
  class ControlledDate extends Date { static now() { return now; } }
  const load = loader({
    '@/lib/supabase/admin': { supabaseAdmin: { storage: { from(bucket) {
      return { createSignedUrls(paths, seconds) {
        const call = { bucket, paths: Array.from(paths), seconds, sequence: calls.length + 1 };
        calls.push(call);
        const result = () => ({ error: null, data: call.paths.map(path => ({
          path, signedUrl: `https://private.fixture/${encodeURIComponent(path)}?signature=${call.sequence}`,
        })) });
        if (!deferred) return Promise.resolve(result());
        return new Promise((resolve, reject) => {
          call.resolve = () => resolve(result());
          call.reject = reject;
        });
      } };
    } } } },
  }, { Date: ControlledDate });
  return {
    sign: load('lib/media/signed-urls.ts').cachedSignedUrls,
    calls,
    advance(milliseconds) { now += milliseconds; },
  };
}

const urls = result => Array.from(result, entry => entry.signedUrl);

test('authorized same-context requests deduplicate sorted paths, concurrent signing and warm reads', async () => {
  const { sign, calls } = fixture({ deferred: true });
  const scope = 'workspace-a:member-a';
  const first = sign('workspace-files', ['workspace-a/z', 'workspace-a/a', 'workspace-a/a'], 600, scope);
  const concurrent = sign('workspace-files', ['workspace-a/a', 'workspace-a/z'], 600, scope);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].paths, ['workspace-a/a', 'workspace-a/z']);
  calls[0].resolve();
  const [firstResult, concurrentResult] = await Promise.all([first, concurrent]);
  assert.deepEqual(urls(firstResult), urls(concurrentResult));
  assert.deepEqual(Array.from(firstResult, entry => entry.path), ['workspace-a/a', 'workspace-a/z']);
  assert.deepEqual(urls(await sign('workspace-files', ['workspace-a/a', 'workspace-a/z'], 600, scope)), urls(firstResult));
  assert.equal(calls.length, 1);
});

test('another authorized member or workspace never reuses a cached private link', async () => {
  const { sign, calls } = fixture();
  const paths = ['workspace-a/file'];
  const first = await sign('workspace-files', paths, 600, 'workspace-a:member-a');
  const otherMember = await sign('workspace-files', paths, 600, 'workspace-a:member-b');
  const otherWorkspace = await sign('workspace-files', paths, 600, 'workspace-b:member-a');
  assert.equal(calls.length, 3);
  assert.notEqual(first[0].signedUrl, otherMember[0].signedUrl);
  assert.notEqual(first[0].signedUrl, otherWorkspace[0].signedUrl);
  assert.deepEqual(urls(await sign('workspace-files', paths, 600, 'workspace-a:member-a')), urls(first));
  assert.equal(calls.length, 3);
});

test('concurrent different-member signing stays isolated when responses arrive out of order', async () => {
  const { sign, calls } = fixture({ deferred: true });
  const paths = ['workspace-a/file'];
  const first = sign('workspace-files', paths, 600, 'workspace-a:member-a');
  const second = sign('workspace-files', paths, 600, 'workspace-a:member-b');
  assert.equal(calls.length, 2);
  calls[1].resolve();
  const secondResult = await second;
  calls[0].resolve();
  const firstResult = await first;
  assert.notEqual(firstResult[0].signedUrl, secondResult[0].signedUrl);
  assert.deepEqual(urls(await sign('workspace-files', paths, 600, 'workspace-a:member-a')), urls(firstResult));
  assert.deepEqual(urls(await sign('workspace-files', paths, 600, 'workspace-a:member-b')), urls(secondResult));
  assert.equal(calls.length, 2);
});

test('mocked time renews links before their final minute and after expiry instead of returning stale URLs', async () => {
  const { sign, calls, advance } = fixture();
  const paths = ['workspace-a/file'];
  const scope = 'workspace-a:member-a';
  const first = await sign('workspace-files', paths, 120, scope);
  advance(59_000);
  assert.deepEqual(urls(await sign('workspace-files', paths, 120, scope)), urls(first));
  assert.equal(calls.length, 1);
  advance(2_000);
  const nearExpiry = await sign('workspace-files', paths, 120, scope);
  assert.equal(calls.length, 2);
  assert.notEqual(nearExpiry[0].signedUrl, first[0].signedUrl);
  advance(120_001);
  const afterExpiry = await sign('workspace-files', paths, 120, scope);
  assert.equal(calls.length, 3);
  assert.notEqual(afterExpiry[0].signedUrl, nearExpiry[0].signedUrl);
});

test('failed renewal never falls back to an expired private link and a later retry can recover', async () => {
  const { sign, calls, advance } = fixture({ deferred: true });
  const paths = ['workspace-a/file'];
  const scope = 'workspace-a:member-a';
  const initial = sign('workspace-files', paths, 120, scope);
  calls[0].resolve();
  const first = await initial;
  advance(120_001);
  const renewal = sign('workspace-files', paths, 120, scope);
  calls[1].reject(new Error('Signing service unavailable'));
  await assert.rejects(renewal, /Signing service unavailable/);
  const retry = sign('workspace-files', paths, 120, scope);
  assert.equal(calls.length, 3);
  calls[2].resolve();
  assert.notEqual((await retry)[0].signedUrl, first[0].signedUrl);
});

test('existing callers without an authorization scope retain their default cache contract', async () => {
  const { sign, calls } = fixture();
  const first = await sign('message-media', ['message/file'], 600);
  const repeated = await sign('message-media', ['message/file'], 600);
  assert.deepEqual(urls(first), urls(repeated));
  assert.equal(calls.length, 1);
});
