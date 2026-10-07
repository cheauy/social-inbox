const React = require('react'), { createRoot } = require('react-dom/client');
const { TeamNotificationCenter } = require('@/components/dashboard/team-notification-center');
const root = createRoot(document.getElementById('root')), realFetch = window.fetch.bind(window);
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
let run = '', scope = 'A', failures = false, pending = 0, requests = [], timers = [];
window.fixtureRealtime = { opens: 0, closes: 0 };
const interval = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
window.setInterval = (fn, ms) => { const id = interval(fn, ms); timers.push({ id, ms }); return id; };
window.clearInterval = id => { timers = timers.filter(t => t.id !== id); clear(id); };
window.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('/api/')) return realFetch(url, init);
  const item = { url, started: performance.now(), signal: init.signal }; requests.push(item); pending++;
  try { const response = await realFetch(url, { ...init, headers: { ...init.headers, 'X-Fixture-Run': run, 'X-Fixture-Scope': scope, ...(failures ? { 'X-Fixture-Fail': '1' } : {}) } }); item.ms = performance.now() - item.started; return response; }
  finally { pending--; }
};
async function until(fn) { const deadline = performance.now() + 4000; while (!fn()) { if (performance.now() > deadline) throw Error('Fixture timeout'); await frame(); } }
const bell = () => document.querySelector('button[aria-label^="Notifications"]');
const dialog = () => document.querySelector('[role="dialog"]');
async function mount(key) { root.render(React.createElement(TeamNotificationCenter, { key })); await until(() => bell()); await frame(); }
async function drain() { await until(() => pending === 0); await frame(); await frame(); }
async function stats() { return (await realFetch('/stats?run=' + encodeURIComponent(run))).json(); }
function assert(name, result, checks) { if (!result) throw Error(name); checks.push(name); }
document.getElementById('run').onclick = async () => {
  const result = { mode: new URL(location.href).searchParams.get('mode'), viewport: { width: innerWidth, height: innerHeight }, cold: [], warm: [], checks: [] };
  document.getElementById('run').disabled = true;
  try {
    for (let n = 0; n < 5; n++) {
      root.render(null); await frame(); run = 'cold-' + n + '-' + crypto.randomUUID(); requests = []; scope = 'A';
      await realFetch('/prime?run=' + run + '&scope=A');
      await mount(run);
      if (n === 0) assert('production CSS styles the real header', getComputedStyle(bell()).width === '40px', result.checks);
      const start = performance.now(); bell().click();
      await until(() => dialog()); const feedbackMs = performance.now() - start;
      await frame(); bell().click(); await frame(); bell().click();
      await until(() => dialog()?.textContent.includes('Customer note A'));
      const contentMs = performance.now() - start; await drain();
      result.cold.push({ feedbackMs, contentMs, ...await stats() });
      run = 'warm-' + n + '-' + crypto.randomUUID(); requests = [];
      await realFetch('/prime?run=' + run + '&scope=A');
      const warmStart = performance.now(); bell().click(); await frame(); bell().click();
      await until(() => dialog()?.textContent.includes('Customer note A')); const warmContent = performance.now() - warmStart;
      await frame(); bell().click(); await frame(); bell().click(); await drain();
      result.warm.push({ contentMs: warmContent, ...await stats() });
    }
    run = 'scope-' + crypto.randomUUID(); root.render(null); await frame(); scope = 'OLD'; await mount('old');
    scope = 'NEW'; root.render(React.createElement(TeamNotificationCenter, { key: 'new' })); await frame(); await frame(); bell().click(); await drain();
    assert('remounted workspace never restores old response', dialog()?.textContent.includes('Customer note NEW') && !dialog()?.textContent.includes('Customer note OLD'), result.checks);
    failures = true; run = 'failure-' + crypto.randomUUID(); root.render(null); await frame(); await mount('failure'); bell().click(); await drain();
    assert('failed request has honest retry feedback', dialog()?.textContent.includes('Unable to load notifications'), result.checks);
    failures = false; document.querySelector('[role="dialog"] button:last-child').click(); await drain();
    assert('retry recovers correct content', dialog()?.textContent.includes('Customer note NEW'), result.checks);
    root.render(null); await frame(); await frame();
    assert('unmount removes timers and realtime subscriptions', timers.length === 0 && window.fixtureRealtime.opens === window.fixtureRealtime.closes, result.checks);
    result.realtime = window.fixtureRealtime; result.passed = true;
  } catch (error) { result.passed = false; result.error = error.message; }
  await realFetch('/evidence', { method: 'POST', body: JSON.stringify(result) });
  document.getElementById('result').textContent = JSON.stringify(result); document.getElementById('run').disabled = false;
};
