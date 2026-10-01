/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node/browser integration harness. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { readFileSync, mkdtempSync, existsSync, readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { AsyncLocalStorage } = require("node:async_hooks");
const { once } = require("node:events");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loader } = require("./tenh-seven/harness.cjs");
const ROOT = resolve(__dirname, "..");
const preview = process.argv.includes("--preview");
const engineRoot = process.env.TENH_PGLITE_ROOT;
const browserPath = process.env.TENH_TEST_BROWSER;
const fixtureTenant = "00000000-0000-4000-8000-000000000001";
const otherTenant = "00000000-0000-4000-8000-000000000002";
const fixturePage = "00000000-0000-4000-8000-000000000003";
const otherPage = "00000000-0000-4000-8000-000000000004";
const secondPage = "00000000-0000-4000-8000-000000000005";

// SQL transport used only by this test. It never imports the Supabase client or reads .env.
function transport(pg) {
  return { async rpc(name, values) {
    assert.equal(name, "facebook_auto_reply_pause");
    try { await pg.query("select facebook_auto_reply_pause($1,$2)", [values.p_business, values.p_paused]); return { data:null,error:null }; }
    catch (error) { return {data:null,error:{code:error.code}}; }
  }, from(table) {
    assert.match(table, /^[a-z_]+$/);
    const filters = [], params = [];
    let action = "read", values, columns = "*", ordering = "", maximum = "";
    const parameter = value => { params.push(value); return "$" + params.length; };
    const identifier = value => { assert.match(value, /^[a-z_]+$/); return '"' + value + '"'; };
    const query = {
      select(value = "*") { columns = value === "*" ? "*" : value.split(",").map(identifier).join(","); return query; },
      eq(key, value) { filters.push(identifier(key) + "=" + parameter(value)); return query; },
      lt(key, value) { filters.push(identifier(key) + "<" + parameter(value)); return query; },
      order(key, options = {}) { ordering = " order by " + identifier(key) + (options.ascending === false ? " desc" : " asc"); return query; },
      limit(value) { assert.ok(Number.isInteger(value)); maximum = " limit " + value; return query; },
      insert(value) { action = "insert"; values = value; return query; },
      update(value) { action = "update"; values = value; return query; },
      async execute(single = false) {
        try {
          const where = filters.length ? " where " + filters.join(" and ") : "";
          let sql = "select " + columns + " from " + identifier(table) + where + ordering + maximum;
          if (action === "insert") {
            const rows = Array.isArray(values) ? values : [values];
            sql = "insert into " + identifier(table) + "(" + Object.keys(rows[0]).map(identifier).join(",") + ") values" + rows.map(row => "(" + Object.values(row).map(parameter).join(",") + ")").join(",") + " returning " + columns;
          }
          if (action === "update") sql = "update " + identifier(table) + " set " + Object.entries(values).map(([key, value]) => identifier(key) + "=" + parameter(value)).join(",") + where + " returning " + columns;
          const result = await pg.query(sql, params);
          assert.ok(!single || result.rows.length <= 1);
          return { data: single ? result.rows[0] || null : result.rows, error: null };
        } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      },
      maybeSingle() { return query.execute(true); },
      then(fulfilled, rejected) { return query.execute().then(fulfilled, rejected); },
    };
    return query;
  } };
}

async function bundle(folder) {
  const compiler = require("next/dist/compiled/webpack/webpack");
  const instance = compiler.webpack({
    mode: "development", target: "web", devtool: false,
    entry: join(ROOT, "components/settings/auto-reply-settings.tsx"),
    output: { path: folder, filename: "ui.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], modules: [join(ROOT, "node_modules")] },
    module: { rules: [{ test: /\.tsx?$/, use: join(__dirname, "fixtures/auto-reply-browser-loader.cjs") }] },
  });
  await new Promise((done, fail) => instance.run((error, stats) => instance.close(() => {
    if (error || stats.hasErrors()) fail(error || new Error(stats.toString({ all: false, errors: true })));
    else done();
  })));
}

async function connectBrowser(folder) {
  const child = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-sync", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    "--proxy-server=127.0.0.1:9", "--proxy-bypass-list=127.0.0.1", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--user-data-dir=" + join(folder, "browser-profile"), "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const address = await new Promise((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(new Error("Isolated browser did not start within 15 seconds.")); }, 15000);
    let output = "";
    child.once("error", error => { clearTimeout(timer); fail(error); });
    child.once("exit", code => { clearTimeout(timer); fail(new Error("Isolated browser exited: " + code)); });
    child.stderr.on("data", chunk => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/);
      if (match) { clearTimeout(timer); done(match[1]); }
    });
  });
  const socket = new WebSocket(address);
  await once(socket, "open");
  const pending = new Map(), listeners = [];
  let id = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.fail(new Error(message.error.message)); else item.done(message.result);
    } else for (const fn of listeners) fn(message);
  });
  const call = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const command = ++id;
    const timer = setTimeout(() => { pending.delete(command); fail(new Error("Browser command timed out: " + method)); }, 15000);
    pending.set(command, { done, fail, timer }); socket.send(JSON.stringify({ id: command, method, params, sessionId }));
  });
  return { child, call, listeners, async close() {
    try { await call("Browser.close"); } catch { child.kill(); }
    socket.close(); for (const item of pending.values()) clearTimeout(item.timer);
    if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise(done => setTimeout(() => { child.kill(); done(); }, 2000))]);
  } };
}

test("isolated browser exercises real Tenh Bot page, CRUD and permission guards", {
  timeout: preview ? undefined : 120000,
  skip: !engineRoot || (!preview && (!browserPath || !existsSync(browserPath))) ? "Requires existing PGlite and, for smoke tests, an installed browser; installs nothing." : false,
}, async t => {
  const { PGlite } = createRequire(resolve(engineRoot, "package.json"))("@electric-sql/pglite");
  const pg = new PGlite();
  const folder = mkdtempSync(join(tmpdir(), "tenh-auto-reply-browser-"));
  let browser, server, outbound = 0;
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role;
      create table businesses(id uuid primary key);
      create table social_accounts(id uuid primary key,business_id uuid,platform text,platform_account_id text,is_active boolean,account_name text,
        facebook_token_status text,facebook_page_access_token_encrypted text);
      create table conversations(id uuid primary key,business_id uuid,social_account_id uuid);
      create table messages(id uuid primary key default gen_random_uuid(),business_id uuid,conversation_id uuid,platform_message_id text,
        sender_platform_id text,direction text,is_echo boolean default false,raw_payload jsonb,platform_created_at timestamptz,created_at timestamptz default clock_timestamp());
      create table team_members(id uuid primary key,permissions jsonb);
    `);
    await pg.exec(readFileSync(join(ROOT, "db/migrations/20260930_facebook_auto_reply.sql"), "utf8"));
    await pg.exec(readFileSync(join(ROOT, "db/migrations/20261001_facebook_auto_reply_safety.sql"), "utf8").replace("create index concurrently", "create index"));
    await pg.exec(readFileSync(join(ROOT, "db/migrations/20261002_facebook_auto_reply_recovery_test_gate.sql"), "utf8").replace("create index concurrently", "create index"));
    await pg.query("insert into businesses values($1),($2)", [fixtureTenant, otherTenant]);
    await pg.query("insert into social_accounts(id,business_id,platform,platform_account_id,is_active,account_name) values($1,$2,'facebook','123',true,'Fixture Page'),($3,$4,'facebook','456',true,'Other Tenant Page')", [fixturePage, fixtureTenant, otherPage, otherTenant]);
    await pg.query("insert into social_accounts(id,business_id,platform,platform_account_id,is_active,account_name) values($1,$2,'facebook','789',true,'Second Fixture Page')",[secondPage,fixtureTenant]);
    await pg.query("insert into team_members values($1,$2)", [fixtureTenant, JSON.stringify({ channels: "view" })]);
    const otherRule = (await pg.query("insert into facebook_auto_reply_rules(business_id,social_account_id,name,public_template) values($1,$2,'Other Tenant Rule','Other') returning id", [otherTenant, otherPage])).rows[0].id;
    const requestContext = new AsyncLocalStorage();
    const fragment = ({ children }) => React.createElement(React.Fragment, null, children);
    const mode = () => requestContext.getStore()?.mode || "manage";
    const load = loader({
      "@/lib/supabase/admin": { supabaseAdmin: transport(pg) },
      "@/lib/auth/get-current-member": { getCurrentMember: async () => mode() === "signedout" ? { success: false, status: 401, error: "Fixture signed out." }
        : mode() === "none" ? { success: false, status: 403, code: "WORKSPACE_ACCESS_REMOVED", error: "Fixture workspace access removed." } : ({ success: true, member: {
        id: fixtureTenant, business_id: fixtureTenant, role: mode() === "manage" ? "owner" : "member",
      } }) },
      "@/lib/facebook/get-facebook-page-access-token": { resolveStoredFacebookPageAccessToken: () => { if(preview) throw new Error("Token access forbidden in preview."); return "offline-fixture-token"; } },
      "@/lib/facebook/auto-reply": { autoReplyGraph: path => {
        if(preview) throw new Error("Post verification unavailable offline.");
        const id=decodeURIComponent(path.split("?")[0]); assert.match(id,/^\d+_\d+$/);
        return {response:{ok:true},result:{id,from:{id:id.split("_")[0]},permalink_url:"https://www.facebook.com/fixture/posts/"+id.split("_")[1]}};
      }, inspectAutoReply: () => { throw new Error("Meta eligibility inspection not exercised by this fixture."); } },
      "@/components/settings/auto-reply-settings": { AutoReplySettings: () => React.createElement("div", { id: "auto-reply-root" }) },
      "@/components/dashboard/dashboard-header": { DashboardHeader: () => requestContext.getStore().header },
      "@/lib/admin/tenh-admin-auth": { isCurrentUserTenhAdminIdentity: async () => false },
      "next/image": { __esModule: true, default: () => null },
      "@/components/dashboard/dashboard-nav-link": { DashboardNavLink: ({ href, children }) => React.createElement("a", { href }, children) },
      "@/components/dashboard/dashboard-navigation-label": { DashboardNavigationLabel: ({ label }) => label },
      "@/components/dashboard/nav-permission-gate": { NavPermissionGate: ({ children }) => mode() === "none" ? null : children },
      "@/components/dashboard/current-user-profile-menu": { CurrentUserProfileMenu: () => null },
      "@/components/dashboard/team-notification-center": { TeamNotificationCenter: () => null },
      "@/components/dashboard/workspace-switcher": { WorkspaceSwitcher: () => null },
      "@/lib/subscription/get-business-subscription-access": { getBusinessSubscriptionAccess: async () => ({}) },
      "@/components/dashboard/pending-invitations-banner": { PendingInvitationsBanner: () => null },
      "@/components/dashboard/facebook-connection-attention-banner": { FacebookConnectionAttentionBanner: () => null },
      "@/lib/auth/use-workspace-permissions": { WorkspacePermissionsProvider: fragment },
      "@/components/dashboard/connection-status-banner": { ConnectionStatusBanner: () => null },
      "@/components/dashboard/removed-workspace-access-boundary": { RemovedWorkspaceAccessBoundary: fragment },
      "@/components/dashboard/workspace-setup-recovery": { WorkspaceSetupRecovery: () => null },
      "@/components/subscription/subscription-access-gate": { SubscriptionAccessGate: fragment },
    }, { fetch: () => { outbound++; throw new Error("External network forbidden in fixture."); } });
    const api = load("app/api/facebook/auto-reply/route.ts");
    const page = load("app/dashboard/tenh-bot/page.tsx").default;
    const layout = load("app/dashboard/layout.tsx").default;
    await bundle(folder);
    const cssFolder = join(ROOT, ".next/static/chunks");
    const css = existsSync(cssFolder) ? readdirSync(cssFolder).filter(name => name.endsWith(".css"))
      .map(name => readFileSync(join(cssFolder, name), "utf8")).join("\n") : "";
    server = createServer((incoming, response) => {
      const url = new URL(incoming.url, "http://127.0.0.1");
      const fixtureMode = url.searchParams.get("fixture") || incoming.headers.cookie?.match(/fixture=(manage|view|none)/)?.[1] || "manage";
      requestContext.run({ mode: fixtureMode }, async () => {
        try {
          response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'");
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Set-Cookie", "fixture=" + fixtureMode + "; Path=/; SameSite=Strict");
          if (url.pathname === "/ui.js") {
            response.setHeader("Content-Type", "application/javascript"); response.end(readFileSync(join(folder, "ui.js"))); return;
          }
          if (preview && url.pathname === "/fixture.css") {
            response.setHeader("Content-Type", "text/css"); response.end(css); return;
          }
          if (url.pathname === "/api/facebook/auto-reply") {
            const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
            const request = new Request("http://127.0.0.1" + incoming.url, { method: incoming.method,
              headers: incoming.headers, ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
            request.nextUrl = new URL(request.url);
            const result = await api[incoming.method](request);
            response.statusCode = result.status; response.setHeader("Content-Type", "application/json"); response.end(await result.text()); return;
          }
          if (url.pathname !== "/dashboard/tenh-bot") { response.statusCode = 404; response.end(); return; }
          requestContext.getStore().header = await load("components/dashboard/dashboard-header.tsx").DashboardHeader();
          const content = await page();
          if (fixtureMode === "none") assert.match(renderToStaticMarkup(content), /role="alert"/);
          const markup = renderToStaticMarkup(await layout({ children: content }));
          if (fixtureMode === "none") assert.match(markup, /role="alert"/);
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          const banner = preview ? '<div style="padding:12px;background:#fff7d6;color:#352900;font:14px sans-serif"><strong>ISOLATED FIXTURE PREVIEW</strong> — not your authenticated app. Saves and toggles affect temporary sample data only; the worker never runs. All-post rules can be saved. Verified specific posts and eligibility tests are unavailable offline. Data resets when this preview stops.<br><a href="?fixture=manage">Manage fixture</a> | <a href="?fixture=view">View-only fixture</a> | <a href="?fixture=none">Revoked-access fixture</a></div>' : '';
          response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated Tenh Bot fixture</title>' +
            '<link rel="stylesheet" href="/fixture.css">' + '</head><body>' + banner + markup +
            (fixtureMode === "none" ? "" : '<script src="/ui.js"></script>') + '</body></html>');
        } catch (error) { response.statusCode = 500; response.end(String(error)); }
      });
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = "http://127.0.0.1:" + server.address().port;
    if (preview) {
      console.log("ISOLATED_FIXTURE_PREVIEW=" + origin + "/dashboard/tenh-bot?fixture=manage");
      console.log("Temporary in-memory database only. No .env, Supabase, worker, or Meta access. Stops after one hour or Ctrl+C.");
      let timer;
      await new Promise(done => { timer = setTimeout(done, 3600000); process.once("SIGINT", done); process.once("SIGTERM", done); });
      clearTimeout(timer);
      return;
    }
    browser = await connectBrowser(folder);
    const target = await browser.call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const call = (method, params) => browser.call(method, params, sessionId);
    const blocked = [], exceptions = [];
    browser.listeners.push(event => {
      if (event.sessionId !== sessionId) return;
      if (event.method === "Runtime.exceptionThrown") exceptions.push(event.params.exceptionDetails.text);
      if (event.method === "Fetch.requestPaused") {
        const local = event.params.request.url.startsWith(origin + "/");
        if (!local) blocked.push(event.params.request.url);
        void call(local ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId: event.params.requestId,
          ...(local ? {} : { errorReason: "BlockedByClient" }) }).catch(() => {});
      }
    });
    await call("Runtime.enable"); await call("Page.enable");
    await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const evaluate = async expression => {
      const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = expression => evaluate(`(async()=>{const end=Date.now()+10000;while(!(${expression})){if(Date.now()>end)throw new Error('Fixture UI wait failed: '+document.body.textContent.slice(0,800));await new Promise(r=>setTimeout(r,30));}return true;})()`);
    const navigate = async fixture => { await call("Page.navigate", { url: origin + "/dashboard/tenh-bot?fixture=" + fixture }); };
    const field = (label, value) => evaluate(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(n=>n.textContent.trim().startsWith(${JSON.stringify(label)}));const input=label?.querySelector('input,select,textarea');if(!input)throw new Error('Missing input');const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    const click = label => evaluate(`(()=>{const button=Array.from(document.querySelectorAll('button')).find(n=>n.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('Missing/enabled button: '+${JSON.stringify(label)});button.click();})()`);
    await navigate("manage"); await wait("Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='New rule'&&!n.disabled)");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('header nav a')).slice(0,3).map(n=>n.textContent)"), ["Inbox", "Tenh Bot", "Analytics"]);
    assert.equal(await evaluate("!!document.querySelector('aside')"), false);
    await click("New rule"); await field("Rule name", "Cancelled"); await click("Cancel");
    assert.equal((await pg.query("select count(*)::integer as count from facebook_auto_reply_rules where business_id=$1",[fixtureTenant])).rows[0].count,0);
    await click("New rule"); await field("Rule name", "Browser fixture rule"); await field("Connected Page", fixturePage); await click("Continue"); await field("Public reply text", "Fixture public reply"); await click("Continue");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Review rule scope\"]')?.textContent.includes('1 separate Page/post rule')"),true);
    await click("Save disabled"); await wait("document.body.textContent.includes('Saved disabled.') && !!document.querySelector('article')");
    let rule = (await pg.query("select * from facebook_auto_reply_rules where business_id=$1", [fixtureTenant])).rows[0];
    assert.equal(rule.enabled, false); assert.equal(rule.name, "Browser fixture rule");
    await click("Edit"); await field("Rule name", "Edited browser rule"); await click("Continue"); await field("Public reply text", "Edited fixture reply"); await click("Continue");
    await click("Save disabled"); await wait("document.querySelector('article h3')?.textContent.includes('Edited browser rule')");
    rule = (await pg.query("select * from facebook_auto_reply_rules where id=$1", [rule.id])).rows[0];
    assert.equal(rule.public_template, "Edited fixture reply");
    await field("Start (", "2026-09-30T10:00"); await click("Turn on");
    assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Review before enabling\"]')"),true);
    await click("Cancel enable");
    assert.equal((await pg.query("select enabled from facebook_auto_reply_rules where id=$1",[rule.id])).rows[0].enabled,false);
    await click("Turn on"); await click("Confirm turn on");
    await wait("Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='Pause')");
    rule = (await pg.query("select * from facebook_auto_reply_rules where id=$1", [rule.id])).rows[0];
    assert.equal(rule.enabled, true); assert.ok(rule.activated_at);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Edit').disabled"), true);
    await click("Pause"); await wait("document.querySelector('[role=status]')?.textContent.startsWith('Paused.')");
    assert.equal((await pg.query("select enabled from facebook_auto_reply_rules where id=$1", [rule.id])).rows[0].enabled, false);
    t.diagnostic("PASS real browser create/edit/activate/pause with real isolated SQL and zero jobs/sends.");
    const post = body => evaluate(`(async()=>{const r=await fetch('/api/facebook/auto-reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})});return {status:r.status,body:await r.json()};})()`);
    // Atomic bulk inserts reject overlap and foreign Pages without leaving partial drafts.
    const bulk={operation:"save",name:"Bulk",scope:"all",publicTemplate:"Fixture only"};
    assert.equal((await post({...bulk,targets:[{pageId:secondPage},{pageId:fixturePage}]})).status,409);
    assert.equal((await pg.query("select count(*)::integer as count from facebook_auto_reply_rules where social_account_id=$1",[secondPage])).rows[0].count,0);
    assert.equal((await post({...bulk,targets:[{pageId:secondPage},{pageId:otherPage}]})).status,404);
    assert.equal((await post({...bulk,targets:[{pageId:secondPage},{pageId:secondPage}]})).status,400);
    assert.equal((await post({...bulk,scope:"specific",targets:[{pageId:fixturePage,post:"789_77"}]})).status,400);
    await click("New rule"); await field("Rule name","Multi-page review"); await field("Pages","all"); await click("Continue"); await field("Public reply text","Reviewed fixture"); await click("Continue");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Review rule scope\"]')?.textContent.includes('2 Page(s)')"),true);
    await click("Cancel");
    await call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await click("New rule"); await field("Rule name","Specific selections"); await field("Pages","all"); await field("Posts","specific");
    await field("Page for post 1",fixturePage); await field("Post link or Page_post ID","123_11"); await click("Add another post");
    await field("Page for post 2",secondPage);
    await evaluate(`(()=>{const input=Array.from(document.querySelectorAll('label')).filter(n=>n.textContent.startsWith('Post link or Page_post ID'))[1].querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'789_22');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click("Continue"); await field("Public reply text","Mobile fixture reply"); await click("Continue");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"),true);
    await click("Save disabled"); await wait("document.body.textContent.includes('Saved disabled.') && document.querySelectorAll('article').length===3");
    assert.equal((await pg.query("select count(*)::integer as count from facebook_auto_reply_rules where business_id=$1 and post_id is not null and enabled=false",[fixtureTenant])).rows[0].count,2);
    assert.equal((await post({operation:"globalPause",paused:false})).status,200);
    assert.equal((await post({operation:"globalPause",paused:true})).status,200);
    t.diagnostic("PASS mobile 390px review/create, multi-Page/post disabled save, select-all snapshot review, cancel, atomic conflict and cross-tenant rejection; offline Graph verification fixture only.");
    assert.equal((await post({ operation: "toggle", id: otherRule, enabled: false })).status, 404);
    assert.equal((await post({ operation: "save", pageId: otherPage, name: "Forbidden", scope: "all", publicTemplate: "Forbidden" })).status, 404);
    assert.equal((await post({ operation: "save", id: otherRule, pageId: fixturePage, name: "Forbidden", scope: "all", publicTemplate: "Forbidden" })).status, 409);
    assert.equal((await pg.query("select name from facebook_auto_reply_rules where id=$1", [otherRule])).rows[0].name, "Other Tenant Rule");
    await navigate("view"); await wait("document.querySelector('article') && Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='New rule')?.disabled");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('article')).some(n=>n.textContent.includes('Other Tenant Rule'))"), false);
    assert.equal((await post({ operation: "toggle", id: rule.id, enabled: true, startsAt: "2026-09-30T10:00:00Z" })).status, 403);
    assert.equal((await post({ operation: "save", pageId: fixturePage, name: "Denied", scope: "all", publicTemplate: "Denied" })).status, 403);
    assert.equal((await post({ operation: "test", id: rule.id, commentId: "123_789" })).status, 403);
    t.diagnostic("PASS view-only UI and actual API permission/tenant rejection with unchanged foreign rule.");
    await navigate("none"); await wait("document.querySelector('[role=alert]')?.textContent.includes('do not have access')");
    assert.equal(await evaluate("!!document.querySelector('#auto-reply-root')"), false);
    assert.equal((await evaluate("(async()=>{const r=await fetch('/api/facebook/auto-reply');return r.status;})()")), 403);
    assert.equal(await evaluate("(async()=>{const r=await fetch('/api/facebook/auto-reply?fixture=signedout');return r.status;})()"), 401);
    assert.equal((await pg.query("select count(*)::integer as count from facebook_auto_reply_jobs")).rows[0].count, 0);
    assert.equal(outbound, 0); assert.deepEqual(blocked, []); assert.deepEqual(exceptions, []);
    t.diagnostic("PASS revoked-membership page/API and signed-out API; zero Meta/network attempts; isolated profile only.");
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    await pg.close();
  }
});
