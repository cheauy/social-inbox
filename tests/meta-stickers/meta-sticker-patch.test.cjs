const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const allFiles = [];
(function walk(dir){ for (const ent of fs.readdirSync(dir,{withFileTypes:true})) { if (["node_modules", ".git"].includes(ent.name)) continue; const p=path.join(dir,ent.name); if(ent.isDirectory()) walk(p); else allFiles.push(p); } })(ROOT);

test('Facebook sticker UI no longer depends on the retired external provider', () => {
  const active = [read('components/inbox/tenh-sticker-picker.tsx'), read('components/inbox/meta-sticker-grid.tsx'), read('components/inbox/inbox-view.tsx'), read('app/api/facebook/stickers/packs/route.ts'), read('app/api/facebook/stickers/pack/route.ts'), read('app/api/facebook/stickers/search/route.ts'), read('app/api/facebook/stickers/send/route.ts'), read('lib/stickers/meta-messenger-server.ts')].join('\n');
  assert.doesNotMatch(active, /STIPOP_API_KEY|Stipop|stipop/i);
  const picker = read('components/inbox/tenh-sticker-picker.tsx');
  assert.match(picker, /"Messenger Sticker"/);
  assert.doesNotMatch(picker, /Meta · Messenger Sticker API/);
  assert.doesNotMatch(picker, /Online\s*\|\s*TENH|onlineSource|facebookOnline/);
});

test('Facebook picker calls TENH Meta sticker routes', () => {
  const grid = [read('components/inbox/meta-sticker-grid.tsx'), read('lib/stickers/meta-sticker-cache.ts')].join('\n');
  assert.match(grid, /\/api\/facebook\/stickers\//);
  assert.match(grid, /get\("packs"/);
  assert.match(grid, /search \? "search" : "pack"/);
  assert.match(grid, /q: query.trim\(\)/);
  assert.doesNotMatch(grid, /Native first-party Messenger stickers from Meta/);
});

test('Facebook sends native sticker id rather than image attachment', () => {
  const route = read('app/api/facebook/stickers/send/route.ts');
  assert.match(route, /message:\s*\{\s*sticker_id:\s*stickerId\s*\}/);
  assert.match(route, /delivery:\s*"native_sticker"/);
  assert.match(route, /message_type:\s*"sticker"/);
  assert.doesNotMatch(route, /send-attachment/);
});

test('Meta catalog uses server-side App credentials, separate from Page sends', () => {
  const server = read('lib/stickers/meta-messenger-server.ts');
  assert.match(server, /FACEBOOK_APP_ID/);
  assert.match(server, /FACEBOOK_APP_SECRET/);
  assert.match(server, /Authorization/);
  assert.doesNotMatch(server, /getFacebookPageAccessToken/);
  assert.match(server, /metaStickerConversation/);
  const grid = [read('components/inbox/meta-sticker-grid.tsx'), read('lib/stickers/meta-sticker-cache.ts')].join('\n');
  assert.doesNotMatch(grid, /access_token|PAGE_ACCESS_TOKEN|facebook_page_access_token/i);
});

test('Telegram native sticker flow is preserved', () => {
  const picker = read('components/inbox/tenh-sticker-picker.tsx');
  const inbox = read('components/inbox/inbox-view.tsx');
  assert.match(picker, /TELEGRAM_STICKER_PACKS|Telegram packs|onSelectTelegram/);
  assert.match(inbox, /\/api\/telegram\/send-sticker/);
  assert.match(inbox, /replyingToTelegramMessageId/);
});

test('Duplicate native Meta sticker sends use durable receipt fence', () => {
  const route = read('app/api/facebook/stickers/send/route.ts');
  const migration = read('db/migrations/20260912_existing_tenh_upgrade.sql');
  assert.match(route, /facebook_sticker_sends/);
  assert.match(route, /STICKER_SEND_ALREADY_ATTEMPTED/);
  assert.match(migration, /primary key \(business_id, request_id\)/i);
  assert.match(migration, /revoke all .* anon, authenticated/i);
});

test('Patch does not contain Chrome extension files', () => {
  assert.equal(allFiles.some(p => p.includes(`${path.sep}tenh-extension${path.sep}`)), false);
});

test('Legacy online sticker routes no longer call an external sticker provider', () => {
  const oldSearch = read('app/api/stickers/search/route.ts');
  const oldSend = read('app/api/stickers/send/route.ts');
  assert.match(oldSearch, /LEGACY_STICKER_ROUTE_RETIRED/);
  assert.match(oldSend, /LEGACY_STICKER_ROUTE_RETIRED/);
  assert.doesNotMatch(oldSearch + oldSend, /stipop|giphy/i);
});
