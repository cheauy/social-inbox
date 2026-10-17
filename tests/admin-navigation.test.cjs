/* eslint-disable @typescript-eslint/no-require-imports -- Node fixture uses CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');

const destinations = {
  usage: 'Usage', overview: 'Overview', billing: 'Workspaces', 'manual-payments': 'Manual payment review',
  'customer-reports': 'Customer reports', announcements: 'User update alerts', 'channel-health': 'Run diagnostics',
  connections: 'Channel connections', 'webhook-events': 'Webhook delivery', security: 'Security',
};
const panels = [
  ['@/components/admin/usage-monitor', 'UsageMonitor'], ['@/components/admin/admin-billing-analytics', 'AdminBillingAnalytics'],
  ['@/components/admin/admin-billing-management', 'AdminBillingManagement'], ['@/components/admin/admin-channel-health', 'AdminChannelHealth'],
  ['@/components/admin/admin-connections', 'AdminConnections'], ['@/components/admin/admin-security-center', 'AdminSecurityCenter'],
  ['@/components/admin/admin-webhook-events', 'AdminWebhookEvents'], ['@/components/admin/customer-report-review', 'CustomerReportReview'],
  ['@/components/admin/system-announcement-admin', 'SystemAnnouncementAdmin'], ['@/components/billing/manual-payment-admin', 'ManualPaymentAdmin'],
];
function navigationFixture(pathname = '/dashboard/admin', tab = null, rendered = []) {
  const overrides = Object.fromEntries(panels.map(([path, name]) => [path, { [name]: () => { rendered.push(name); return null; } }]));
  overrides['next/navigation'] = { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(tab ? { tab } : {}) };
  overrides['@/components/display/workspace-language-text'] = { useWorkspaceLanguageId: () => 'en' };
  return loader(overrides)('components/admin/tenh-admin-workspace.tsx');
}
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test', email_confirmed_at: '2026-10-15T00:00:00Z' };
function pageFixture(options = {}) {
  const calls = { user: 0, assurance: 0 };
  function Workspace() { return null; }
  function Challenge() { return null; }
  const load = loader({
    'next/navigation': { redirect: url => { const error = new Error(`Redirect to ${url}`); error.redirect = url; throw error; } },
    '@/components/admin/tenh-admin-workspace': { TenhAdminWorkspace: Workspace },
    '@/components/admin/admin-mfa-challenge': { AdminMfaChallenge: Challenge },
    '@/lib/supabase/server': { createClient: async () => ({ auth: {
      getUser: async () => { calls.user++; return { data: { user: Object.hasOwn(options, 'user') ? options.user : user }, error: options.authError ?? null }; },
      mfa: { getAuthenticatorAssuranceLevel: async () => { calls.assurance++; return { data: { currentLevel: options.level ?? 'aal2' }, error: options.assuranceError ?? null }; } },
    } }) },
  }, { process: { env: { TENH_ADMIN_USER_ID: options.missingConfig ? '' : user.id, TENH_ADMIN_EMAIL: user.email, TENH_ADMIN_REQUIRE_MFA: options.requireMfa === false ? 'false' : 'true' } } });
  return { page: load('app/dashboard/admin/page.tsx').default, mfa: load('app/dashboard/admin/mfa/page.tsx').default, Workspace, Challenge, calls };
}
function findElement(node, type) {
  if (Array.isArray(node)) return node.map(child => findElement(child, type)).find(Boolean);
  if (!node || typeof node !== 'object') return null;
  return node.type === type ? node : findElement(node.props?.children, type);
}

test('grouped admin navigation preserves exactly ten existing destinations and their page labels', () => {
  const { adminNavigationGroups } = navigationFixture();
  assert.ok(Array.isArray(adminNavigationGroups) && adminNavigationGroups.length > 1);
  const items = Array.from(adminNavigationGroups).flatMap(group => {
    assert.ok(group.label.trim()); assert.match(group.kmLabel, /[\u1780-\u17ff]/); assert.ok(group.items.length);
    return Array.from(group.items);
  });
  assert.equal(items.length, 10); assert.equal(new Set(items.map(item => item.id)).size, 10);
  assert.deepEqual(items.map(item => item.id).sort(), Object.keys(destinations).sort());
  assert.equal(new Set(items.map(item => item.label)).size, 10);
  for (const item of items) {
    assert.equal(item.pageLabel ?? item.label, destinations[item.id]); assert.ok(item.label.trim()); assert.ok(item.kmLabel.trim());
    assert.ok(item.description.trim()); assert.ok(item.icon);
  }
});

test('active admin section follows the actual query route and keeps the MFA route in Security', () => {
  const { resolveAdminTab } = navigationFixture();
  for (const id of Object.keys(destinations)) assert.equal(resolveAdminTab('/dashboard/admin', id), id);
  for (const tab of [null, '', 'unknown', 'constructor', 'billing/other']) assert.equal(resolveAdminTab('/dashboard/admin', tab), 'overview');
  for (const tab of [null, 'billing', 'overview', 'security']) assert.equal(resolveAdminTab('/dashboard/admin/mfa', tab), 'security');
});

test('navigation badges retain the existing queue counters without fabricating badges for other destinations', () => {
  const { adminTabBadge } = navigationFixture();
  const summary = { actionable: 37, manualSubmitted: 3, manualApproved: 93, manualRejected: 12, reportsOpen: 20, reportsReviewing: 18, reportsResolved: 90, reportActionable: 7, activeAnnouncements: 4 };
  for (const id of Object.keys(destinations)) assert.equal(adminTabBadge(id, summary), ({ overview: 37, 'manual-payments': 3, 'customer-reports': 7, announcements: 4 })[id] ?? 0);
});

test('actual navigation renders unique query destinations and the panel selected by URL rather than stale initial props', () => {
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  for (const [tab, panel] of [['connections', 'AdminConnections'], ['billing', 'AdminBillingManagement']]) {
    const rendered = []; const { TenhAdminWorkspace } = navigationFixture('/dashboard/admin', tab, rendered);
    const html = renderToStaticMarkup(React.createElement(TenhAdminWorkspace, { adminEmail: user.email, initialTab: 'usage', adminMfaRequired: true }));
    assert.deepEqual(rendered, [panel]);
    const menus = Array.from(html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)); assert.ok(menus.length);
    for (const menu of menus) {
      const links = Array.from(menu[1].matchAll(/<a\b([^>]*)>/g)).map(match => ({ href: /\bhref="([^"]+)"/.exec(match[1])?.[1], active: /\baria-current="page"/.test(match[1]) }))
        .filter(link => link.href?.startsWith('/dashboard/admin?tab='));
      assert.equal(links.length, 10); assert.equal(new Set(links.map(link => link.href)).size, 10);
      assert.deepEqual(links.map(link => new URL(link.href, 'https://app.tenhchat.com').searchParams.get('tab')).sort(), Object.keys(destinations).sort());
      assert.deepEqual(links.filter(link => link.active).map(link => link.href), [`/dashboard/admin?tab=${tab}`]);
    }
  }
});

test('the shared admin hero and email render only on the exact Overview path and keep other page panels',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  for(const pathname of ['/dashboard/admin','/dashboard/admin/mfa','/dashboard/admin/mfa/setup','/dashboard/admin/nested','/dashboard/admin/overview'])for(const tab of [null,...Object.keys(destinations),'unknown']){
    const rendered=[],{TenhAdminWorkspace,resolveAdminTab}=navigationFixture(pathname,tab,rendered);
    const html=renderToStaticMarkup(React.createElement(TenhAdminWorkspace,{adminEmail:user.email,initialTab:'overview',adminMfaRequired:true}));
    const expected=pathname==='/dashboard/admin'&&resolveAdminTab(pathname,tab)==='overview';
    for(const text of ['Administration center','Signed in as',user.email])assert.equal(html.includes(text),expected,`${pathname}?tab=${tab}: ${text}`);
    assert.equal(html.includes('data-admin-overview-hero'),expected);assert.ok(html.includes('data-admin-navigation'));assert.equal(rendered.length,1);
  }
});

test('manual review remains mounted and never loads the retired Bakong reconciliation panel or endpoint',async()=>{
  const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/dashboard/admin?tab=manual-payments'}),previous={};
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=global[key];global[key]=value;}
  const calls=[],load=loader({'./bakong-reconciliation-panel':{BakongReconciliationPanel:()=>{throw Error('Retired Bakong panel must not mount');}}},
    {window:dom.window,document:dom.window.document,fetch:async(url,options={})=>{calls.push({url,method:options.method??'GET'});assert.equal(url,'/api/manual-payments/admin');return Response.json({success:true,requests:[]});}});
  const Component=load('components/billing/manual-payment-admin.tsx').ManualPaymentAdmin,root=createRoot(dom.window.document.querySelector('#root'));
  try{
    await act(async()=>root.render(React.createElement(Component)));const text=dom.window.document.body.textContent;
    assert.ok(text.includes('Manual payment review'));assert.ok(text.includes('No manual payments in this view.'));
    assert.ok(!text.includes('Bakong KHQR')&&!text.includes('Payment reconciliation'));assert.deepEqual(calls,[{url:'/api/manual-payments/admin',method:'GET'}]);
  }finally{await act(async()=>root.unmount());dom.window.close();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}}
});

test('actual admin page keeps UUID, email, verified-email and MFA authorization before reading route params', async () => {
  for (const [options, redirect] of [
    [{ user: null }, '/login?next=/dashboard/admin'],
    [{ authError: { message: 'Session unavailable' } }, '/login?next=/dashboard/admin'],
    [{ user: { ...user, id: '00000000-0000-4000-8000-000000000002' } }, '/dashboard'],
    [{ user: { ...user, email: 'other@example.test' } }, '/dashboard'],
    [{ user: { ...user, email_confirmed_at: null } }, '/dashboard'],
    [{ level: 'aal1' }, '/dashboard/admin/mfa'], [{ assuranceError: { message: 'Assurance unavailable' } }, '/dashboard/admin/mfa'],
    [{ missingConfig: true }, '/dashboard'],
  ]) {
    const f = pageFixture(options); let paramsRead = false;
    const searchParams = { then(resolve) { paramsRead = true; resolve({ tab: 'security' }); } };
    await assert.rejects(() => f.page({ searchParams }), error => error.redirect === redirect, JSON.stringify(options));
    assert.equal(paramsRead, false);
  }
});

test('authorized page keeps existing query destinations, first-value resolution and the optional MFA setting', async () => {
  for (const tab of [...Object.keys(destinations), 'unknown', ['connections', 'security']]) {
    const f = pageFixture(); const element = await f.page({ searchParams: Promise.resolve({ tab }) });
    const workspace = findElement(element, f.Workspace); assert.ok(workspace);
    const expected = Array.isArray(tab) ? tab[0] : Object.hasOwn(destinations, tab) ? tab : 'overview';
    assert.equal(workspace.props.initialTab, expected); assert.equal(workspace.props.adminEmail, user.email); assert.equal(workspace.props.adminMfaRequired, true);
    assert.deepEqual(f.calls, { user: 1, assurance: 1 });
  }
  const optional = pageFixture({ level: 'aal1', requireMfa: false });
  assert.equal(findElement(await optional.page({ searchParams: Promise.resolve({}) }), optional.Workspace).props.adminMfaRequired, false);
  assert.deepEqual(optional.calls, { user: 1, assurance: 0 });
});

test('actual MFA challenge page remains identity-gated without requiring the assurance it establishes', async () => {
  const f = pageFixture({ level: 'aal1' }); assert.ok(findElement(await f.mfa(), f.Challenge)); assert.deepEqual(f.calls, { user: 1, assurance: 0 });
  for (const [options, redirect] of [[{ user: null }, '/login?next=/dashboard/admin/mfa'], [{ user: { ...user, email: 'other@example.test' } }, '/dashboard'], [{ user: { ...user, email_confirmed_at: null } }, '/dashboard']]) {
    const denied = pageFixture(options); await assert.rejects(() => denied.mfa(), error => error.redirect === redirect); assert.equal(denied.calls.assurance, 0);
  }
});
