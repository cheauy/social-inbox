/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs"), path = require("node:path"), { spawn } = require("node:child_process");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = path.join(process.env.TEMP, `tenh-storage-browser-profile-${Date.now()}`);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--disable-background-networking", "--no-first-run",
  "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let socket, id = 0;
const pending = new Map();
const browserEvents = [];
const guard = setTimeout(() => { console.error("Storage browser fixture timed out"); socket?.close(); chrome.kill(); process.exitCode = 1; }, 60000);

(async () => {
  try {
    let port;
    for (let attempt = 0; attempt < 60; attempt++) {
      await wait(100);
      const marker = path.join(profile, "DevToolsActivePort");
      if (fs.existsSync(marker)) { port = fs.readFileSync(marker, "utf8").split(/\r?\n/)[0]; break; }
    }
    if (!port) throw new Error("No Chrome debugging port");
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const tab = tabs.find(item => item.type === "page");
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
      const result = JSON.parse(event.data);
      if (result.method === "Runtime.exceptionThrown") browserEvents.push(result.params?.exceptionDetails?.exception?.description || result.params?.exceptionDetails?.text || "Browser exception");
      if (result.method === "Runtime.consoleAPICalled" && result.params?.type === "error") browserEvents.push((result.params.args || []).map(item => item.value || item.description).join(" "));
      if (!pending.has(result.id)) return;
      const task = pending.get(result.id); pending.delete(result.id);
      if (result.error) task.reject(new Error(result.error.message));
      else task.resolve(result.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    await send("Runtime.enable");

    for (const [name, width] of [["desktop", 1280], ["mobile-390", 390], ["mobile-320", 320]]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url: "http://127.0.0.1:8768/tenh-workspace-storage-browser.html" });
      let raw = "";
      for (let attempt = 0; attempt < 150; attempt++) {
        await wait(40);
        raw = await evaluate("document.getElementById('result')?.textContent || ''");
        if (raw) break;
      }
      if (!raw) throw new Error(`${name}: fixture did not finish`);
      const result = JSON.parse(raw);
      if (!result.passed) throw new Error(`${name}: ${JSON.stringify({ ...result, browserEvents })}`);
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(process.env.TEMP, `tenh-workspace-storage-${name}.png`), Buffer.from(screenshot.data, "base64"));
      console.log(JSON.stringify({ viewport: name, width, columns: result.columns, checks: result.checks.length, mutations: result.mutations }));
    }
    await send("Browser.close").catch(() => {});
    socket.close(); clearTimeout(guard);
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
    if (socket) { try { socket.send(JSON.stringify({ id: ++id, method: "Browser.close" })); } catch {} socket.close(); }
    chrome.kill(); clearTimeout(guard);
  }
})();
