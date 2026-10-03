const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { loader, hooks, nodes } = require('./inbox-recovery-harness.cjs');

test('Analytics sidebar uses the installed Next history wrapper without bypassing URL synchronization', () => {
  const source = ts.createSourceFile('app-router.js', fs.readFileSync('node_modules/next/dist/client/components/app-router.js','utf8'), ts.ScriptTarget.Latest, true);
  let copy, replace;
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'copyNextJsInternalHistoryState') copy = n.getText(source);
    if (ts.isBinaryExpression(n) && n.left.getText(source) === 'window.history.replaceState' && ts.isFunctionExpression(n.right)) replace = n.right.getText(source);
    ts.forEachChild(n,visit);
  } visit(source); assert.ok(copy && replace,'installed Next wrapper must be available');
  const h = hooks(), stub = () => null, restores = [];
  let query = new URLSearchParams('view=channel-performance');
  const win = { location:{href:'https://fixture.invalid/dashboard/analytics?view=channel-performance'}, history:{state:{__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:{fixture:true}}} };
  const context = vm.createContext({ window:win,
    originalReplaceState(data,unused,url) { win.history.state=data; win.location.href=new URL(url,win.location.href).href; },
    applyUrlFromHistoryPushReplace(url) { restores.push(url); query=new URL(url,win.location.href).searchParams; },
  });
  vm.runInContext(copy+'\nwindow.history.replaceState = '+replace,context);
  const Panel = () => null;
  const mocks = {react:h.React,'react/jsx-runtime':h.jsx,'next/navigation':{useSearchParams:()=>query},
    '@/components/dashboard/dashboard-panel-frame':{DashboardPanelFrame:stub,dashboardPanelSurfaceClassName:''},
    '@/components/dashboard/dashboard-utility-navigation':{DashboardUtilityNavigation:stub},'@/components/inbox/agent-workload-panel':{AgentWorkloadPanel:stub},
  };
  for (const [file,name] of [['dashboard-overview-panel','DashboardOverviewPanel'],['sla-analytics-panel','SlaAnalyticsPanel'],['conversation-reports-panel','ConversationReportsPanel'],['customer-insights-panel','CustomerInsightsPanel'],['agent-performance-panel','AgentPerformancePanel'],['channel-performance-panel','ChannelPerformancePanel']]) mocks['@/components/analytics/'+file]={ [name]:Panel };
  const Workspace=loader(mocks,{window:win})('components/analytics/analytics-workspace.tsx').AnalyticsWorkspace;
  try {
    let tree=h.render(Workspace);
    nodes(tree,n=>n.type==='button' && n.props.title==='Team performance')[0].props.onClick(); tree=h.render(Workspace);
    assert.equal(new URL(win.location.href).searchParams.get('view'),'team-performance');
    assert.equal(restores.length,1,'external replacement must dispatch Next URL restoration');
    assert.equal(nodes(tree,n=>n.type==='button' && n.props.title==='Team performance')[0].props['aria-current'],'page');
    assert.equal(win.history.state.__NA,true,'Next preserves its own state automatically');
    assert.ok(win.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE);
    nodes(tree,n=>n.type==='button' && n.props.title==='Channel performance')[0].props.onClick(); tree=h.render(Workspace);
    assert.equal(restores.length,2); assert.equal(nodes(tree,n=>n.type==='button' && n.props.title==='Channel performance')[0].props['aria-current'],'page');
  } finally { h.cleanup(); }
});
