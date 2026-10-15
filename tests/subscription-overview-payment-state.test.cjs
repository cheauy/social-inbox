/* eslint-disable @typescript-eslint/no-require-imports -- Real React effect harness, no network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { loader } = require('./tenh-seven/harness.cjs');

async function fixture(query) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://fixture.invalid/dashboard/subscription?${query}` });
  const previous = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const requests = [], redirects = [];
  const searchParams = new URLSearchParams(query);
  const load = loader({
    'next/navigation': { useSearchParams: () => searchParams },
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/script': () => null,
    '@/lib/supabase/client': { createClient: () => { throw new Error('No checkout or upload from overview'); } },
    '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' },
    '@/components/subscription/custom-upgrade-modal': { CustomUpgradeModal: () => null },
    '@/components/subscription/usage-management-modal': { UsageManagementModal: () => null },
    '@/components/subscription/subscription-membership-list': {
      SubscriptionMembershipList: () => null,
      isWorkspaceSubscriptionExpired: () => false,
      sameSubscriptionRenewalUrl: () => null,
    },
  }, {
    URLSearchParams,
    window: {
      location: { replace: url => redirects.push(url) },
      setTimeout: () => 1,
      clearTimeout() {},
    },
    fetch: async url => {
      requests.push(url);
      if (url === '/api/subscription/current') return Response.json({ success: true, subscription: null });
      if (url === '/api/subscription/plan-change') return Response.json({ success: true, mode: 'subscribe' });
      throw new Error(`Unexpected overview request: ${url}`);
    },
  });
  const { SubscriptionView } = load('components/subscription/subscription-view.tsx');
  const root = createRoot(dom.window.document.querySelector('#root'));
  try {
    await act(async () => root.render(React.createElement(SubscriptionView)));
    return { requests, redirects, text: dom.window.document.body.textContent };
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
}

test('overview approval hints cannot claim success or load and poll the latest manual request', async () => {
  const result = await fixture('payway=approved&manual=approved');
  assert.deepEqual(result.redirects, []);
  assert.doesNotMatch(result.text, /Payment verified successfully|Manual payment approved|workspace subscription is active/i);
  assert.ok(result.requests.every(url => !url.includes('manual-payments') && !url.includes('payway/status')));
});

test('overview sends an exact PayWay return to its persistent status instead of approving or polling it', async () => {
  const result = await fixture('payway=approved&tran_id=saved%20transaction');
  assert.deepEqual(result.redirects, ['/dashboard/subscription/payment?tran_id=saved+transaction']);
  assert.ok(result.requests.every(url => !url.includes('payway/status')));
  assert.doesNotMatch(result.text, /Payment verified successfully|workspace subscription is active/i);
});

test('overview restores only the exact manual request identifier and ignores a conflicting workspace hint', async () => {
  const result = await fixture('manual=approved&manual_request=00000000-0000-4000-8000-000000000001&purchase_business=other-workspace');
  assert.deepEqual(result.redirects, ['/dashboard/subscription/payment?manual_request=00000000-0000-4000-8000-000000000001']);
  assert.ok(result.requests.every(url => !url.includes('manual-payments')));
});
