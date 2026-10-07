const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { loader } = require('./tenh-seven/harness.cjs');

// Real loading components and effects; Next's link status and route phases are controlled.
test('Inbox navigation hands off link progress to its fallback and releases it on every exit', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/dashboard/analytics' });
  const previous = {};
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous[key] = global[key];
    global[key] = value;
  }
  const Pending = React.createContext(false);
  const load = loader({
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { useLinkStatus: () => ({ pending: React.useContext(Pending) }) },
  });
  const { DashboardLoadingProgress, DashboardLinkProgress } = load('components/dashboard/dashboard-loading-progress.tsx');
  const InboxLoading = load('app/dashboard/inbox/loading.tsx').default;
  const AnalyticsLoading = load('app/dashboard/analytics/loading.tsx').default;
  const root = createRoot(document.getElementById('root'));
  const bar = () => document.querySelector('[role="progressbar"]');
  async function phase({ pending = false, fallback = null } = {}) {
    await act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement(DashboardLoadingProgress),
      React.createElement(Pending.Provider, { value: pending }, React.createElement(DashboardLinkProgress)),
      fallback && React.createElement(fallback),
    )));
  }
  try {
    await phase();
    assert.equal(bar(), null);
    await phase({ pending: true });
    assert.ok(bar(), 'another menu -> Inbox shows the existing header indicator during link pending');
    await phase({ fallback: InboxLoading });
    assert.ok(bar(), 'progress survives the history-update handoff to the Inbox skeleton');
    assert.ok(bar().classList.contains('tenh-header-progress'), 'uses the existing visual style');
    await phase();
    assert.equal(bar(), null, 'ready Inbox releases its ticket');

    await phase();
    assert.equal(bar(), null, 'warm immediate navigation has no artificial pending phase');
    await phase({ pending: true });
    await phase();
    assert.equal(bar(), null, 'failed navigation before a fallback releases link progress');
    await phase({ fallback: InboxLoading });
    await phase();
    assert.equal(bar(), null, 'a failed route unmounting the fallback releases its ticket');

    await phase({ fallback: InboxLoading });
    await phase({ pending: true, fallback: InboxLoading });
    await phase({ fallback: AnalyticsLoading });
    assert.ok(bar(), 'superseding Inbox with another menu keeps only real pending work visible');
    await phase();
    assert.equal(bar(), null, 'rapid switching does not leave an Inbox ticket behind');
    await phase({ pending: true });
    await phase({ fallback: InboxLoading });
    await phase({ pending: true, fallback: AnalyticsLoading });
    await phase();
    assert.equal(bar(), null, 'repeated switching clears every mounted fallback');

    // History navigation has no clicked Link status, so the route fallback owns feedback.
    window.history.pushState(null, '', '/dashboard/inbox');
    window.history.pushState(null, '', '/dashboard/analytics');
    const popstate = () => new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
    let popped = popstate();
    window.history.back();
    await popped;
    assert.equal(window.location.pathname, '/dashboard/inbox');
    await phase({ fallback: InboxLoading });
    assert.ok(bar(), 'cold back navigation to Inbox needs no clicked-link ticket');
    await phase();
    assert.equal(bar(), null);
    popped = popstate();
    window.history.forward();
    await popped;
    await phase({ fallback: AnalyticsLoading });
    assert.ok(bar(), 'other menu fallback remains working on forward');
    await phase();
    assert.equal(bar(), null, 'history navigation clears on readiness');

    await phase({ fallback: InboxLoading });
    await act(async () => root.unmount());
    const nextRoot = createRoot(document.getElementById('root'));
    await act(async () => nextRoot.render(React.createElement(DashboardLoadingProgress)));
    assert.equal(bar(), null, 'unmount cleanup leaves no global loading ticket');
    await act(async () => nextRoot.unmount());
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});
