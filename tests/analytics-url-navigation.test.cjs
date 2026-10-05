const test = require('node:test'), assert = require('node:assert/strict');
const { loader, hooks, nodes } = require('./inbox-recovery-harness.cjs');

test('Analytics content follows links, Back/Forward, deep links and missing/invalid query views', () => {
  const h = hooks(); let query = new URLSearchParams('view=team-performance');
  const stub = () => null;
  const mocks = { react: h.React, 'react/jsx-runtime': h.jsx,
    'next/navigation': { useSearchParams: () => query },
    '@/components/dashboard/dashboard-panel-frame': { DashboardPanelFrame: stub, dashboardPanelSurfaceClassName: '' },
    '@/components/dashboard/dashboard-utility-navigation': { DashboardUtilityNavigation: stub },
    '@/components/inbox/agent-workload-panel': { AgentWorkloadPanel: stub },
  };
  const panels = [['dashboard', 'dashboard-overview-panel', 'DashboardOverviewPanel'], ['team-performance', 'sla-analytics-panel', 'SlaAnalyticsPanel'], ['conversation-reports', 'conversation-reports-panel', 'ConversationReportsPanel'], ['customer-insights', 'customer-insights-panel', 'CustomerInsightsPanel'], ['agent-performance', 'agent-performance-panel', 'AgentPerformancePanel'], ['channel-performance', 'channel-performance-panel', 'ChannelPerformancePanel']];
  for (const [, file, name] of panels) mocks[`@/components/analytics/${file}`] = { [name]: function Panel() {} };
  const Workspace = loader(mocks)('components/analytics/analytics-workspace.tsx').AnalyticsWorkspace;
  try {
    for (const view of ['team-performance', 'conversation-reports', 'team-performance', 'conversation-reports', 'channel-performance', 'customer-insights', 'agent-performance', null, 'invalid']) {
      query = new URLSearchParams(view ? `view=${view}` : ''); const tree = h.render(Workspace);
      const expected = panels.find(p => p[0] === view) ?? panels[0];
      assert.equal(nodes(tree, n => n.type === mocks[`@/components/analytics/${expected[1]}`][expected[2]]).length, 1, view ?? 'no query');
    }
  } finally { h.cleanup(); }
});
