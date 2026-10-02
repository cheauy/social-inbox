import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import harness from './tenh-seven/harness.cjs';
const { loader } = harness;
const require = createRequire(import.meta.url);
const { getAlbumActionTarget } = loader({})('lib/inbox/album-action-target.ts');
const row = (id, conversation_id = 'c1') => ({ id, conversation_id, direction: 'outgoing', message_type: 'image', attachment_url: '/photo/' + id });
const anchor = row('base');
const photos = [row('base:photo:0'), row('base:photo:1'), row('base:photo:2')];

test('hovered/focused/tapped photo retains its exact Copy/Reply identity and stored reaction row', () => {
  for (const photo of photos) {
    const target = getAlbumActionTarget(photos, [anchor], anchor, { conversationId: 'c1', photoId: photo.id }, null);
    assert.equal(target.photo, photo);
    assert.equal(target.message, anchor);
  }
});
test('Telegram photos keep individual stored reaction/action rows', () => {
  const members = [row('tg-1'), row('tg-2'), row('tg-3')];
  const target = getAlbumActionTarget(members, members, members[2], { conversationId: 'c1', photoId: 'tg-1' }, null);
  assert.equal(target.photo, members[0]);
  assert.equal(target.message, members[0]);
});
test('stale selection from another conversation or album cannot change the target', () => {
  for (const active of [{ conversationId: 'other', photoId: photos[2].id }, { conversationId: 'c1', photoId: 'unrelated' }]) {
    assert.equal(getAlbumActionTarget(photos, [anchor], anchor, active, null).photo, photos[0]);
  }
});
test('current reply is the fallback when a selected photo leaves the album', () => {
  const target = getAlbumActionTarget(photos.slice(0, 2), [anchor], anchor, { conversationId: 'c1', photoId: photos[2].id }, photos[1].id);
  assert.equal(target.photo, photos[1]);
});
test('default Telegram anchor and Facebook first attachment preserve the existing group reply', () => {
  const telegram = [row('tg-1'), row('tg-2')];
  assert.equal(getAlbumActionTarget(telegram, telegram, telegram[1], null, null).photo, telegram[1]);
  assert.equal(getAlbumActionTarget(photos, [anchor], anchor, null, null).photo, photos[0]);
});
test('same IDs in foreign rows cannot become the reaction owner', () => {
  const target = getAlbumActionTarget([...photos, row('foreign:photo:0', 'other')], [row('base', 'other'), anchor], anchor, { conversationId: 'c1', photoId: 'foreign:photo:0' }, null);
  assert.equal(target.photo, photos[0]);
  assert.equal(target.message, anchor);
});

// Execute the real MessagePanel album and footer JSX so event routing is covered.
async function mountAlbum(t, platform, direction, count) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://local.test' });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const events = [];
  const load = loader({
    '@/lib/auth/use-workspace-permissions': { useWorkspacePermissions: () => ({ can: () => true }) },
    '@/lib/inbox/image-clipboard': { copyInboxImage: async (src, reference) => events.push({ type: 'copy', src, ...reference }) },
  }, { window, document, URLSearchParams });
  const source = fs.readFileSync('components/inbox/message-panel.tsx', 'utf8');
  const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const snippets = {};
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'PhotoAlbumFrame') snippets.album = node.getText(ast);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'MessengerMessageActions' && node.getText(ast).includes('copyControl=')) snippets.actions = node.getText(ast);
    if (ts.isVariableDeclaration(node) && ['albumActionTarget', 'replyActionId'].includes(node.name.getText(ast))) snippets[node.name.getText(ast)] = `const ${node.getText(ast)};`;
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'activateAlbumPhoto') snippets.activate = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(Object.keys(snippets).length, 5);
  const message = { ...anchor, direction, platform_message_id: platform === 'telegram' ? 'telegram:base' : 'mid.base', raw_payload: {} };
  const members = Array.from({ length: count }, (_, index) => ({ ...message, id: platform === 'telegram' ? `tg-${index}` : `base:photo:${index}`, attachment_url: `/synthetic/${index}` }));
  const code = ts.transpileModule(`export function Fixture() {
    const [activeAlbumPhoto,setActiveAlbumPhoto]=useState(null),[replyingToFacebookMessageId,setFb]=useState(null),[replyingToTelegramMessageId,setTg]=useState(null);
    const photoGroup={members},photoGroups=new Map([[message.id,photoGroup]]),messages=platform==='telegram'?members:[message],isImageMessage=true,isOutgoing=direction==='outgoing',isTelegramMessage=platform==='telegram',activeConversation={social_account:{platform}},telegramReplyPreview=null,jumpHighlightedMessageId=null,photoElementRefs=useRef(new Map());
    const localImagePreview=()=>undefined,setImagePreview=value=>events.push({type:'open',...value.reference}),pinnedMessages={pins:[],pendingIds:new Set()},messageActions=getMessageActions(message,platform),isTelegramReplyTarget=false;
    const onMessagePatched=()=>{},onReplyToFacebookMessage=id=>{setFb(id);events.push({type:'reply',id});},onReplyToTelegramMessage=id=>{setTg(id);events.push({type:'reply',id});},onCancelFacebookReply=()=>setFb(null),onCancelTelegramReply=()=>setTg(null),toggleMessagePin=target=>events.push({type:'pin',id:target.id}),onEditTelegramMessage=()=>{},setTelegramDeleteTarget=ids=>events.push({type:'delete',ids});
    ${snippets.activate} ${snippets.albumActionTarget} ${snippets.replyActionId}
    return <div>${snippets.album}${snippets.actions}</div>;
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const sandbox = { exports: {}, require, useState, useRef, members, message, platform, direction, events, getAlbumActionTarget,
    ...load('lib/inbox/message-actions.ts'), ...load('lib/inbox/photo-groups.ts'),
    ...load('components/inbox/photo-album-frame.tsx'), ...load('components/inbox/inbox-photo-image.tsx'),
    ...load('components/inbox/image-copy-button.tsx'), ...load('components/inbox/messenger-message-actions.tsx') };
  vm.runInNewContext(code, sandbox);
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  await act(async () => root.render(React.createElement(sandbox.exports.Fixture)));
  return { events, members };
}

for (const direction of ['incoming', 'outgoing']) {
  test(`${direction} real album has one footer and routes hover/touch/focus/context-menu Copy and Reply`, async t => {
    const { events, members } = await mountAlbum(t, 'facebook', direction, 12);
    const album = document.querySelector('[data-photo-layout="album"]');
    assert.equal(document.querySelectorAll('[role="group"]').length, 1);
    assert.equal(album.querySelector('[role="group"], [aria-label="Copy image"]'), null);
    const copy = () => document.querySelector('[aria-label="Copy image"]');
    const reply = () => [...document.querySelectorAll('[role="group"] button')].find(button => /^(?:Cancel reply|Reply)$/.test(button.textContent));
    for (const [index, event] of [[11, 'pointerover'], [0, 'pointerdown'], [8, 'focus'], [4, 'contextmenu'], [1, 'pointerover']]) {
      const tile = document.querySelectorAll('[data-album-photo-id]')[index];
      await act(async () => { if (event === 'focus') tile.querySelector('button').focus(); else tile.dispatchEvent(new window.MouseEvent(event, { bubbles: true })); });
      assert.equal(copy().textContent.trim(), 'Copy');
      await act(async () => copy().click());
      assert.equal(events.at(-1).messageId, members[index].id);
      assert.equal(events.at(-1).conversationId, 'c1');
      assert.equal(copy().textContent.trim(), 'Copied');
      await act(async () => reply().click());
      assert.equal(events.at(-1).id, members[index].id);
      assert.match(tile.className, /ring-blue-500/);
      await act(async () => reply().click());
      assert.equal(reply().textContent, 'Reply');
    }
  });
}

test('Telegram album retains group pin/delete while replying to the selected photo', async t => {
  const { events, members } = await mountAlbum(t, 'telegram', 'outgoing', 3);
  await act(async () => document.querySelectorAll('[data-album-photo-id]')[2].querySelector('button').focus());
  for (const label of ['Reply', 'Pin', 'Delete']) {
    await act(async () => [...document.querySelectorAll('[role="group"] button')].find(button => button.textContent === label).click());
  }
  assert.equal(events.find(event => event.type === 'reply').id, members[2].id);
  assert.equal(events.find(event => event.type === 'pin').id, 'base');
  assert.deepEqual(Array.from(events.find(event => event.type === 'delete').ids), members.map(member => member.id));
});
