const React = require('react'), { createRoot } = require('react-dom/client');
const { AnalyticsWorkspace } = require('../../components/analytics/analytics-workspace.tsx');
const { DashboardUtilityNavigationProvider } = require('../../components/dashboard/dashboard-utility-navigation.tsx');
for (const method of ['pushState', 'replaceState']) {
  const original = history[method].bind(history);
  history[method] = (...args) => { original(...args); window.dispatchEvent(new Event('fixture-query')); };
}
history.replaceState(null, '', '?view=channel-performance');
const calls = [], checks = [], errors = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
window.fetch = async (url, init = {}) => {
  const params = new URL(url, location.href).searchParams, period = params.get('period');
  const record = { url, signal: init.signal, at: performance.now() }; calls.push(record);
  // Deliberately ignore abort: result ownership must protect the UI as well.
  await pause(period === '90d' ? 400 : 100);
  const count = period === '90d' ? 1162 : period === 'yesterday' ? 42 : 9;
  return Response.json({ success: true, businessId: 'fixture-workspace', channels: [], daily: [], summary: { conversations: count, incomingMessages: 20, outgoingReplies: 33, avgFirstResponseSeconds: 524, slaRate: null, conversationsChangePercent: null }, analytics: { summary: { receivedConversations: count, received: count, totalCustomers: count, slaMet: 0, slaMissed: 0, slaRate: 100 }, daily: [], attention: [], channels: [], agents: [], waitingConversations: [] } });
};
const check = (name, value) => { if (!value) throw Error(name); checks.push(name); };
const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label);
const chooseView = view => { history.pushState(null, '', '?view=' + view); };
createRoot(document.getElementById('root')).render(React.createElement(DashboardUtilityNavigationProvider, { isAdmin: false }, React.createElement(AnalyticsWorkspace)));
(async () => {
  try {
    await pause(180);
    check('deep link mounts only its dedicated panel, without unused dashboard reads', calls.length === 1 && calls[0].url.startsWith('/api/analytics/channels'));
    button('Today').click(); await pause(160); const before = calls.length;
    button('90 days').click(); await pause(20); button('Today').click(); await pause(160);
    check('Today response wins while the retired 90-day read is still pending', !document.body.textContent.includes('1162') && document.body.textContent.includes('9'));
    await pause(320);
    check('ignored-abort slow response never publishes 90-day data under Today', !document.body.textContent.includes('1162'));
    check('90-day transport is aborted and there are exactly two period-change calls', calls.length === before + 2 && calls[before].signal.aborted);
    chooseView('team-performance'); await pause(150); check('query navigation renders Team performance', document.querySelector('button[title="Team performance"]')?.getAttribute('aria-current') === 'page' && !document.body.textContent.includes('Channel comparison'));
    chooseView('conversation-reports'); await pause(150); check('View-all query destination renders Conversation reports', document.body.textContent.includes('Conversation reports'));
    history.back(); await pause(180); check('native Back synchronizes URL and report', new URL(location.href).searchParams.get('view') === 'team-performance' && document.querySelector('button[title="Team performance"]')?.getAttribute('aria-current') === 'page' && !document.body.textContent.includes('Conversation reports'));
    history.forward(); await pause(180); check('native Forward synchronizes URL and report', new URL(location.href).searchParams.get('view') === 'conversation-reports' && document.body.textContent.includes('Conversation reports'));
    chooseView('dashboard'); await pause(25); check('first dashboard read keeps period and SLA controls', Boolean(button('Today') && button('Yesterday') && document.querySelector('select')));
    await pause(160); button('Yesterday').click(); await pause(25); check('period switch keeps controls usable', Boolean(button('Today') && button('Yesterday') && document.querySelector('select')));
    button('Today').click(); await pause(180); check('rapid dashboard A-B-A cancels the obsolete batch', calls.filter(c => c.url.includes('period=yesterday')).every(c => c.signal.aborted));
    document.getElementById('result').textContent = JSON.stringify({ passed: true, checks, calls: calls.map(c => ({ url: c.url, aborted: c.signal.aborted, at: Math.round(c.at) })) });
  } catch (error) { document.getElementById('result').textContent = JSON.stringify({ passed: false, error: error.message, errors, checks, calls: calls.map(c => ({ url: c.url, aborted: c.signal?.aborted })) }); }
})();
