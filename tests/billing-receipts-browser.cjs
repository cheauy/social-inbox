/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tenh-billing-receipts-"));
const evidence = path.resolve(process.env.TENH_BILLING_EVIDENCE || path.join(root, "docs/evidence/billing-receipts-20261015/browser"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [];
const browserErrors = [];
const network = [];
let server, chrome, socket, nextId = 0;
const pending = new Map();

async function build() {
  const webpack = require(path.join(root, "node_modules/next/dist/compiled/webpack/webpack")).webpack;
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const loader = path.join(temp, "typescript-loader.cjs");
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(path.join(root, "node_modules/typescript"))});module.exports=function(source){return ts.transpileModule(source.replace(/<style jsx global>/g,"<style>"),{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  const link = path.join(temp, "link.cjs"), image = path.join(temp, "image.cjs"), language = path.join(temp, "language.cjs");
  fs.writeFileSync(link, `const React=require("react");module.exports=function Link({children,onClick,...props}){return React.createElement("a",{...props,onClick(event){window.fixtureLinkClicks.push({href:props.href,target:props.target||null});onClick?.(event);event.preventDefault()}},children)};`);
  fs.writeFileSync(image, `const React=require("react");module.exports=function Image({priority,fill,quality,loader,unoptimized,...props}){return React.createElement("img",props)};`);
  fs.writeFileSync(language, `exports.useWorkspaceLanguageId=()=>window.fixtureLanguage;`);
  await new Promise((resolve, reject) => webpack({
    mode: "development", devtool: false, optimization: { minimize: false },
    entry: path.join(root, "tests/fixtures/billing-receipts-browser.entry.cjs"),
    output: { path: temp, filename: "bundle.js" },
    resolve: { extensions: [".ts", ".tsx", ".js", ".cjs"], alias: {
      "next/link$": link, "next/image$": image, "@/components/display/workspace-language-text$": language, "@": root,
    }, modules: [path.join(root, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const css = (await postcss([tailwind({ base: root, optimize: false })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  fs.writeFileSync(path.join(temp, "fixture.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TENH billing browser regression fixture</title><style>${css}</style><style>html,body{margin:0}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
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
  fs.mkdirSync(evidence, { recursive: true });
  await build();
  const assets = {
    "/fixture.html": [path.join(temp, "fixture.html"), "text/html; charset=utf-8"],
    "/bundle.js": [path.join(temp, "bundle.js"), "application/javascript; charset=utf-8"],
    "/images/tenh_logo.png": [path.join(root, "public/images/tenh_logo.png"), "image/png"],
  };
  server = http.createServer((request, response) => {
    const route = new URL(request.url, "http://127.0.0.1").pathname;
    const asset = assets[route];
    if (!asset) { response.writeHead(route === "/favicon.ico" ? 204 : 404); response.end(); return; }
    response.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-store" });
    fs.createReadStream(asset[0]).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executable = [process.env.TENH_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find(fs.existsSync);
  assert.ok(executable, "Chrome or Edge is required");
  const profile = path.join(temp, "browser-profile");
  chrome = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  chrome.on("error", error => { browserErrors.push(error.message); });
  const marker = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !fs.existsSync(marker); attempt++) await pause(100);
  assert.ok(fs.existsSync(marker), "Browser debugging endpoint started");
  const port = fs.readFileSync(marker, "utf8").split(/\r?\n/)[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") browserErrors.push(message.params.args.map(arg => arg.value || arg.description).join(" "));
    if (message.method === "Network.requestWillBeSent") network.push(message.params.request.url);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  for (const language of ["en", "km"]) for (const [viewport, width] of [["desktop", 1280], ["tablet", 768], ["mobile", 390]]) {
    await send("Emulation.setEmulatedMedia", { media: "screen" });
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate("window.billingFixture = null");
    await send("Page.navigate", { url: `${origin}/fixture.html?lang=${language}&viewport=${viewport}` });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate("Boolean(window.billingFixture)")) break;
      await pause(30);
    }
    assert.equal(await evaluate("Boolean(window.billingFixture)"), true, "Fixture mounted");
    const history = await evaluate("window.billingFixture.runHistoryChecks()");
    const historyScreenshot = await screenshot(`${language}-${viewport}-history`);
    const receipt = await evaluate("window.billingFixture.runReceiptChecks()");
    const receiptScreenshot = await screenshot(`${language}-${viewport}-receipt`);
    await send("Emulation.setEmulatedMedia", { media: "print" });
    const print = await evaluate(`(() => { const visible=element=>Boolean(element&&element.getClientRects().length&&getComputedStyle(element).display!=="none"&&getComputedStyle(element).visibility!=="hidden");const card=document.querySelector(".tenh-receipt-card");return {card:visible(card),header:visible(card?.querySelector("header")),testLabel:visible(card?.querySelector(".tenh-receipt-test")),nav:[...document.querySelectorAll("[data-fixture-app-nav]")].some(visible),toolbar:[...document.querySelectorAll(".tenh-receipt-toolbar, .tenh-receipt-card button")].some(visible),text:document.body.innerText,width:card?.getBoundingClientRect().width,overflow:card?.scrollWidth>card?.clientWidth+1};})()`);
    assert.ok(print.card && print.header && print.testLabel && !print.nav && !print.toolbar && !print.overflow, `${language}-${viewport}: print shows only readable receipt: ${JSON.stringify(print)}`);
    assert.ok(print.text.includes(language === "km" ? "ការទូទាត់សាកល្បង" : "Test payment"));
    let pdfPath = null, printScreenshot = null;
    if (viewport === "desktop") {
      printScreenshot = await screenshot(`${language}-print-preview`);
      const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.3, marginBottom: 0.3, marginLeft: 0.3, marginRight: 0.3 });
      pdfPath = path.join(evidence, `${language}-sandbox-receipt.pdf`);
      fs.writeFileSync(pdfPath, Buffer.from(pdf.data, "base64"));
    }
    const nullablePlanPrint = [];
    for (const variant of ["null", "missing"]) {
      await send("Emulation.setEmulatedMedia", { media: "screen" });
      await evaluate(`window.billingFixture.plan(${JSON.stringify(variant)})`);
      await send("Emulation.setEmulatedMedia", { media: "print" });
      const planPrint = await evaluate(`(() => { const card=document.querySelector(".tenh-receipt-card");return {variant:${JSON.stringify(variant)},visible:Boolean(card?.getClientRects().length),text:document.body.innerText,headerVisible:Boolean(card?.querySelector("header")?.getClientRects().length)};})()`);
      assert.ok(planPrint.visible && planPrint.headerVisible && planPrint.text.includes("TENH Chat —") && !planPrint.text.includes("Fixture app navigation"), `${language}-${viewport}: ${variant} plan remains printable`);
      nullablePlanPrint.push(planPrint);
    }
    await send("Emulation.setEmulatedMedia", { media: "screen" });
    await evaluate("window.billingFixture.error(404)");
    await send("Emulation.setEmulatedMedia", { media: "print" });
    const errorPrintText = await evaluate("document.body.innerText.trim()");
    assert.equal(errorPrintText, "", `${language}-${viewport}: errors and app navigation must not print`);
    const result = await evaluate("window.billingFixture.result()");
    assert.ok(result.checks.every(check => check.passed));
    reports.push({ language, viewport, width, history, receipt, print, nullablePlanPrint, errorPrintBlank: true, historyScreenshot, receiptScreenshot, printScreenshot, pdfPath, ...result });
    fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: false, complete: false, completedCases: reports.length, reports, browserErrors, network, temp }, null, 2));
    console.log(`${language}/${viewport} ${width}px: ${result.checks.length} assertions passed; receipt-only print passed`);
  }
  assert.deepEqual(browserErrors, [], "No browser runtime errors");
  assert.ok(network.every(url => url.startsWith(`${origin}/`) || url === "about:blank" || url.startsWith("data:")), `Unexpected network: ${network.filter(url => !url.startsWith(`${origin}/`)).join(", ")}`);
  fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify({ passed: true, complete: true, completedCases: reports.length, reports, browserErrors, network, temp }, null, 2));
  fs.rmSync(path.join(evidence, "browser-failure.json"), { force: true });
  console.log(JSON.stringify({ passed: true, cases: reports.length, assertions: reports.reduce((total, report) => total + report.checks.length, 0), evidence, temp, pdfs: reports.map(report => report.pdfPath).filter(Boolean) }));
}

const timeout = setTimeout(() => { console.error("Billing receipt browser regression timed out"); socket?.close(); chrome?.kill(); server?.close(); process.exitCode = 1; }, 180000);
run().catch(async error => {
  const state = socket?.readyState === WebSocket.OPEN ? await evaluate("window.billingFixture?.result()").catch(() => null) : null;
  fs.mkdirSync(evidence, { recursive: true });
  const failureScreenshot = socket?.readyState === WebSocket.OPEN ? await screenshot("browser-failure").catch(() => null) : null;
  fs.writeFileSync(path.join(evidence, "browser-failure.json"), JSON.stringify({ passed: false, error: error.stack, state, reports, browserErrors, network, temp, failureScreenshot }, null, 2));
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  clearTimeout(timeout);
  if (socket?.readyState === WebSocket.OPEN) { await send("Browser.close").catch(() => {}); socket.close(); }
  chrome?.kill();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
});
