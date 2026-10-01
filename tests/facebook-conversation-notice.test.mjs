import test from 'node:test';
import assert from 'node:assert/strict';
import { loader, hooks } from './inbox-recovery-harness.cjs';
const { facebookConversationNavigationError: notice } = loader()('lib/facebook/conversation-navigation-error.ts');

for (const [reason, expected] of [
  ['page_reconnection_required', /needs to be reconnected/],
  ['profile_conversation_access_unavailable', /denied access/],
  ['profile_conversation_not_found', /did not return a Messenger conversation/],
  ['profile_conversation_participants_unmatched', /did not match this Page and customer/],
  ['profile_conversation_ambiguous', /ambiguous conversation/],
  ['facebook_direct_link_required', /did not provide a verified Business Suite link/],
  ['profile_conversation_link_unavailable', /did not return usable conversation information/],
  ['profile_conversation_request_failed', /could not complete/],
  ['profile_conversation_lookup_failed', /could not complete/],
]) test('safe notice for ' + reason, () => assert.match(notice(reason), expected));

test('unknown, inherited and non-string reasons cannot become displayed text', () => {
  for (const reason of ['RAW_PROVIDER_SECRET', '__proto__', 'constructor', 'toString', null, { error: 'RAW_PROVIDER_SECRET' }]) {
    assert.equal(notice(reason), notice(undefined));
  }
  assert.match(notice(undefined, 401), /Sign in/);
  assert.match(notice(undefined, 403), /do not have access/);
  assert.match(notice(undefined, 409), /changed/);
  assert.match(notice(undefined, 424), /Facebook access/);
  assert.match(notice(undefined, 503), /TENH could not check/);
});

const context = { businessId: 'b1', conversationId: 'c1', pageId: '12345', threadId: '98765', navigationOnly: true };
const inbox = 'https://business.facebook.com/latest/inbox/all?asset_id=12345';
const exact = inbox + '&selected_item_id=54321&thread_type=FB_MESSAGE';
function action(body, status = 200) {
  const h = hooks(), popups = [], calls = [];
  h.React.createContext = () => ({ Provider: 'provider' });
  const load = loader({ react: h.React, 'react/jsx-runtime': h.jsx, 'lucide-react': { ExternalLink: 'icon' }, '@/lib/extension/use-companion': { useCompanion: () => ({ verifiedConversationNavigation: false }) } }, {
    AbortController, URLSearchParams,
    window: { open: () => {
      const popup = { closed: false, location: { href: 'about:blank', replace(url) { this.href = url; } },
        document: { createElement: () => ({ style: {} }), body: { appendChild() {} } }, close() { this.closed = true; } };
      popups.push(popup); return popup;
    } },
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(body), { status }); },
  });
  const Provider = load('components/inbox/companion-facebook-action.tsx').FacebookConversationActionProvider;
  const render = (props = context) => h.render(Provider, props).props.value;
  render();
  return { render, h, popups, calls };
}
const response = patch => ({ success: true, businessId: 'b1', conversationId: 'c1', pageId: '12345', recipientId: '98765',
  navigationAvailable: false, conversationLink: null, pageInboxUrl: inbox, ...patch });

test('real action displays the allowlisted reason and retains only the verified Page fallback', async () => {
  const a = action(response({ reason: 'profile_conversation_participants_unmatched', error: 'RAW_PROVIDER_SECRET' }));
  try {
    await a.render().open();
    const result = a.render();
    assert.equal(result.notice, notice('profile_conversation_participants_unmatched'));
    assert.equal(result.fallbackUrl, inbox);
    assert.equal(a.popups[0].closed, true);
    assert.equal(a.popups[0].location.href, 'about:blank');
    assert.equal(a.calls[0].options.method, undefined);
  } finally { a.h.cleanup(); }
});

test('real action suppresses unknown reason and raw server error for an HTTP failure', async () => {
  const a = action({ success: false, reason: 'RAW_PROVIDER_SECRET', error: 'RAW_PROVIDER_SECRET' }, 403);
  try {
    await a.render().open();
    assert.equal(a.render().notice, notice(undefined, 403));
    assert.equal(a.render().fallbackUrl, '');
    assert.equal(a.popups[0].closed, true);
  } finally { a.h.cleanup(); }
});

test('a recognized reason cannot authorize an unsafe Page fallback', async () => {
  const a = action(response({ reason: 'page_reconnection_required', pageInboxUrl: 'https://evil.test/' }));
  try {
    await a.render().open();
    assert.equal(a.render().fallbackUrl, '');
    assert.equal(a.popups[0].location.href, 'about:blank');
    assert.equal(a.popups[0].closed, true);
  } finally { a.h.cleanup(); }
});

test('successful exact navigation still uses the validated provider URL', async () => {
  const a = action(response({ navigationAvailable: true, conversationLink: exact, linkSource: 'meta_conversations_api' }));
  try {
    await a.render().open();
    assert.equal(a.popups[0].location.href, exact);
    assert.equal(a.popups[0].closed, false);
    assert.equal(a.render().notice, '');
  } finally { a.h.cleanup(); }
});
