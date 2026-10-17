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

test('explicitly selected photo retains its exact Copy/Reply identity and stored reaction row', () => {
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
async function mountAlbum(t, platform, direction, count, pending = false) {
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
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'MessengerMessageActions' && node.getText(ast).includes('contextual=')) snippets.actions = node.getText(ast);
    if (ts.isVariableDeclaration(node) && ['albumActionTarget', 'replyActionId'].includes(node.name.getText(ast))) snippets[node.name.getText(ast)] = `const ${node.getText(ast)};`;
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'activateAlbumPhoto') snippets.activate = node.getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'ReplyIcon') snippets.replyIcon = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(Object.keys(snippets).length, 6);
  const message = { ...anchor, id: pending ? 'optimistic:base' : anchor.id, direction, platform_message_id: pending ? 'optimistic:base' : platform === 'telegram' ? 'telegram:base' : 'mid.base', raw_payload: {} };
  const members = Array.from({ length: count }, (_, index) => ({ ...message, id: pending ? `optimistic:photo:${index}` : platform === 'telegram' ? `tg-${index}` : `base:photo:${index}`, attachment_url: `/synthetic/${index}` }));
  const code = ts.transpileModule(`${snippets.replyIcon}\nexport function Fixture() {
    const [activeAlbumPhoto,setActiveAlbumPhoto]=useState(null),[replyingToFacebookMessageId,setFb]=useState(null),[replyingToTelegramMessageId,setTg]=useState(null);
    const photoGroup={members},photoGroups=new Map([[message.id,photoGroup]]),messages=platform==='telegram'?members:[message],isImageMessage=true,isDeletedMessage=false,isFacebookCommentMessage=false,isOutgoing=direction==='outgoing',isTelegramMessage=platform==='telegram',activeConversation={social_account:{platform}},telegramReplyPreview=null,jumpHighlightedMessageId=null,photoElementRefs=useRef(new Map());
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
  test(`${direction} explicit photo actions stay selected while the pointer crosses other photos`, async t => {
    const { events, members } = await mountAlbum(t, 'facebook', direction, 12);
    const album = document.querySelector('[data-photo-layout="album"]');
    assert.equal(document.querySelectorAll('[role="group"]').length, 0);
    assert.ok(document.querySelector('[data-album-action-menu] button[aria-label="Album actions"]'));
    assert.equal(album.querySelector('[role="group"]'), null);
    assert.equal(album.querySelectorAll('[aria-label^="Copy photo "]').length, 12);
    const openMenu = async () => { const trigger=document.querySelector('[data-album-action-menu] button'); if(trigger.getAttribute('aria-expanded')!=='true')await act(async()=>trigger.click()); };
    const reply = () => [...document.querySelectorAll('[role="group"] button')].find(button => /^(?:Cancel reply|Reply)$/.test(button.textContent));
    for (const [index, event] of [[11, 'copy'], [0, 'reply'], [8, 'copy'], [4, 'contextmenu'], [1, 'open']]) {
      const tile = document.querySelectorAll('[data-album-photo-id]')[index];
      const before = events.length;
      await act(async () => {
        if (event === 'contextmenu') tile.dispatchEvent(new window.MouseEvent(event, { bubbles: true }));
        else if (event === 'copy') tile.querySelector('[aria-label^="Copy photo "]').click();
        else if (event === 'reply') tile.querySelector('[aria-label^="Reply to photo "]').click();
        else tile.querySelector('button').click();
      });
      if (event === 'copy' || event === 'reply') assert.equal(events.slice(before).some(item => item.type === 'open'), false);
      const lower = document.querySelectorAll('[data-album-photo-id]')[10];
      await act(async () => {
        lower.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
        lower.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
        lower.querySelector('button').focus();
      });
      assert.equal(tile.getAttribute('data-album-action-target'), 'true');
      assert.equal(lower.getAttribute('data-album-action-target'), null);
      await openMenu();
      const menu=document.querySelector('[role="dialog"][aria-label="Album actions"]');
      assert.ok(menu);assert.equal(menu.querySelector('[aria-label="Copy image"]'),null);
      assert.ok(menu.querySelector('[role="group"]').className.includes('rounded-full'));
      if (reply().textContent === 'Cancel reply') { await act(async () => reply().click()); await openMenu(); }
      await act(async () => reply().click());
      assert.equal(events.at(-1).id, members[index].id);
      assert.match(tile.className, /ring-blue-500/);
      assert.equal(Boolean(document.querySelector('[role="dialog"][aria-label="Album actions"]')),false);
      await openMenu();await act(async () => reply().click());
      await openMenu();assert.equal(reply().textContent, 'Reply');
      await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
      assert.equal(Boolean(document.querySelector('[role="group"]')),false);
    }
  });
}

test('Telegram album retains group pin/delete while replying to the selected photo', async t => {
  const { events, members } = await mountAlbum(t, 'telegram', 'outgoing', 3);
  await act(async () => document.querySelector('[aria-label="Copy photo 3"]').click());
  for (const label of ['Reply', 'Pin', 'Delete']) {
    await act(async()=>document.querySelector('[data-album-action-menu] button').click());
    await act(async () => [...document.querySelectorAll('[role="group"] button')].find(button => button.textContent === label).click());
  }
  assert.equal(events.find(event => event.type === 'reply').id, members[2].id);
  assert.equal(events.find(event => event.type === 'pin').id, 'base');
  assert.deepEqual(Array.from(events.find(event => event.type === 'delete').ids), members.map(member => member.id));
});

test('each album photo retains original icon-only Copy feedback, outside the ellipsis menu', async t => {
  const { events } = await mountAlbum(t, 'facebook', 'incoming', 3);
  assert.equal(document.querySelectorAll('[aria-label^="Copy photo "]').length, 3);
  const copy = document.querySelector('[aria-label="Copy photo 1"]');
  await act(async () => copy.click());
  assert.equal(events.at(-1).type, 'copy');
  assert.equal(events.at(-1).messageId, 'base:photo:0');
  assert.equal(events.at(-1).src, '/synthetic/0');
  assert.equal(copy.title, 'Copied');
  assert.equal(copy.querySelector('[aria-live="polite"]').textContent, 'Copied');
  assert.equal(copy.querySelector('[aria-live="polite"]').className, 'sr-only');
  await act(async () => document.querySelector('[data-album-photo-id] button').click());
  assert.equal(events.at(-1).type, 'open');
  assert.equal(events.at(-1).messageId, 'base:photo:0');
  await act(async () => document.querySelector('[data-album-action-menu] button').click());
  assert.equal(document.querySelector('[aria-label="Copy image"]'), null);
  assert.equal(document.querySelector('[data-album-photo-id] [role="group"]'), null);
});

test('Sending Telegram album disables the ellipsis without exposing unavailable actions', async t => {
  const {events}=await mountAlbum(t,'telegram','outgoing',3,true);
  const trigger=document.querySelector('[data-album-action-menu] button');assert.ok(trigger);assert.equal(trigger.disabled,true);
  await act(async()=>trigger.click());assert.equal(Boolean(document.querySelector('[role="group"]')),false);assert.equal(events.length,0);
  assert.equal(document.querySelectorAll('[aria-label^="Copy photo "]').length,3);
});

test('Sending Facebook album does not invent reaction, delete or enabled menu actions', async t => {
  await mountAlbum(t,'facebook','outgoing',3,true);
  assert.equal(document.querySelector('[data-album-action-menu] button').disabled,true);
  assert.equal(Boolean(document.querySelector('[role="group"]')),false);
  assert.equal(Boolean(document.querySelector('[aria-label="React to message"]')),false);
});

test('incoming album does not inherit outgoing Sending reservations', async t => {
  await mountAlbum(t,'telegram','incoming',3,true);
  assert.equal(Boolean(document.querySelector('[role="group"] button[aria-hidden="true"]')),false);
});
