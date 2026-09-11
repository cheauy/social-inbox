import test from 'node:test';
import assert from 'node:assert/strict';
import { getFacebookCustomerProfileUrl, normalizeFacebookProfileUrl } from './customer-profile-url.ts';

test('opens the supplied public ID while preserving the different messaging ID', () => {
  const contact = { platform_user_id: '27032083679825383', facebook_profile_id: '61555135812581' };
  assert.equal(getFacebookCustomerProfileUrl(contact), 'https://www.facebook.com/profile.php?id=61555135812581');
  assert.equal(contact.platform_user_id, '27032083679825383');
});

test('accepts actual Facebook profile links and usernames, never Suite or redirect links', () => {
  assert.equal(normalizeFacebookProfileUrl('https://www.facebook.com/da.makav.714?tracking=1'), 'https://www.facebook.com/da.makav.714');
  assert.equal(normalizeFacebookProfileUrl('https://www.facebook.com/people/Uy-Chea/61555135812581/'), 'https://www.facebook.com/profile.php?id=61555135812581');
  for (const url of ['https://business.facebook.com/latest/inbox/all/', 'https://facebook.com.evil.example/person', 'https://www.facebook.com/l.php?u=https://example.com', 'https://www.facebook.com/login', 'https://www.facebook.com/profile.php?id=123&id=456', 'https://user:pass@www.facebook.com/person', 'javascript:alert(1)']) {
    assert.equal(normalizeFacebookProfileUrl(url), null, url);
  }
});

test('never guesses a public profile from a Messenger ID', () => {
  for (const contact of [null, undefined, {}, { platform_user_id: '27032083679825383' }, { platform_user_id: '27032083679825383', facebook_profile_id: null }]) {
    assert.equal(getFacebookCustomerProfileUrl(contact), null);
  }
});

test('rejects malformed public IDs and accepts only the Facebook profile route', () => {
  for (const value of ['', ' ', 'https://business.facebook.com/', '123&redirect=example.com', 'not-a-number', '1'.repeat(31)]) {
    assert.equal(getFacebookCustomerProfileUrl({ facebook_profile_id: value }), null);
  }
  assert.equal(getFacebookCustomerProfileUrl({ facebook_profile_id: ' 61555135812581 ' }), 'https://www.facebook.com/profile.php?id=61555135812581');
});
