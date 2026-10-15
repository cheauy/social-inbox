import test from 'node:test';
import assert from 'node:assert/strict';
import harness from './inbox-recovery-harness.cjs';
const { loader, nodes } = harness;

function render({ pathname = '/dashboard/analytics', language = 'en', document, ...overrides } = {}) {
  const load = loader({
    'next/navigation': { usePathname: () => pathname },
    'next/link': 'link',
    '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => language },
  }, { document });
  return load('components/subscription/subscription-access-gate.tsx').SubscriptionAccessGate({
    children: 'protected content',
    access: { hasSubscription: true, locked: true, reason: 'expired', status: 'expired', planCode: 'trial', trialEndsAt: '2026-09-11T12:00:00Z', currentPeriodEnd: null, subscription: null, ...overrides },
  });
}
const text = tree => typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const links = tree => nodes(tree, n => n.type === 'link').map(n => n.props.href);

test('active accounts and existing allowed routes still bypass the lock', () => {
  for (const status of ['trialing', 'active']) assert.equal(render({ locked: false, status }), 'protected content');
  for (const pathname of ['/dashboard/subscription', '/dashboard/subscription/payment', '/dashboard/profile', '/dashboard/settings/security', '/dashboard/integrations']) assert.equal(render({ pathname }), 'protected content');
  for (const reason of ['past_due', 'suspended']) {
    assert.notEqual(render({ pathname: '/dashboard/settings/security', reason }), 'protected content');
    assert.notEqual(render({ pathname: '/dashboard/integrations', reason }), 'protected content');
  }
  assert.notEqual(render({ pathname: '/dashboard/settings/general' }), 'protected content');
});

test('expiry facts and action destinations come from existing state and routes', () => {
  const trial = render();
  assert.match(text(trial), /11 Sept 2026/);
  assert.match(text(trial), /Free Trial/);
  assert.deepEqual(links(trial), ['/dashboard/subscription', '/dashboard/settings/security']);
  const paid = render({ planCode: 'business_pro', trialEndsAt: null, currentPeriodEnd: '2026-10-01T12:00:00Z' });
  assert.match(text(paid), /Business Pro/);
  assert.doesNotMatch(text(paid), /Trial ended|trial has ended/);
  assert.ok(links(paid).includes('/dashboard/integrations'));
  for (const trialEndsAt of [null, 'invalid']) {
    const missing = text(render({ planCode: null, trialEndsAt }));
    assert.doesNotMatch(missing, /Invalid Date|undefined/);
    assert.match(missing, /No active plan/);
  }
});

test('workspace action opens the existing authorized switcher without toggling it closed', () => {
  let expanded = false, focused = 0, clicked = 0;
  const trigger = { focus() { focused++; }, getAttribute() { return String(expanded); }, click() { clicked++; expanded = true; } };
  const tree = render({ document: { querySelector(selector) { assert.equal(selector, '[data-dashboard-header] [data-dashboard-workspace-switcher] > button'); return trigger; } } });
  const button = nodes(tree, n => n.type === 'button')[0];
  button.props.onClick(); button.props.onClick();
  assert.equal(focused, 2); assert.equal(clicked, 1);
});

test('Khmer and each locked state retain distinct copy', () => {
  assert.match(text(render({ language: 'km' })), /ការសាកល្បង/);
  assert.doesNotMatch(text(render({ language: 'km' })), /\?{3}/);
  assert.match(text(render({ reason: 'past_due' })), /Payment is required/);
  const suspended = render({ reason: 'suspended' });
  assert.match(text(suspended), /currently suspended/);
  assert.match(text(suspended), /View subscription/);
  assert.deepEqual(links(suspended), ['/dashboard/subscription']);
});
