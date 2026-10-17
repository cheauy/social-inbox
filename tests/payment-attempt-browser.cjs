/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const bakongMode = process.env.TENH_PAYMENT_BROWSER_MODE === "bakong";
const retirementMode = process.env.TENH_PAYMENT_BROWSER_MODE === "retirement";
const serveDemo = bakongMode && process.argv.includes("--serve");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tenh-payment-attempt-"));
const evidence = path.resolve(process.env.TENH_PAYMENT_ATTEMPT_EVIDENCE || path.join(root, "docs/evidence/payment-attempt-20261015/browser"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [], browserErrors = [], network = [], pending = new Map();
let server, chrome, socket, nextId = 0;

async function build() {
  const webpack = require(path.join(root, "node_modules/next/dist/compiled/webpack/webpack")).webpack;
  const postcss = require("postcss"), tailwind = require("@tailwindcss/postcss");
  const loader = path.join(temp, "typescript-loader.cjs"), language = path.join(temp, "language.cjs"), image = path.join(temp, "image.cjs"), navigation = path.join(temp, "navigation.cjs"), script = path.join(temp, "script.cjs"), supabase = path.join(temp, "supabase.cjs");
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(path.join(root, "node_modules/typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  fs.writeFileSync(language, "exports.useWorkspaceLanguageId=()=>window.fixtureLanguage;");
  fs.writeFileSync(image, 'const React=require("react");module.exports=function Image({priority,fill,quality,loader,unoptimized,...props}){return React.createElement("img",props)};');
  fs.writeFileSync(navigation, 'exports.useRouter=()=>window.fixtureRouter;exports.useSearchParams=()=>new URLSearchParams(window.location.search);');
  fs.writeFileSync(script, 'const React=require("react");module.exports=function Script(props){React.useEffect(()=>{props.onReady?.()},[]);return null};');
  fs.writeFileSync(supabase, 'exports.createClient=()=>window.fixtureSupabase;');
  const link = path.join(temp, "link.cjs");
  fs.writeFileSync(link, 'const React=require("react");module.exports=function Link({href,children,...props}){return React.createElement("a",{...props,href},children)};');
  let qrImage = "";
  if (bakongMode) {
    const { BakongKHQR, MerchantInfo, khqrData } = require("bakong-khqr");
    const generated = new BakongKHQR().generateMerchant(new MerchantInfo("merchant@devb", "TENH CHAT", "Phnom Penh", "12345", "DEV BANK",
      { currency: khqrData.currency.usd, amount: 13, billNumber: "TC-SYNTHETIC-UI", expirationTimestamp: Date.now() + 900000 }));
    assert.equal(generated.status.code, 0);
    qrImage = await require("qrcode").toDataURL(serveDemo ? "TENH-LOCAL-DEMO-NOT-FOR-PAYMENT" : generated.data.qr, { width: 280, margin: 2 });
  }
  await new Promise((resolve, reject) => webpack({
    mode: "development", devtool: false, optimization: { minimize: false }, entry: path.join(root, `tests/fixtures/${retirementMode ? "bakong-retirement-browser" : bakongMode ? "bakong-browser" : "payment-attempt-browser"}.entry.cjs`), output: { path: temp, filename: "bundle.js" },
    resolve: { extensions: [".ts", ".tsx", ".js", ".cjs"], alias: { "next/image$": image, "next/link$": link, "next/navigation$": navigation, "next/script$": script, "@/lib/supabase/client$": supabase, "@/components/display/workspace-language-text$": language, "@": root }, modules: [path.join(root, "node_modules"), "node_modules"] },
    plugins: [new webpack.DefinePlugin({ "process.env.TENH_TEST_BAKONG_QR_IMAGE": JSON.stringify(qrImage), "process.env.TENH_TEST_BAKONG_DEMO": JSON.stringify(serveDemo ? "true" : "false") })],
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const css = (await postcss([tailwind({ base: root, optimize: false })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const demoBanner = serveDemo ? '<aside class="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 p-3 text-center text-sm font-bold text-amber-950" role="status">LOCAL DEMO · Simulated payments only · Do not send money. <a class="inline-flex min-h-11 items-center rounded-lg border border-amber-700 px-3 underline focus-visible:outline-2" href="/fixture.html?reset=1">Restart demo</a></aside>' : "";
  fs.writeFileSync(path.join(temp, "fixture.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${serveDemo ? "TENH CHAT — Local payment demo" : "Payment attempt browser regression fixture"}</title><style>${css}</style><style>html,body{margin:0}</style></head><body>${demoBanner}<div id="root"></div><script src="/bundle.js"></script></body></html>`);
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
    "/images/custom.png": [path.join(root, "public/images/custom.png"), "image/png"],
    "/images/tenh_logo.png": [path.join(root, "public/images/tenh_logo.png"), "image/png"],
    "/images/channels/telegram.png": [path.join(root, "public/images/channels/telegram.png"), "image/png"],
    "/images/channels/messenger.png": [path.join(root, "public/images/channels/messenger.png"), "image/png"],
  };
  if (serveDemo) { assets["/"] = assets["/fixture.html"]; assets["/dashboard/subscription"] = assets["/fixture.html"]; }
  server = http.createServer((request, response) => {
    const route = new URL(request.url, "http://127.0.0.1").pathname, asset = assets[route];
    if(!serveDemo && route==="/dashboard/subscription"){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});response.end('<!doctype html><html><body><main data-subscription-after-expiry>Subscription</main></body></html>');return;}
    if (!asset) { response.writeHead(route === "/favicon.ico" ? 204 : 404); response.end(); return; }
    response.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-store", ...(serveDemo ? { "Content-Security-Policy": "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'" } : {}) }); fs.createReadStream(asset[0]).pipe(response);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(serveDemo ? 3005 : 0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (serveDemo) {
    console.log(`Local simulated Bakong checkout: ${origin}/fixture.html`);
    console.log("No Supabase or bank connection. The QR is not a payment QR. Press Ctrl+C to stop.");
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
    return;
  }
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
    await send("Page.navigate", { url: `${origin}/fixture.html?lang=${language}&width=${width}` });
    if (retirementMode) {
      for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate("Boolean(window.retirementFixture)")) break; await pause(30); }
      await evaluate("window.retirementFixture.check()");
      const methodsScreenshot = await screenshot(`${language}-${width}-methods`);
      await evaluate("window.retirementFixture.manual()");
      const manualScreenshot = await screenshot(`${language}-${width}-manual`);
      const result = await evaluate("window.retirementFixture.result()");
      reports.push({ language, width, methodsScreenshot, manualScreenshot, ...result });
      console.log(`${language}/${width}px: ${result.checks.length} retirement assertions passed`);
      continue;
    }
    if (bakongMode) {
      for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate("Boolean(window.bakongFixture)")) break; await pause(30); }
      assert.equal(await evaluate("Boolean(window.bakongFixture)"), true, "Bakong fixture mounted");
      await evaluate("window.bakongFixture.checkoutChecks(false)");
      const methodsScreenshot = await screenshot(`${language}-${width}-methods`);
      await evaluate("window.bakongFixture.checkoutChecks()");
      const pendingScreenshot = await screenshot(`${language}-${width}-pending`);
      const beforeReload = await evaluate("window.bakongFixture.result()");
      await send("Page.reload", { ignoreCache: true });
      for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate("Boolean(window.bakongFixture)")) break; await pause(30); }
      await evaluate("window.bakongFixture.reloadChecks()");
      await evaluate("window.bakongFixture.stateChecks()");
      const reviewScreenshot = await screenshot(`${language}-${width}-review`);
      await evaluate("window.bakongFixture.pollChecks()");
      const expiredScreenshot = await screenshot(`${language}-${width}-expired`);
      await evaluate("window.bakongFixture.isolationChecks()");
      const deniedScreenshot = await screenshot(`${language}-${width}-denied`);
      const result = await evaluate("window.bakongFixture.result()");
      result.checks = [...beforeReload.checks, ...result.checks];
      assert.ok(result.checks.every(check => check.passed));
      reports.push({ language, width, methodsScreenshot, pendingScreenshot, reviewScreenshot, expiredScreenshot, deniedScreenshot, ...result });
      fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: false, complete: false, reports, browserErrors, network, temp }, null, 2));
      console.log(`${language}/${width}px: ${result.checks.length} Bakong assertions passed`);
      continue;
    }
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate("Boolean(window.paymentAttemptFixture)")) break; await pause(30); }
    assert.equal(await evaluate("Boolean(window.paymentAttemptFixture)"), true, "Fixture mounted");
    const submission = await evaluate("window.paymentAttemptFixture.submissionChecks()");
    const submittedScreenshot = await screenshot(`${language}-${width}-submitted`);
    const beforeReload = await evaluate("window.paymentAttemptFixture.result()");
    await evaluate("window.paymentAttemptFixture.prepareReload()");
    await send("Page.reload", { ignoreCache: true });
    await pause(100);
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate("Boolean(window.paymentAttemptFixture)")) break; await pause(30); }
    await evaluate("window.paymentAttemptFixture.reloadChecks()");
    await evaluate("window.paymentAttemptFixture.statusChecks()");
    const terminalScreenshot = await screenshot(`${language}-${width}-historical-stale-isolation`);
    await evaluate("window.paymentAttemptFixture.successChecks()");
    const successScreenshot = await screenshot(`${language}-${width}-success`);
    await evaluate("window.paymentAttemptFixture.navigationChecks()");
    await evaluate("window.paymentAttemptFixture.preparedChecks()");
    const validationScreenshot = await screenshot(`${language}-${width}-proof-validation`);
    await evaluate("window.paymentAttemptFixture.paywayChecks()");
    const paywayScreenshot = await screenshot(`${language}-${width}-payway-pending`);
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await evaluate("window.paymentAttemptFixture.motionChecks()");
    await send("Emulation.setEmulatedMedia", { features: [] });
    const result = await evaluate("window.paymentAttemptFixture.result()");
    result.checks = [...beforeReload.checks, ...result.checks];
    assert.ok(result.checks.every(check => check.passed));
    await evaluate("paymentAttemptFixture.popupCloseChecks()");
    const closedScreenshot=await screenshot(`${language}-${width}-payway-closed`);
    await evaluate("paymentAttemptFixture.sandboxDetailsChecks()");
    const detailsScreenshot=await screenshot(`${language}-${width}-payway-sandbox-details`);
    await evaluate("paymentAttemptFixture.manualModalPreview()");
    const manualModalScreenshot=await screenshot(`${language}-${width}-manual-transfer-popup`);
    await evaluate("paymentAttemptFixture.prepareBuy()");
    const buyScreenshot=await screenshot(`${language}-${width}-buy-preflight`);
    await evaluate("paymentAttemptFixture.openBuyChooser()");
    const chooserScreenshot=await screenshot(`${language}-${width}-buy-method-chooser`);
    await evaluate("paymentAttemptFixture.finishBuy()");
    const completed=await evaluate("paymentAttemptFixture.result()");
    completed.checks=[...beforeReload.checks,...completed.checks];
    assert.ok(completed.checks.every(check=>check.passed));
    const providerUI=await evaluate("paymentAttemptFixture.prepareExpiryOverlay()");
    assert.ok(providerUI.overlayMounted&&providerUI.bodyLocked,"provider iframe owns an overlay and body lock before expiry");
    let expiryNavigation;
    for(let attempt=0;attempt<120;attempt++){
      await pause(50);
      try{expiryNavigation=await evaluate("({path:location.pathname,replaced:Boolean(document.querySelector('[data-subscription-after-expiry]')),overlay:Boolean(document.querySelector('#aba-checkout,iframe[name=aba_webservice]')),bodyLocked:getComputedStyle(document.body).overflowY==='hidden'})");}catch{continue;}
      if(expiryNavigation.replaced)break;
    }
    assert.ok(expiryNavigation?.replaced&&expiryNavigation.path==='/dashboard/subscription',"expiry replaces the whole document with Subscription");
    assert.ok(!expiryNavigation.overlay&&!expiryNavigation.bodyLocked,"provider iframe and scrolling lock are absent after expiry");
    completed.checks.push({name:'expiry replaces full document with Subscription',passed:true},{name:'provider iframe and body scroll lock disappear after expiry',passed:true});
    const expiryScreenshot=await screenshot(`${language}-${width}-expiry-subscription`);
    await send("Page.navigate", { url: `${origin}/fixture.html?lang=${language}&width=${width}` });
    for(let attempt=0;attempt<100;attempt++){await pause(40);try{if(await evaluate("Boolean(window.paymentAttemptFixture)"))break;}catch{}}
    await evaluate("paymentAttemptFixture.prepareCancelOverlay()");
    let cancelNavigation;
    for(let attempt=0;attempt<120;attempt++){
      await pause(40);try{cancelNavigation=await evaluate("({path:location.pathname,replaced:Boolean(document.querySelector('[data-subscription-after-expiry]')),overlay:Boolean(document.querySelector('#aba-checkout,iframe[name=aba_webservice]')),bodyLocked:getComputedStyle(document.body).overflowY==='hidden'})");}catch{continue;}
      if(cancelNavigation.replaced)break;
    }
    assert.ok(cancelNavigation?.replaced&&cancelNavigation.path==='/dashboard/subscription'&&!cancelNavigation.overlay&&!cancelNavigation.bodyLocked,"Cancel replaces document and clears provider overlay and scrolling lock");
    completed.checks.push({name:'Cancel returns to Subscription without an iframe or body scroll lock',passed:true});
    const cancelScreenshot=await screenshot(`${language}-${width}-cancel-subscription`);
    await send("Page.navigate", { url: `${origin}/fixture.html?lang=${language}&width=${width}` });
    for(let attempt=0;attempt<100;attempt++){await pause(40);try{if(await evaluate("Boolean(window.paymentAttemptFixture)"))break;}catch{}}
    await evaluate("paymentAttemptFixture.prepareDismissOverlay()");
    let dismissNavigation;
    for(let attempt=0;attempt<120;attempt++){
      await pause(40);try{dismissNavigation=await evaluate("({path:location.pathname,replaced:Boolean(document.querySelector('[data-subscription-after-expiry]')),overlay:Boolean(document.querySelector('#aba-checkout,iframe[name=aba_webservice]')),bodyLocked:getComputedStyle(document.body).overflowY==='hidden',saved:JSON.parse(sessionStorage.getItem('payment-attempt-fixture')||'null')})");}catch{continue;}
      if(dismissNavigation.replaced)break;
    }
    const dismissed=dismissNavigation?.saved?.attempts?.find(([key])=>key==='payway:fixture-dismiss')?.[1];
    assert.ok(dismissNavigation?.replaced&&dismissNavigation.path==='/dashboard/subscription'&&!dismissNavigation.overlay&&!dismissNavigation.bodyLocked&&dismissed?.status==='pending'&&dismissed.checkoutSessionClosedAt,"QR dismissal saves checkout-only closure before returning without provider overlay");
    completed.checks.push({name:'QR dismissal persists session end while retaining financial pending audit row',passed:true});
    reports.push({ language, width, submission, submittedScreenshot, successScreenshot, terminalScreenshot, validationScreenshot, paywayScreenshot, closedScreenshot, detailsScreenshot, buyScreenshot, chooserScreenshot, expiryScreenshot, cancelScreenshot, manualModalScreenshot, ...completed });
    fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: false, complete: false, reports, browserErrors, network, temp }, null, 2));
    console.log(`${language}/${width}px: ${completed.checks.length} assertions passed`);
  }
  assert.deepEqual(browserErrors, [], "No browser runtime errors");
  assert.ok(network.every(url => url.startsWith(`${origin}/`) || url === "about:blank" || url.startsWith("data:")), `Unexpected network: ${network.filter(url => !url.startsWith(`${origin}/`)).join(", ")}`);
  fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: true, complete: true, reports, browserErrors, network, temp }, null, 2));
  fs.rmSync(path.join(evidence, "browser-failure.json"), { force: true });
  fs.rmSync(path.join(evidence, "browser-failure.png"), { force: true });
  console.log(JSON.stringify({ passed: true, cases: reports.length, assertions: reports.reduce((total, report) => total + report.checks.length, 0), evidence, temp }));
}
const timeout = serveDemo ? undefined : setTimeout(() => { console.error("Payment attempt browser regression timed out"); socket?.close(); chrome?.kill(); server?.close(); process.exitCode = 1; }, 300000);
run().catch(async error => {
  fs.mkdirSync(evidence, { recursive: true });
  const state = socket?.readyState === WebSocket.OPEN ? await evaluate("window.paymentAttemptFixture?.result()").catch(() => null) : null;
  const failureScreenshot = socket?.readyState === WebSocket.OPEN ? await screenshot("browser-failure").catch(() => null) : null;
  fs.writeFileSync(path.join(evidence, "browser-failure.json"), JSON.stringify({ passed: false, error: error.stack, state, reports, browserErrors, network, temp, failureScreenshot }, null, 2));
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  clearTimeout(timeout);
  if (socket?.readyState === WebSocket.OPEN) { await send("Browser.close").catch(() => {}); socket.close(); }
  chrome?.kill();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
});
