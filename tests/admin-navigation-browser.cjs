/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tenh-admin-navigation-"));
const evidence = path.resolve(process.env.TENH_ADMIN_NAVIGATION_EVIDENCE || path.join(root, "docs/evidence/admin-navigation-20261015/browser"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [], browserErrors = [], network = [], pending = new Map();
let server, chrome, socket, nextId = 0;

async function build() {
  const webpack = require(path.join(root, "node_modules/next/dist/compiled/webpack/webpack")).webpack;
  const postcss = require("postcss"), tailwind = require("@tailwindcss/postcss");
  const loader = path.join(temp, "typescript-loader.cjs"), language = path.join(temp, "language.cjs"), image = path.join(temp, "image.cjs"), link = path.join(temp, "link.cjs"), navigation = path.join(temp, "navigation.cjs"), panels = path.join(temp, "panels.cjs");
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(path.join(root, "node_modules/typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  fs.writeFileSync(language, "exports.useWorkspaceLanguageId=()=>window.fixtureLanguage;");
  fs.writeFileSync(image, 'const React=require("react");module.exports=function Image({priority,fill,quality,loader,unoptimized,...props}){return React.createElement("img",props)};');
  fs.writeFileSync(link, 'const React=require("react");module.exports=function Link({href,children,onClick,prefetch,scroll,replace,...props}){return React.createElement("a",{...props,href,onClick(event){onClick?.(event);if(!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();window.fixtureNavigate(href,replace)}}},children)};');
  fs.writeFileSync(navigation, `const React=require("react");const subscribe=callback=>{window.addEventListener("popstate",callback);window.addEventListener("fixture-location",callback);return()=>{window.removeEventListener("popstate",callback);window.removeEventListener("fixture-location",callback)}};function useLocation(){return React.useSyncExternalStore(subscribe,()=>location.href,()=>"http://fixture.invalid/dashboard/admin?tab=overview")}exports.usePathname=()=>new URL(useLocation()).pathname;exports.useSearchParams=()=>{const value=useLocation();return React.useMemo(()=>new URL(value).searchParams,[value])};const router={push:href=>window.fixtureNavigate(href),replace:href=>window.fixtureNavigate(href,true),back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{}};exports.useRouter=()=>router;`);
  const panelNames = { UsageMonitor: "usage", AdminBillingAnalytics: "overview", AdminBillingManagement: "billing", ManualPaymentAdmin: "manual-payments", CustomerReportReview: "customer-reports", SystemAnnouncementAdmin: "announcements", AdminConnections: "connections", AdminWebhookEvents: "webhook-events", AdminChannelHealth: "channel-health", AdminSecurityCenter: "security" };
  fs.writeFileSync(panels, `const React=require("react");const names=${JSON.stringify(panelNames)};for(const[name,id]of Object.entries(names)){exports[name]=function FixturePanel(props){const[filter,setFilter]=React.useState("Fixture filter");return React.createElement("section",{"data-fixture-panel":id,"data-mfa-required":String(props.adminMfaRequired),className:"rounded-2xl border border-slate-200 bg-white p-4 text-slate-900"},React.createElement("h2",{className:"text-lg font-bold"},"Existing "+id+" panel"),React.createElement("label",{className:"mt-3 block text-sm"},"Existing panel filter",React.createElement("input",{value:filter,onChange:event=>setFilter(event.target.value),"aria-label":"Fixture "+id+" filter",className:"mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3"})),React.createElement("div",{style:{height:1800},className:"mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-500"},"Existing content and scroll area"))}};`);
  const aliases = { "next/image$": image, "next/link$": link, "next/navigation$": navigation, "@/components/display/workspace-language-text$": language };
  for (const panelModule of ["admin/usage-monitor", "admin/admin-billing-analytics", "admin/admin-billing-management", "admin/customer-report-review", "admin/system-announcement-admin", "admin/admin-connections", "admin/admin-webhook-events", "admin/admin-channel-health", "admin/admin-security-center", "billing/manual-payment-admin"]) aliases[`@/components/${panelModule}$`] = panels;
  aliases["@"] = root;
  await new Promise((resolve, reject) => webpack({
    mode: "development", devtool: false, optimization: { minimize: false }, entry: path.join(root, "tests/fixtures/admin-navigation-browser.entry.cjs"), output: { path: temp, filename: "bundle.js" },
    resolve: { extensions: [".ts", ".tsx", ".js", ".cjs"], alias: aliases, modules: [path.join(root, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const css = (await postcss([tailwind({ base: root, optimize: false })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  fs.writeFileSync(path.join(temp, "fixture.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin navigation regression fixture</title><style>${css}</style><style>html,body{margin:0}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 40000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }), target = path.join(evidence, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(shot.data, "base64")); return target;
}
async function key(key, code = key, modifiers = 0) {
  const windowsVirtualKeyCode = key === "Tab" ? 9 : key === "Escape" ? 27 : undefined;
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode });
  await pause(45);
}
async function clickPoint(point) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  await pause(50);
}
async function dimensions(width, height = 1000) { await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); await pause(60); }
async function navigate(url) {
  await evaluate("window.adminNavigationFixture = null");
  await send("Page.navigate", { url });
  for (let attempt = 0; attempt < 120; attempt++) { if (await evaluate("Boolean(window.adminNavigationFixture)")) return; await pause(30); }
  throw new Error("Navigation fixture did not mount");
}
async function run() {
  fs.mkdirSync(evidence, { recursive: true }); await build();
  const assets = { "/bundle.js": [path.join(temp, "bundle.js"), "application/javascript; charset=utf-8"], "/images/tenh_logo.png": [path.join(root, "public/images/tenh_logo.png"), "image/png"] };
  server = http.createServer((request, response) => {
    const route = new URL(request.url, "http://127.0.0.1").pathname;
    const asset = route === "/fixture.html" || route === "/dashboard/admin" || route.startsWith("/dashboard/admin/") ? [path.join(temp, "fixture.html"), "text/html; charset=utf-8"] : assets[route];
    if (!asset) { response.writeHead(route === "/favicon.ico" ? 204 : 404); response.end(); return; }
    response.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-store" }); fs.createReadStream(asset[0]).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executable = [process.env.TENH_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find(fs.existsSync);
  assert.ok(executable, "Chrome or Edge is required");
  const profile = path.join(temp, "browser-profile");
  chrome = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  chrome.on("error", error => browserErrors.push(error.message));
  const marker = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !fs.existsSync(marker); attempt++) await pause(100);
  assert.ok(fs.existsSync(marker), "Browser debugging endpoint started");
  const port = fs.readFileSync(marker, "utf8").split(/\r?\n/)[0], tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") browserErrors.push(message.params.args.map(arg => arg.value || arg.description).join(" "));
    if (message.method === "Network.requestWillBeSent") network.push(message.params.request.url);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
  for (const language of ["en", "km"]) for (const width of [1440, 1024, 768, 390]) {
    await dimensions(width);
    await navigate(`${origin}/dashboard/admin?tab=overview&lang=${language}`);
    const navigation = await evaluate("window.adminNavigationFixture.runNavigationChecks()");
    const lightScreenshot = await screenshot(`${language}-${width}-light`);
    let drawerChecks = null, shortDrawerScreenshot = null, openDrawerScreenshot = null, safeArea = null;
    if (width < 1280) {
      if (width === 390 || width === 1024) {
        await dimensions(width, width === 390 ? 844 : 768);
        await evaluate("window.adminNavigationFixture.openDrawer().then(() => { document.querySelector('[data-admin-drawer] [data-admin-navigation]').scrollTop = 0; })");
        openDrawerScreenshot = await screenshot(`${language}-${width}-open-drawer-light`);
        await evaluate("window.adminNavigationFixture.closeDrawer()");
        await dimensions(width);
      }
      safeArea = await evaluate("window.adminNavigationFixture.checkSafeArea()");
      drawerChecks = await evaluate("window.adminNavigationFixture.prepareDrawerChecks()");
      await evaluate('window.adminNavigationFixture.focusBoundary("last")'); await key("Tab"); await evaluate('window.adminNavigationFixture.assertFocusBoundary("first")');
      await evaluate('window.adminNavigationFixture.focusBoundary("first")'); await key("Tab", "Tab", 8); await evaluate('window.adminNavigationFixture.assertFocusBoundary("last")');
      await key("Escape"); await evaluate('window.adminNavigationFixture.assertClosed("Escape")');
      await evaluate("window.adminNavigationFixture.openDrawer()"); await evaluate("window.adminNavigationFixture.closeDrawer()"); await evaluate('window.adminNavigationFixture.assertClosed("Close button")');
      await evaluate("window.adminNavigationFixture.openDrawer()"); await clickPoint(await evaluate("window.adminNavigationFixture.drawerBackdropPoint()")); await evaluate('window.adminNavigationFixture.assertClosed("Backdrop")');
      await dimensions(width, 480); await evaluate("window.adminNavigationFixture.checkShortDrawer()");
      shortDrawerScreenshot = await screenshot(`${language}-${width}-short-drawer`);
      await dimensions(1440); await evaluate("window.adminNavigationFixture.assertResizeClosed()");
      await dimensions(width);
    }
    const themeEvidence = [];
    for (const theme of ["dark", "dim"]) {
      const result = await evaluate(`window.adminNavigationFixture.setTheme(${JSON.stringify(theme)})`);
      themeEvidence.push({ ...result, screenshot: await screenshot(`${language}-${width}-${theme}`) });
      if (width < 1280) await evaluate("window.adminNavigationFixture.closeDrawer()");
    }
    const result = await evaluate("window.adminNavigationFixture.result()");
    assert.ok(result.checks.every(check => check.passed));
    reports.push({ language, width, navigation, drawerChecks, safeArea, lightScreenshot, openDrawerScreenshot, shortDrawerScreenshot, themeEvidence, ...result });
    fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: false, complete: false, reports, browserErrors, network, temp }, null, 2));
    console.log(`${language}/${width}px: ${result.checks.length} assertions passed`);
  }
  const directRoutes = [];
  for (const [route, expected] of [["/dashboard/admin", "overview"], ["/dashboard/admin?tab=overview", "overview"], ["/dashboard/admin?tab=manual-payments", "manual-payments"], ["/dashboard/admin?tab=connections", "connections"], ["/dashboard/admin?tab=security", "security"], ["/dashboard/admin/mfa", "security"], ["/dashboard/admin/nested?tab=overview", "overview"], ["/dashboard/admin/mfa/setup?tab=overview", "security"]]) {
    await dimensions(1440); await navigate(`${origin}${route}`); await evaluate(`window.adminNavigationFixture.assertDirect(${JSON.stringify(expected)})`);
    directRoutes.push({ route, expected, result: await evaluate("window.adminNavigationFixture.result()") });
  }
  assert.deepEqual(browserErrors, [], "No browser runtime errors");
  assert.ok(network.every(url => url.startsWith(`${origin}/`) || url === "about:blank" || url.startsWith("data:")), "Page network stays localhost-only");
  fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: true, complete: true, reports, directRoutes, browserErrors, network, temp }, null, 2));
  fs.rmSync(path.join(evidence, "browser-failure.json"), { force: true });
  fs.rmSync(path.join(evidence, "browser-failure.png"), { force: true });
  console.log(JSON.stringify({ passed: true, cases: reports.length, directRoutes: directRoutes.length, assertions: reports.reduce((total, report) => total + report.checks.length, 0) + directRoutes.reduce((total, route) => total + route.result.checks.length, 0), evidence, temp }));
}
const timeout = setTimeout(() => { console.error("Admin navigation browser regression timed out"); socket?.close(); chrome?.kill(); server?.close(); process.exitCode = 1; }, 240000);
run().catch(async error => {
  fs.mkdirSync(evidence, { recursive: true });
  const state = socket?.readyState === WebSocket.OPEN ? await evaluate("window.adminNavigationFixture?.result()").catch(() => null) : null;
  const failureScreenshot = socket?.readyState === WebSocket.OPEN ? await screenshot("browser-failure").catch(() => null) : null;
  fs.writeFileSync(path.join(evidence, "browser-failure.json"), JSON.stringify({ passed: false, error: error.stack, state, reports, browserErrors, network, temp, failureScreenshot }, null, 2));
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  clearTimeout(timeout);
  if (socket?.readyState === WebSocket.OPEN) { await send("Browser.close").catch(() => {}); socket.close(); }
  chrome?.kill(); await new Promise(resolve => server ? server.close(resolve) : resolve());
});
