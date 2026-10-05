const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const output = process.env.FACEBOOK_CONTEXT_ARTIFACT_DIR || path.join(process.env.TEMP, 'tenh-facebook-comment-context');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = path.join(process.env.TEMP, `tenh-fb-comment-check-${Date.now()}`);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, next = 0; const pending = new Map(), errors = [];
const guard = setTimeout(() => { socket?.close(); chrome.kill(); console.error('Facebook context browser timed out'); process.exitCode = 1; }, 45000);
(async () => { try {
  let port; for (let attempt = 0; attempt < 80; attempt++) { await pause(100); const marker = path.join(profile, 'DevToolsActivePort'); if (fs.existsSync(marker)) { port = fs.readFileSync(marker, 'utf8').split(/\r?\n/)[0]; break; } }
  if (!port) throw Error('No Chrome debugging port');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.onmessage = event => { const result = JSON.parse(event.data);
    if (result.id && pending.has(result.id)) { const { resolve, reject } = pending.get(result.id); pending.delete(result.id); result.error ? reject(Error(result.error.message)) : resolve(result.result); }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails.text);
    if (result.method === 'Fetch.requestPaused') {
      // Local synthetic image; no Facebook/CDN or provider network is used.
      const second = result.params.request.url.endsWith('/b.png');
      const image = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="${second ? '#dbeafe' : '#ffedd5'}"/><text x="80" y="90" text-anchor="middle" font-family="Arial" font-size="36" fill="#334155">${second ? 'B' : 'A'}</text></svg>`).toString('base64');
      void send('Fetch.fulfillRequest', { requestId: result.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }], body: image });
    }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }, { urlPattern: 'http://*' }] });
  const reports = [];
  for (const [name, width, height] of [['desktop', 1200, 900], ['mobile', 390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name === 'mobile' });
    await send('Page.navigate', { url: 'file:///' + path.join(output, 'browser.html').replaceAll('\\', '/') });
    let result; for (let attempt = 0; attempt < 100; attempt++) { await pause(100); const read = await send('Runtime.evaluate', { expression: 'window.checkFacebookContext?.()', returnByValue: true }); if (read.result?.value?.checks?.length) { result = read.result.value; if (result.success) break; } }
    if (!result) throw Error('Fixture did not render'); reports.push({ viewport: name, ...result });
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(output, `browser-${name}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  const report = { success: reports.every(r => r.success) && errors.length === 0, reports, errors };
  fs.writeFileSync(path.join(output, 'browser-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); if (!report.success) process.exitCode = 1;
  await send('Browser.close').catch(() => {});
} catch (error) { console.error(error.message); process.exitCode = 1; } finally { clearTimeout(guard); socket?.close(); chrome.kill(); } })();
