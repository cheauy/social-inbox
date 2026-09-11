import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitCompanionAnswer } from './companion-response.ts';

class BrowserWindow extends EventTarget {
  location = { origin: 'https://app.tenhchat.com' };
  timers = new Set();
  setTimeout(callback, ms) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, ms);
    this.timers.add(timer);
    return timer;
  }
  clearTimeout(timer) { clearTimeout(timer); this.timers.delete(timer); }
  emit(data, source = this, origin = this.location.origin) {
    const event = new Event('message');
    Object.assign(event, { data, source, origin });
    this.dispatchEvent(event);
  }
}

const envelope = { source: 'TENH_EXTENSION', type: 'OPEN_FACEBOOK_PROFILE_RESULT', requestId: 'request-1' };
test('extension errors settle immediately instead of waiting for a timeout', async () => {
  const host = new BrowserWindow();
  const pending = awaitCompanionAnswer(envelope.type, envelope.requestId, 5000, host);
  host.emit({ ...envelope, error: 'extension_unavailable' });
  assert.equal(host.timers.size, 0);
  const result = await pending;
  assert.equal(result.reason, 'extension_request_failed');
  assert.equal(result.resolved, false);
});

test('an invalidated extension returns the refresh diagnosis', async () => {
  const host = new BrowserWindow();
  const pending = awaitCompanionAnswer(envelope.type, envelope.requestId, 5000, host);
  host.emit({ ...envelope, error: 'extension_unavailable', requiresRefresh: true });
  assert.equal((await pending).reason, 'extension_refresh_required');
  assert.equal(host.timers.size, 0);
});

test('ignores wrong origins, windows, request IDs and message types', async () => {
  const host = new BrowserWindow();
  const pending = awaitCompanionAnswer(envelope.type, envelope.requestId, 5000, host);
  host.emit(envelope, {}, host.location.origin);
  host.emit(envelope, host, 'https://example.com');
  host.emit({ ...envelope, requestId: 'different' });
  host.emit({ ...envelope, type: 'TENH_EXTENSION_PONG' });
  assert.equal(host.timers.size, 1);
  host.emit({ ...envelope, reason: 'search_unavailable' });
  assert.equal((await pending).reason, 'search_unavailable');
  assert.equal(host.timers.size, 0);
});

test('a missing response times out and cleans up', async () => {
  const host = new BrowserWindow();
  assert.equal(await awaitCompanionAnswer(envelope.type, envelope.requestId, 10, host), null);
  assert.equal(host.timers.size, 0);
});
