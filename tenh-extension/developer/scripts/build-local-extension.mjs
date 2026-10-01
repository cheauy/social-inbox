import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

// Generate a separate development build from the canonical production source.
const source = path.resolve(process.argv[2] || 'tenh-extension');
const output = path.resolve(process.argv[3] || 'tenh-extension-localhost');
if (source === output || source.startsWith(output + path.sep) || output.startsWith(source + path.sep)) throw new Error('Use a separate output folder.');
const production = 'https://app.tenhchat.com', local = 'http://localhost:3000';
const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !manifest.host_permissions.includes(`${production}/*`) ||
    manifest.host_permissions.some(value => value.includes('localhost'))) throw new Error('Expected a canonical production build.');
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const item of readdirSync(from, { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.name === 'developer') continue;
    const target = path.join(to, item.name), input = path.join(from, item.name);
    if (item.isDirectory()) copyTree(input, target); else copyFileSync(input, target);
  }
}
copyTree(source, output);
manifest.name = 'TENH Companion - Localhost';
const version = manifest.version.split('.').map(Number); version[2]++;
manifest.version = version.join('.');
manifest.description = 'TENH development companion for localhost:3000, with isolated connection state.';
manifest.action.default_title = manifest.name;
manifest.host_permissions = manifest.host_permissions.map(value => value.replace(production, local));
for (const entry of manifest.content_scripts) entry.matches = entry.matches.map(value => value.replace(production, local));
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const name of ['background.js', 'popup.js', 'sidepanel.js', 'tenh-bridge.js']) {
  const target = path.join(output, 'src', name);
  let text = readFileSync(target, 'utf8').replaceAll(production, local).replaceAll('wss://app.tenhchat.com', 'ws://localhost:3000');
  if (name === 'background.js') {
    if (!text.includes('const tenhStorage = chrome.storage;')) throw new Error('Production storage marker missing.');
    text = text.replace('const tenhStorage = chrome.storage;', `// Keep local credentials, cursors and tickets separate from production.
function localStorageArea(area) {
  const prefix = "tenh-localhost-3000:";
  return {
    async get(keys) {
      const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
      const stored = await area.get(names.map(key => prefix + key));
      return Object.fromEntries(names.filter(key => stored[prefix + key] !== undefined).map(key => [key, stored[prefix + key]]));
    },
    set(values) { return area.set(Object.fromEntries(Object.entries(values).map(([key,value]) => [prefix + key,value]))); },
    remove(keys) { return area.remove((Array.isArray(keys) ? keys : [keys]).map(key => prefix + key)); },
  };
}
const tenhStorage = { local: localStorageArea(chrome.storage.local), session: localStorageArea(chrome.storage.session) };`);
  }
  if (name === 'sidepanel.js') text = text.replace('changes.facebook || changes.token || changes.device',
    'changes["tenh-localhost-3000:facebook"] || changes["tenh-localhost-3000:token"] || changes["tenh-localhost-3000:device"]');
  writeFileSync(target, text);
}
for (const name of ['popup.html', 'sidepanel.html']) {
  const target = path.join(output, 'src', name);
  writeFileSync(target, readFileSync(target, 'utf8').replaceAll('<title>TENH', '<title>TENH Localhost'));
}
console.log(output);
