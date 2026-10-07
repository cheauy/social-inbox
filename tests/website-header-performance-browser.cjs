// Real web component and API handlers; synthetic loopback data only.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { loader } = require('./inbox-recovery-harness.cjs');
const root = process.cwd(), output = process.env.TENH_PERF_OUTPUT;
if (!output || !path.isAbsolute(output)) throw Error('TENH_PERF_OUTPUT must name a temporary directory.');
fs.mkdirSync(output, { recursive: true });
const webpack = require('next/dist/compiled/webpack/webpack').webpack;
const tsLoader = path.join(output, 'loader.cjs');
fs.writeFileSync(tsLoader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(s){return ts.transpileModule(s,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
const alias = { ...(process.env.TENH_PERF_BASELINE ? { '@/components/dashboard/team-notification-center': process.env.TENH_PERF_BASELINE } : {}), '@/lib/supabase/client': path.join(root, 'tests/fixtures/website-header-supabase.cjs'), 'next/navigation': path.join(root, 'tests/fixtures/website-header-navigation.cjs'), '@': root };
const build = process.env.TENH_PERF_BASELINE ? 'baseline' : 'final';
webpack({ mode: 'production', optimization: { minimize: false }, plugins: [new webpack.DefinePlugin({ 'process.env.NODE_ENV': JSON.stringify('production') })],
  entry: path.join(root, 'tests/fixtures/website-header-performance.entry.cjs'), output: { path: output, filename: build + '.js' },
  resolve: { extensions: ['.ts', '.tsx', '.js', '.cjs'], alias, modules: [path.join(root, 'node_modules')] },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: tsLoader }] },
}, (error, stats) => { if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; } console.log('Built ' + build); });
if (process.env.TENH_PERF_SERVE !== '1') return;
const runs = new Map(), prepared = new Map(), business = '00000000-0000-4000-8000-000000000901';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const emptyMetrics = () => ({ requests: 0, dbReads: 0, dbRows: 0, dbBytes: 0, authReads: 0, writes: 0, responseBytes: 0, durationsMs: [] });
function routes(scope, metrics) {
  const seed = {
    team_members: [{ id: 'member-' + scope, user_id: 'user-' + scope, business_id: business, is_active: true }],
    business_subscriptions: [], conversation_reminders: [], social_accounts: [],
    team_notifications: [{ id: 'note-' + scope, business_id: business, recipient_member_id: 'member-' + scope,
      notification_type: 'customer_note_mention', title: 'Customer note ' + scope, body: 'Synthetic customer context',
      link: '/dashboard/inbox?conversation=synthetic', conversation_id: null, contact_id: null, room_id: null,
      is_read: false, read_at: null, created_at: '2026-10-07T00:00:00.000Z' }],
    tenh_system_announcements: [{ id: 'announcement-' + scope, title: 'Announcement ' + scope, message: 'Synthetic announcement',
      is_active: true, tone: 'update', link_label: null, link_url: null, starts_at: '2026-01-01T00:00:00Z', ends_at: null, created_at: '2026-01-01T00:00:00Z' }],
    tenh_system_announcement_dismissals: [],
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.max = Infinity; }
    select(columns) { this.columns = columns; return this; } order() { return this; }
    eq(k,v) { this.filters.push(r => r[k] === v); return this; }
    neq(k,v) { this.filters.push(r => r[k] !== v); return this; }
    in(k,v) { this.filters.push(r => v.includes(r[k])); return this; }
    lte(k,v) { this.filters.push(r => r[k] <= v); return this; } or() { return this; }
    limit(n) { this.max = n; return this; }
    async then(resolve, reject) {
      try {
        metrics.dbReads++; await pause(10);
        const rows = seed[this.table].filter(r => this.filters.every(fn => fn(r))).slice(0, this.max);
        const columns = this.columns.split(',').map(v => v.trim()).filter(Boolean);
        const data = rows.map(r => Object.fromEntries(columns.map(k => [k, r[k]])));
        metrics.dbRows += data.length; metrics.dbBytes += Buffer.byteLength(JSON.stringify(data));
        return resolve({ data, error: null });
      } catch (error) { return reject(error); }
    }
  }
  const load = loader({ '@/lib/supabase/admin': { supabaseAdmin: { from: table => new Query(table) } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => { metrics.authReads++; return { data: { user: { id: 'user-' + scope } } }; } } }) },
    '@/lib/auth/get-current-member': { TENH_ACTIVE_BUSINESS_COOKIE: 'synthetic', getCurrentMember: async () => { metrics.authReads++; return { success: true, user: { id: 'user-' + scope }, member: { id: 'member-' + scope, business_id: business } }; } },
    'next/headers': { cookies: async () => ({ get: () => ({ value: business }) }) },
  });
  return { team: load('app/api/team-notifications/route.ts'), announcement: load('app/api/system-announcements/current/route.ts') };
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/evidence' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100000) throw Error('Fixture evidence too large'); }
      const data = JSON.parse(body), name = data.mode + '-' + data.viewport.width;
      if (!/^(baseline|final)-\d+$/.test(name)) throw Error('Invalid evidence name');
      fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(data, null, 2)); return res.end('saved');
    }
    if (url.pathname === '/prime') {
      if (runs.size > 100) { res.writeHead(429); return res.end('Fixture run limit'); }
      const run = url.searchParams.get('run'), scope = url.searchParams.get('scope'), metrics = emptyMetrics();
      runs.set(run, metrics); prepared.set(run + ':' + scope, routes(scope, metrics)); return res.end('primed');
    }
    if (url.pathname === '/stats') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(runs.get(url.searchParams.get('run')))); }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') { res.writeHead(405); return res.end('Synthetic benchmark accepts GET only'); }
      const run = String(req.headers['x-fixture-run']), scope = String(req.headers['x-fixture-scope'] || 'A');
      const metrics = runs.get(run) || emptyMetrics(); runs.set(run, metrics); metrics.requests++;
      const endpoint = prepared.get(run + ':' + scope) || routes(scope, metrics), start = performance.now();
      if (req.headers['x-fixture-fail'] === '1') { res.writeHead(503); return res.end('{"success":false,"error":"Synthetic offline"}'); }
      const announcement = url.pathname === '/api/system-announcements/current'; await pause(announcement ? 180 : 20);
      const response = await (announcement ? endpoint.announcement : endpoint.team).GET(), body = await response.text();
      metrics.responseBytes += Buffer.byteLength(body); metrics.durationsMs.push({ endpoint: announcement ? 'announcement' : 'team', ms: performance.now() - start });
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); return;
    }
    if (url.pathname === '/baseline.js' || url.pathname === '/final.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(output, path.basename(url.pathname)))); }
    if (url.pathname === '/') {
      const mode = url.searchParams.get('mode') === 'baseline' ? 'baseline' : 'final';
      const cssRoot = path.join(root, '.next/static/css');
      const css = fs.readdirSync(cssRoot).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssRoot, f), 'utf8')).join('\n');
      if (!css) throw Error('Run the production webpack build before benchmarking.');
      res.setHeader('Content-Type', 'text/html'); return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TENH synthetic performance</title><style>${css}</style><button id="run">Run benchmark</button><div id="root"></div><pre id="result">Ready</pre><script src="/${mode}.js"></script>`);
    }
    res.writeHead(404); res.end();
  } catch (error) { console.error(error); res.writeHead(500); res.end('Fixture failure'); }
});
server.listen(0, '127.0.0.1', () => { fs.writeFileSync(path.join(output, 'port.txt'), String(server.address().port)); console.log('Loopback fixture port ' + server.address().port); });
