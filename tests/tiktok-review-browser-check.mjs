import assert from "node:assert/strict";

const targets = await fetch("http://127.0.0.1:9223/json/list").then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url.includes("/review/tiktok"));
assert.ok(target, "TikTok review page is not open in the browser test target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
function command(method, params) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", listener);
      if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
      else resolve(message.result);
    };
    socket.addEventListener("message", listener);
  });
}
const evaluate = (expression) => command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).then((result) => result.result.value);

const click = (text, extra = "") => evaluate(`(() => {
  const match = [...document.querySelectorAll('button')].find((button) => button.textContent.trim().includes(${JSON.stringify(text)}) ${extra});
  if (!match) throw new Error('Missing button: ${text}');
  match.click();
  return true;
})()`);
const body = () => evaluate("document.body.innerText");
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
async function waitForBody() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const text = await body();
    if (text) return text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return "";
}

await evaluate(`document.querySelector('button')?.textContent.includes('Reset demo')
  ? document.querySelector('button').click()
  : [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Reset demo'))?.click()`);
await settle();
assert.match(await waitForBody(), /Prototype — TikTok API access pending/);
await click("Simulate Connect TikTok");
await settle();
assert.match(await body(), /Choose a merchant account/);
await click("Northstar Coffee");
await click("Open selected account");
await settle();
assert.match(await body(), /Northstar Coffee[\s\S]*Owned videos/);

await click("Reply", "&& !button.closest('[class*=sticky]')");
await settle();
await evaluate(`(() => {
  const textarea = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, 'Thanks from the local browser check.');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await settle();
await click("Reply", "&& button.closest('[class*=sticky]')");
await settle();
assert.match(await body(), /Thanks from the local browser check/);

await evaluate(`document.querySelector('button[aria-label^="Manage comment by"]')?.click()`);
await settle();
await click("Hide comment");
await settle();
assert.match(await body(), /hidden/i);

await click("Reset demo");
await settle();
assert.match(await body(), /Simulate Connect TikTok/);
assert.doesNotMatch(await body(), /Choose a merchant account/);

await click("Simulate Connect TikTok");
await settle();
await click("Back");
await settle();
assert.match(await body(), /Simulate Connect TikTok/);

await click("Simulate Connect TikTok");
await settle();
await click("Open selected account");
await settle();
await click("Close connection");
await settle();
assert.match(await body(), /Simulate Connect TikTok/);

await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await settle();
assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "mobile layout overflows horizontally");

socket.close();
console.log("TikTok review browser flow passed");
