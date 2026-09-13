import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

// Run from the TENH project: node scripts/build-local-extension.mjs
// Optional arguments: production source folder, localhost output folder.
const source = path.resolve(process.argv[2] || 'tenh-extension');
const output = path.resolve(process.argv[3] || 'tenh-extension-localhost');
if (source === output) throw new Error('Use a separate output folder for the localhost build.');
const localOrigin = 'http://localhost:3000';
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const item of readdirSync(from, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const target = path.join(to, item.name), input = path.join(from, item.name);
    if (item.isDirectory()) copyTree(input, target);
    else copyFileSync(input, target);
  }
}
copyTree(source, output);
const manifestPath = path.join(output, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.name = 'TENH Companion — Localhost';
manifest.version = '1.2.30';
manifest.description = 'TENH development companion for http://localhost:3000, with isolated local connection state.';
manifest.action.default_title = 'TENH Companion — Localhost';
manifest.host_permissions = manifest.host_permissions.map(url => url === 'https://app.tenhchat.com/*' ? `${localOrigin}/*` : url);
for (const entry of manifest.content_scripts) entry.matches = entry.matches.map(url => url === 'https://app.tenhchat.com/*' ? `${localOrigin}/*` : url);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
for (const file of ['background.js', 'popup.js', 'sidepanel.js']) {
  const target = path.join(output, 'src', file);
  writeFileSync(target, readFileSync(target, 'utf8').replaceAll('https://app.tenhchat.com', localOrigin));
}
const storageHelper = `
// Local and production credentials/cursors/tickets must never share storage.
// Reloading this build over the production folder preserves production keys.
function localStorageArea(area) {
  const prefix = "tenh-localhost-3000:";
  return {
    async get(keys) {
      const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
      const stored = await area.get(names.map(key => prefix + key));
      return Object.fromEntries(names.filter(key => stored[prefix + key] !== undefined)
        .map(key => [key, stored[prefix + key]]));
    },
    set(values) { return area.set(Object.fromEntries(Object.entries(values).map(([key, value]) => [prefix + key, value]))); },
    remove(keys) { return area.remove((Array.isArray(keys) ? keys : [keys]).map(key => prefix + key)); },
  };
}
const tenhStorage = { local: localStorageArea(chrome.storage.local), session: localStorageArea(chrome.storage.session) };
function isTenhSenderUrl(value) {
  try { const url = new URL(value); return url.origin === TENH_ORIGIN && !url.username && !url.password; }
  catch { return false; }
}
`;
const backgroundPath = path.join(output, 'src/background.js');
let background = readFileSync(backgroundPath, 'utf8').replaceAll('chrome.storage.', 'tenhStorage.');
background = background.replace(`const TENH_ORIGIN = "${localOrigin}";`, `const TENH_ORIGIN = "${localOrigin}";\n${storageHelper}`);
background = background.replace('return url.protocol === "wss:" && url.hostname === "app.tenhchat.com";',
  'return url.origin === "ws://localhost:3000" && !url.username && !url.password;');
background = background.replaceAll('!sender.tab.url.startsWith(TENH_ORIGIN)', '!isTenhSenderUrl(sender.tab.url)')
  .replaceAll('!senderUrl.startsWith(TENH_ORIGIN)', '!isTenhSenderUrl(senderUrl)')
  .replaceAll('new URL(tab.url).hostname === "app.tenhchat.com"', 'isTenhSenderUrl(tab.url)');
background = background.replace('async function handle(message, sender) {', `async function handle(message, sender) {
  if (["TENH_AUTO_CONNECTED", "TENH_AUTO_PAIRED"].includes(message?.type) &&
      (sender?.id !== chrome.runtime.id || sender?.frameId !== 0 || !isTenhSenderUrl(sender.url || sender.tab?.url))) {
    return { connected: false, paired: false, reason: "untrusted_sender" };
  }`);
background = background.replace('chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {', `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const url = sender?.url || sender?.tab?.url || "";
  let trusted = sender?.id === chrome.runtime.id && url.startsWith(\x60chrome-extension://\x24{chrome.runtime.id}/\x60);
  try { trusted ||= sender?.id === chrome.runtime.id && sender?.frameId === 0 &&
    (isTenhSenderUrl(url) || ["https://www.facebook.com", "https://business.facebook.com"].includes(new URL(url).origin)); } catch {}
  if (!trusted) { sendResponse({ error: "untrusted_sender" }); return false; }`);
writeFileSync(backgroundPath, background);
const bridgePath = path.join(output, 'src/tenh-bridge.js');
writeFileSync(bridgePath, readFileSync(bridgePath, 'utf8').replace('(() => {', `(() => {\nif (window.location.origin !== "${localOrigin}") return;`));
const sidepanelPath = path.join(output, 'src/sidepanel.js');
writeFileSync(sidepanelPath, readFileSync(sidepanelPath, 'utf8').replace('changes.facebook || changes.token || changes.device',
  'changes["tenh-localhost-3000:facebook"] || changes["tenh-localhost-3000:token"] || changes["tenh-localhost-3000:device"]'));
for (const file of ['popup.html', 'sidepanel.html']) {
  const target = path.join(output, 'src', file);
  writeFileSync(target, readFileSync(target, 'utf8').replaceAll('<title>TENH', '<title>TENH Localhost'));
}
console.log(output);
