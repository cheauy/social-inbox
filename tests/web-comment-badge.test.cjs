const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { ROOT } = require('./tenh-seven/harness.cjs');
const source = fs.readFileSync(path.join(ROOT,'components/inbox/conversation-list.tsx'),'utf8');
const start=source.indexOf('function ChannelAvatarBadge('), end=source.indexOf('function getConversationPlatform(',start);
const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
const jsx=(type,props)=>({type,props});
const context={useState:()=>[false,()=>{}],require:()=>({jsx,jsxs:jsx}),exports:{},MessengerSourceIcon:'messenger',TelegramSourceIcon:'telegram'};
vm.runInNewContext(compiled+';globalThis.renderBadge=ChannelAvatarBadge;',context);
test('Facebook comment rows render a comment icon, not Messenger artwork',()=>{
  const node=context.renderBadge({platform:'messenger',sourceType:'comment'});
  assert.equal(node.props.title,'Facebook comment');assert.equal(node.props.children.type,'svg');
});
test('a customer DM changes the badge back to Messenger',()=>{
  const node=context.renderBadge({platform:'messenger',sourceType:'messenger'});
  assert.equal(node.props.title,'Messenger');assert.equal(node.props.children.props.src,'/images/channels/messenger.png');
});
test('Telegram keeps its channel icon',()=>{
  const node=context.renderBadge({platform:'telegram',sourceType:'comment'});
  assert.equal(node.props.title,'Telegram');assert.equal(node.props.children.props.src,'/images/channels/telegram.png');
});
