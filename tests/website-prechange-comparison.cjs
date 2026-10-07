// Run the same existing assertions against isolated pre-change and current sources.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = process.cwd(), baseline = process.env.TENH_TEST_BASELINE, output = process.env.TENH_TEST_EVIDENCE;
if (!baseline || !output || !path.isAbsolute(baseline) || !path.isAbsolute(output)) throw Error('Provide absolute TENH_TEST_BASELINE and TENH_TEST_EVIDENCE paths.');
const tests = [
  'website-read-efficiency.test.cjs', 'inbox-performance.test.cjs', 'inbox-return-context.test.cjs', 'inbox-navigation-loading.test.cjs',
  'dashboard-nav-link.test.cjs', 'dashboard-next-link-contract.test.cjs', 'dashboard-utility-navigation.test.cjs',
  'analytics-request-lifecycle.test.cjs', 'analytics-next-history.test.cjs', 'analytics-url-navigation.test.cjs',
  'channel-analytics-request-budget.test.cjs', 'channel-analytics-read-safety.test.cjs', 'inbox-view-navigation.test.cjs',
  'inbox-search-match.test.cjs', 'inbox-photo-loading.test.cjs', 'inbox-albums.test.cjs', 'album-action-target.test.mjs',
  'optimistic-outgoing-dedupe.test.cjs', 'workspace-storage-cache.test.cjs', 'team-chat-retirement.test.cjs',
  'inbox-action-feedback.test.cjs', 'inbox-success-alerts.test.mjs', 'inbox-text-draft.test.cjs',
  'message-send-reconciliation.test.mjs', 'quick-reply-mixed-send.test.cjs',
].map(p => path.join(root, 'tests', p));
fs.mkdirSync(output, { recursive: true });
const reporter = path.join(output, 'reporter.cjs');
fs.writeFileSync(reporter, `module.exports=async function*(events){const results=[];let summary;for await(const event of events){if(event.type==='test:pass'||event.type==='test:fail'){const d=event.data,e=d.details?.error;results.push({name:d.name,status:event.type==='test:pass'?'pass':'fail',failureType:e?.failureType,error:e?.cause?.message||e?.message||null});}if(event.type==='test:summary')summary=event.data;}yield JSON.stringify({results,summary})+'\\n';};`);
const rtk = 'C:/Users/TUF/AppData/Local/Headroom/headroom/bin/rtk.exe';
const runs = [];
for (const [mode, cwd] of [['baseline', baseline], ['final', root]]) {
  const start = new Date().toISOString();
  const child = cp.spawnSync(rtk, ['proxy', process.execPath, '--test', '--test-concurrency=1', '--test-reporter=' + pathToFileURL(reporter).href, ...tests], {
    cwd, env: { ...process.env, TENH_TEST_ROOT: cwd, TZ: 'Asia/Ho_Chi_Minh' }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  const text = child.stdout.trim().split('\n').findLast(line => line.startsWith('{'));
  if (!text) throw Error('Test reporter did not finish: ' + mode);
  const data = JSON.parse(text), failures = data.results.filter(x => x.status === 'fail');
  const result = { mode, start, finish: new Date().toISOString(), exitCode: child.status, total: data.results.length, pass: data.results.filter(x => x.status === 'pass').length, failures, results: data.results };
  fs.writeFileSync(path.join(output, mode + '-tests.json'), JSON.stringify(result, null, 2) + '\n');
  runs.push(result);
  console.log(JSON.stringify({ mode, total: result.total, pass: result.pass, failures }));
}
const baselineByName = new Map(runs[0].results.map(x => [x.name, x]));
const changes = runs[1].results.filter(x => JSON.stringify(x) !== JSON.stringify(baselineByName.get(x.name)));
const evidence = { conditions: { node: process.version, testConcurrency: 1, timezone: 'Asia/Ho_Chi_Minh', dependencies: 'same existing node_modules', commonTests: tests.map(p => ({ path: path.relative(root,p).replaceAll('\\','/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') })) }, baseline: { total: runs[0].total, pass: runs[0].pass, failures: runs[0].failures }, final: { total: runs[1].total, pass: runs[1].pass, failures: runs[1].failures }, changedOutcomes: changes };
fs.writeFileSync(path.join(output, 'paired-tests.json'), JSON.stringify(evidence, null, 2) + '\n');
if (changes.length || runs[0].total !== runs[1].total) process.exitCode = 1;
console.log(JSON.stringify({ changedOutcomes: changes.length, total: runs[1].total }));
