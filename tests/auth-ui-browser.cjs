/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tenh-auth-ui-"));
const evidence = path.resolve(process.env.TENH_AUTH_UI_EVIDENCE || path.join(root, "docs/evidence/auth-session-20261015/browser"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [], browserErrors = [], network = [], pending = new Map();
let server, chrome, socket, nextId = 0;

async function build() {
  const webpack = require(path.join(root, "node_modules/next/dist/compiled/webpack/webpack")).webpack;
  const postcss = require("postcss"), tailwind = require("@tailwindcss/postcss");
  const loader = path.join(temp, "typescript-loader.cjs"), language = path.join(temp, "language.cjs"), image = path.join(temp, "image.cjs"), navigation = path.join(temp, "navigation.cjs"), script = path.join(temp, "script.cjs"), supabase = path.join(temp, "supabase.cjs");
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(path.join(root, "node_modules/typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  fs.writeFileSync(language, 'const React=require("react");exports.useWorkspaceLanguageId=()=>React.useSyncExternalStore(callback=>{window.addEventListener("tenh:display-language-change",callback);return()=>window.removeEventListener("tenh:display-language-change",callback)},()=>window.fixtureLanguage,()=>"en");');
  fs.writeFileSync(image, 'const React=require("react");module.exports=function Image({priority,fill,quality,loader,unoptimized,...props}){return React.createElement("img",props)};');
  fs.writeFileSync(navigation, 'exports.useSearchParams=()=>new URLSearchParams(location.search);');
  fs.writeFileSync(script, 'const React=require("react");module.exports=function Script(props){React.useEffect(()=>{props.onReady?.()},[]);return null};');
  fs.writeFileSync(supabase, 'exports.createClient=()=>window.fixtureSupabase;');
  const link = path.join(temp, "link.cjs");
  fs.writeFileSync(link, 'const React=require("react");module.exports=function Link({href,children,...props}){return React.createElement("a",{...props,href},children)};');
  await new Promise((resolve, reject) => webpack({
    mode: "development", devtool: false, optimization: { minimize: false }, entry: path.join(root, "tests/fixtures/auth-ui-browser.entry.cjs"), output: { path: temp, filename: "bundle.js" },
    resolve: { extensions: [".ts", ".tsx", ".js", ".cjs"], alias: { "next/image$": image, "next/link$": link, "next/navigation$": navigation, "next/script$": script, "@/lib/supabase/client$": supabase, "@/lib/auth/browser-session$": path.join(root, "tests/fixtures/auth-session-navigation.cjs"), "@/components/display/workspace-language-text$": language, "@": root }, modules: [path.join(root, "node_modules"), "node_modules"] },
    plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("https://fixture.supabase.co") })],
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const css = (await postcss([tailwind({ base: root, optimize: false })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  fs.writeFileSync(path.join(temp, "fixture.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authentication UI browser regression fixture</title><style>${css}</style><style>html,body{margin:0}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
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
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const target = path.join(evidence, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(shot.data, "base64"));
  return target;
}
async function run() {
  fs.mkdirSync(evidence, { recursive: true }); await build();
  const assets = {
    "/fixture.html": [path.join(temp, "fixture.html"), "text/html; charset=utf-8"],
    "/bundle.js": [path.join(temp, "bundle.js"), "application/javascript; charset=utf-8"],
    "/images/tenh_logo.png": [path.join(root, "public/images/tenh_logo.png"), "image/png"],
    "/images/background-login.webp": [path.join(root, "public/images/background-login.webp"), "image/webp"],
  };
  server = http.createServer((request, response) => {
    const route = new URL(request.url, "http://127.0.0.1").pathname, asset = assets[route];
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
  const port = fs.readFileSync(marker, "utf8").split(/\r?\n/)[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
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
  for (const language of ["en", "km"]) for (const width of [390, 768, 1024, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${origin}/fixture.html?lang=${language}&width=${width}&next=%2Fdashboard%2Fsettings%2Fsecurity` });
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate("Boolean(window.authUiFixture)")) break; await pause(30); }
    assert.equal(await evaluate("Boolean(window.authUiFixture)"), true, "Fixture mounted");
    const screenshots = {};
    for (const section of ["login", "forgot", "reset", "verification", "admin", "session"]) {
      await evaluate(`window.authUiFixture.${section}Checks()`);
      screenshots[section] = await screenshot(`${language}-${width}-${section}`);
      if (section === "login") {
        await evaluate("document.getElementById('remember-me').click()"); await pause(30);
        screenshots.loginUnchecked = await screenshot(`${language}-${width}-login-unchecked`);
      }
    }
    const result = await evaluate("window.authUiFixture.result()");
    assert.ok(result.checks.every(check => check.passed));
    reports.push({ language, width, screenshots, ...result });
    fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: false, complete: false, reports, browserErrors, network, temp }, null, 2));
    console.log(`${language}/${width}px: ${result.checks.length} assertions passed`);
  }
  assert.deepEqual(browserErrors, [], "No browser runtime errors");
  assert.ok(network.every(url => url.startsWith(`${origin}/`) || url === "about:blank" || url.startsWith("data:")), `Unexpected network: ${network.filter(url => !url.startsWith(`${origin}/`)).join(", ")}`);
  fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: true, complete: true, reports, browserErrors, network, temp }, null, 2));
  fs.rmSync(path.join(evidence, "browser-failure.json"), { force: true });
  fs.rmSync(path.join(evidence, "browser-failure.png"), { force: true });
  console.log(JSON.stringify({ passed: true, cases: reports.length, assertions: reports.reduce((total, report) => total + report.checks.length, 0), evidence, temp }));
}
const timeout = setTimeout(() => { console.error("Authentication UI browser regression timed out"); socket?.close(); chrome?.kill(); server?.close(); process.exitCode = 1; }, 300000);
run().catch(async error => {
  fs.mkdirSync(evidence, { recursive: true });
  const state = socket?.readyState === WebSocket.OPEN ? await evaluate("window.authUiFixture?.result()").catch(() => null) : null;
  const failureScreenshot = socket?.readyState === WebSocket.OPEN ? await screenshot("browser-failure").catch(() => null) : null;
  fs.writeFileSync(path.join(evidence, "browser-failure.json"), JSON.stringify({ passed: false, error: error.stack, state, reports, browserErrors, network, temp, failureScreenshot }, null, 2));
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  clearTimeout(timeout);
  if (socket?.readyState === WebSocket.OPEN) { await send("Browser.close").catch(() => {}); socket.close(); }
  chrome?.kill();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
});
