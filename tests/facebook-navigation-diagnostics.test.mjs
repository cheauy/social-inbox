import test from 'node:test';
import assert from 'node:assert/strict';
import { loader, database } from './tenh-seven/harness.cjs';
import { hooks, nodes } from './inbox-recovery-harness.cjs';
const page = '12345', recipient = '98765', secret = 'PRIVATE_PROVIDER_VALUE';
const suite = 'https://business.facebook.com/latest/inbox/all?asset_id=12345&selected_item_id=54321&thread_type=FB_MESSAGE';
const diagnosticKeys = ['providerLinkState', 'providerRouteKind', 'directLinkRejectReason', 'cacheUsed'];
const takeDetails = value => Object.fromEntries(diagnosticKeys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
function routeFixture(options = {}) {
  const db = database({
    conversations: [{ id: 'c1', business_id: 'b1', source_type: options.source || 'messenger', contact_id: 'ct1', social_account_id: 's1' }],
    social_accounts: [{ id: 's1', business_id: 'b1', platform: 'facebook', platform_account_id: page, is_active: options.active !== false, facebook_page_access_token_encrypted: options.missingToken ? null : 'encrypted', updated_at: 'v1' }],
    contacts: [{ id: 'ct1', business_id: 'b1', platform: 'facebook', platform_user_id: recipient }],
  });
  let calls = 0;
  const load = loader({
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/inbox/get-inbox-resource-access': { getInboxConversationAccess: async () => options.denied ? { success: false, status: 403, error: 'Forbidden' }
      : { success: true, businessId: 'b1', member: {}, conversation: { contact_id: 'ct1', social_account_id: 's1' } } },
    '@/lib/auth/require-permission': {},
    '@/lib/facebook/facebook-token-crypto': { decryptFacebookToken: () => { if (options.decryptFails) throw Error(secret); return 'synthetic-token'; } },
    '@/lib/facebook/get-facebook-page-access-token': {},
  }, { AbortSignal, fetch: async () => {
    calls++;
    if (options.providerThrows) throw Error(secret);
    return new Response(JSON.stringify(options.providerError ? { error: { code: 10, message: secret } }
      : { data: [{ id: 't_' + secret, link: options.link, participants: { data: [{ id: page }, { id: options.participant || recipient, name: secret }] } }] }),
    { status: options.providerError ? 403 : 200 });
  } });
  const GET = load('app/api/conversations/[conversationId]/facebook-conversation/route.ts').GET;
  return { db, calls: () => calls, get: (patch = {}) => GET({ method: 'GET', url: 'https://fixture.test/api?' + new URLSearchParams({
    businessId: 'b1', pageId: page, recipientId: recipient, lookup: 'navigation', ...patch,
  }) }, { params: Promise.resolve({ conversationId: 'c1' }) }) };
}
for (const [link, state, kind, rejection] of [
  [null, 'missing', 'unknown', 'provider_link_missing'],
  ['', 'missing', 'unknown', 'provider_link_missing'],
  ['   ', 'missing', 'unknown', 'provider_link_missing'],
  [42, 'missing', 'unknown', 'provider_link_missing'],
  ['https://evil.test/' + secret, 'rejected', 'unknown', 'provider_link_rejected'],
  [suite.replace('asset_id=12345', 'asset_id=99999'), 'rejected', 'unknown', 'provider_link_rejected'],
  ['https://www.facebook.com/12345/inbox/2468/?section=messages', 'retained', 'legacy_page_inbox', 'legacy_page_inbox_route'],
  ['https://www.facebook.com/messages/t/2468', 'retained', 'messages', 'messages_route'],
  [suite.replace('/inbox/all?', '/inbox/other?'), 'retained', 'suite', 'unsupported_suite_route'],
  [suite.replace('asset_id=12345', 'page_id=12345'), 'retained', 'suite', 'missing_page_asset'],
  [suite.replace('&thread_type=FB_MESSAGE', ''), 'retained', 'suite', 'invalid_thread_type'],
  [suite + '&thread_type=FB_MESSAGE', 'retained', 'suite', 'invalid_thread_type'],
  [suite.replace('selected_item_id=54321', 'thread_id=54321'), 'retained', 'suite', 'invalid_selected_item'],
  [suite.replace('selected_item_id=54321', 'selected_item_id=98765'), 'retained', 'suite', 'invalid_selected_item'],
  [suite + '&threadid=t_2468', 'retained', 'suite', 'conflicting_thread_parameters'],
  [suite + '&business_id=invalid', 'retained', 'suite', 'invalid_business_id'],
  [suite + '&business_id=123&business_id=456', 'retained', 'suite', 'invalid_business_id'],
  [suite, 'retained', 'suite', 'none'],
  [suite + '&access_token=' + secret + '&redirect=https%3A%2F%2Fevil.test', 'retained', 'suite', 'none'],
]) test('authorized diagnostics explain ' + rejection + ' without broadening navigation: ' + String(link), async () => {
  const fixture = routeFixture({ link }), response = await fixture.get(), body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(takeDetails(body), { providerLinkState: state, providerRouteKind: kind, directLinkRejectReason: rejection, cacheUsed: false });
  const { normalizeBusinessSuiteConversationLink } = loader()('lib/facebook/conversation-link.ts');
  assert.equal(body.navigationAvailable, Boolean(normalizeBusinessSuiteConversationLink(link, page, recipient)));
  assert.equal(body.conversationLink, rejection === 'none' ? suite : null);
  assert.equal(JSON.stringify(body).includes(secret), false, 'no provider name, thread ID, URL parameters or errors leak');
  const cached = await (await fixture.get()).json();
  assert.equal(cached.cacheUsed, true);
  assert.equal(fixture.calls(), 1);
  assert.ok(fixture.db.history.every(query => query.op === 'read' && query.table !== 'facebook_inbox_links'));
});
for (const [options, patch, status] of [
  [{ denied: true }, {}, 403],
  [{}, { businessId: 'other' }, 409],
  [{}, { pageId: 'other' }, 409],
  [{}, { recipientId: 'other' }, 409],
  [{ source: 'comment' }, {}, 400],
  [{ active: false }, {}, 424],
]) test('authorization/context failure emits no lookup diagnostics: ' + JSON.stringify({ options, patch }), async () => {
  const fixture = routeFixture({ link: suite, ...options }), response = await fixture.get(patch), body = await response.json();
  assert.equal(response.status, status);
  assert.deepEqual(takeDetails(body), {});
  assert.equal(fixture.calls(), 0);
  if (options.denied) assert.equal(fixture.db.history.length, 0);
});
for (const options of [{ missingToken: true }, { decryptFails: true }]) test('connection failure does not invent a link or cache state: ' + JSON.stringify(options), async () => {
  const fixture = routeFixture(options), body = await (await fixture.get()).json();
  assert.deepEqual(takeDetails(body), {});
  assert.equal(body.reason, 'page_reconnection_required');
  assert.equal(fixture.calls(), 0);
  assert.equal(JSON.stringify(body).includes(secret), false);
});
for (const options of [{ providerError: true }, { providerThrows: true }, { participant: '99999' }]) test('unresolved lookup reports only actual cache state: ' + JSON.stringify(options), async () => {
  const fixture = routeFixture({ link: suite, ...options }), body = await (await fixture.get()).json();
  assert.deepEqual(takeDetails(body), { cacheUsed: false });
  assert.equal(body.navigationAvailable, false);
  assert.equal(JSON.stringify(body).includes(secret), false);
  assert.deepEqual(takeDetails(await (await fixture.get()).json()), { cacheUsed: true });
});
test('diagnostic reader drops unexpected, inherited and secret values', () => {
  const { readNavigationDiagnostics: read } = loader()('lib/facebook/conversation-navigation-diagnostics.ts');
  for (const value of [null, [], secret, 42, Object.create({ cacheUsed: true, providerLinkState: 'retained' })]) assert.equal(read(value), null);
  for (const value of [secret, '__proto__', 'constructor', 'toString', {}, true]) assert.equal(read({
    providerLinkState: value, providerRouteKind: value, directLinkRejectReason: value, cacheUsed: 'true', token: secret,
  }), null);
  assert.equal(JSON.stringify(read({ providerLinkState: 'retained', cacheUsed: false, rawUrl: secret })), '{"providerLinkState":"retained","cacheUsed":false}');
});
function actionFixture(body) {
  const h = hooks();
  h.React.createContext = () => ({});
  let shared, calls = 0;
  h.React.useContext = () => shared;
  const load = loader({ react: h.React, 'react/jsx-runtime': h.jsx, 'lucide-react': { ExternalLink: 'icon' }, '@/lib/extension/use-companion': { useCompanion: () => ({ verifiedConversationNavigation: false }) } }, {
    AbortController, URLSearchParams,
    window: { open: () => ({ closed: false, opener: null, location: { href: 'about:blank', replace() {} },
      document: { createElement: () => ({ style: {} }), body: { appendChild() {} } }, close() { this.closed = true; } }) },
    fetch: async () => { calls++; return new Response(JSON.stringify(body)); },
  });
  const { FacebookConversationActionProvider: Provider, CompanionFacebookAction: Button } = load('components/inbox/companion-facebook-action.tsx');
  const context = { conversationId: 'c1', businessId: 'b1', pageId: page, threadId: recipient, navigationOnly: true };
  function render(patch = {}) { shared = h.render(Provider, { ...context, ...patch }).props.value; return shared; }
  function button() { const element = h.render(Button, context); return element.type(element.props); }
  render();
  return { render, button, h, calls: () => calls };
}
const unavailable = patch => ({ success: true, conversationId: 'c1', businessId: 'b1', pageId: page, recipientId: recipient,
  navigationAvailable: false, conversationLink: null, pageInboxUrl: 'https://business.facebook.com/latest/inbox/all?asset_id=12345',
  reason: 'facebook_direct_link_required', providerLinkState: 'retained', providerRouteKind: 'legacy_page_inbox',
  directLinkRejectReason: 'legacy_page_inbox_route', cacheUsed: false, ...patch });
test('View conversation Show details renders only sanitized labels and resets on context switches', async () => {
  const fixture = actionFixture(unavailable({ threadLookupSucceeded: true, threadIdSource: 'meta_conversations_api',
    thread_id: secret, metaConversationLink: secret, customerName: secret, error: secret }));
  try {
    await fixture.render().open(); fixture.render();
    const tree = fixture.button(), details = nodes(tree, node => node.type === 'details');
    assert.equal(details.length, 1);
    assert.equal(nodes(details[0], node => node.type === 'summary')[0].props.children, 'Show details');
    assert.equal(details[0].props.open, undefined, 'native details start collapsed and are keyboard accessible');
    const values = nodes(details[0], node => node.type === 'dd').map(node => node.props.children);
    assert.deepEqual(values, ['Retained', 'Legacy Page inbox', 'Legacy Page inbox does not verify a Suite destination', 'Fresh lookup']);
    assert.equal(JSON.stringify(tree).includes(secret), false);
    assert.equal(nodes(tree, node => node.type === 'pre').length, 0);
    assert.equal(fixture.calls(), 1);
    fixture.render({ conversationId: 'c2', threadId: '77777' });
    assert.equal(fixture.render({ conversationId: 'c2', threadId: '77777' }).navigationDetails, null);
  } finally { fixture.h.cleanup(); }
});
test('a mismatching response cannot populate another customer diagnostics', async () => {
  const fixture = actionFixture(unavailable({ conversationId: 'other' }));
  try { await fixture.render().open(); assert.equal(fixture.render().navigationDetails, null); }
  finally { fixture.h.cleanup(); }
});
test('unexpected diagnostic strings never appear in the View conversation details', async () => {
  const fixture = actionFixture(unavailable({ providerLinkState: secret, providerRouteKind: '__proto__', directLinkRejectReason: secret, cacheUsed: 'true', error: secret }));
  try { await fixture.render().open(); fixture.render(); const tree = fixture.button(); assert.equal(nodes(tree, node => node.type === 'details').length, 0); assert.equal(JSON.stringify(tree).includes(secret), false); }
  finally { fixture.h.cleanup(); }
});
