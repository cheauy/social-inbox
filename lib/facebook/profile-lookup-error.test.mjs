import test from 'node:test';
import assert from 'node:assert/strict';
import { profileLookupError } from './profile-lookup-error.ts';

test('distinct failures no longer collapse into the same profile-link error', () => {
  const reasons = ['search_unavailable', 'search_interrupted', 'profile_link_unavailable', 'extension_refresh_required', 'extension_timeout', 'profile_resolution_unavailable'];
  assert.equal(new Set(reasons.map(profileLookupError)).size, reasons.length);
});

test('unrecognized error text is not echoed into the customer UI', () => {
  assert.equal(profileLookupError('raw private request text'), profileLookupError('unknown'));
});
