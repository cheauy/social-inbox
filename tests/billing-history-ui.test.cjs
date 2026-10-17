/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client'), { JSDOM } = require('jsdom');
const { loader } = require('./tenh-seven/harness.cjs');
test('customer history omits intro, metrics and Pending tab/rows; visible filter counts agree with rows', async () => {
  const dom = new JSDOM('<div id="root"></div>'), previous = {};
  for (const [k,v] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) { previous[k]=global[k]; global[k]=v; }
  const row = (status,n) => ({ id: `row-${n}`, status, source: 'payway', businessId: 'workspace', workspaceName: `Workspace ${n}`, createdAt: '2026-10-17', planCode: 'mini', billingCycle: 'monthly', amount: 13, currency: 'USD', environment: 'sandbox', transactionId: `REF-${n}` });
  const items = [row('pending',1),row('approved',2),row('failed',3),row('refunded',4)];
  const load = loader({ react: React, 'next/link': ({ children, ...props }) => React.createElement('a',props,children),
    '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' },
  }, { window: dom.window, fetch: async () => Response.json({ success: true, items, summary: { total: 999, approved: 999, pending: 998, attention: 999, approvedUsdTotal: 1, testUsdTotal: 2, unverifiedUsdTotal: 3 } }) });
  const root = createRoot(dom.window.document.querySelector('#root'));
  try {
    await act(async () => root.render(React.createElement(load('components/subscription/billing-history-view.tsx').BillingHistoryView)));
    const text=()=>dom.window.document.body.textContent;
    assert.doesNotMatch(text(), /Review ABA PayWay|Real paid total|Test payments \(USD\)|Unverified approvals \(USD\)|Pending|Workspace 1|999/);
    const find = label => [...dom.window.document.querySelectorAll('button')].find(b=>b.textContent.startsWith(label));
    assert.equal(find('All').textContent.replace(/\s/g,''),'All3');
    assert.equal(find('Approved').textContent.replace(/\s/g,''),'Approved1');
    assert.equal(find('Needs attention').textContent.replace(/\s/g,''),'Needsattention1');
    assert.equal(dom.window.document.querySelectorAll('article').length,3);
    await act(async()=>find('Approved').click());assert.equal(dom.window.document.querySelectorAll('article').length,1);assert.match(text(),/Workspace 2/);
    await act(async()=>find('Needs attention').click());assert.equal(dom.window.document.querySelectorAll('article').length,1);assert.match(text(),/Workspace 3/);
    await act(async()=>find('All').click());assert.match(text(),/Workspace 4/);
  } finally {
    await act(async()=>root.unmount());dom.window.close();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete global[k];else global[k]=v;}
  }
});
