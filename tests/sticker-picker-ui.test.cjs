const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Uses the project's existing TypeScript dev dependency. No production dependency added.
const ts = require(process.env.TENH_TYPESCRIPT_PATH || 'typescript');
const root = process.env.TENH_UI_ROOT || path.resolve(__dirname, '..');
const catalogPath = process.env.TENH_CATALOG_PATH || path.join(root, 'lib/telegram/sticker-catalog.ts');
function load(file, imports = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const exports = {}; vm.runInNewContext(compiled.outputText, { exports, require: name => { if (name in imports) return imports[name]; throw new Error(name); }, URLSearchParams, URL, Date, Set, Map });
  return exports;
}
const catalog = load(catalogPath);
const ui = load(path.join(root, 'lib/inbox/sticker-picker-ui.ts'), { '@/lib/telegram/sticker-catalog': catalog });
function native(overrides={}) { return { setName:'UtyaDuck', stickerId:'file_unique_1', label:'Hello', emoji:'🦆', format:'static', previewUrl:'/api/telegram/stickers/preview?x', ...overrides }; }
function pack(items=[native()], overrides={}) { return {success:true, name:'UtyaDuck', title:'Duck', stickers:items, ...overrides}; }
const read = value => ui.readStickerPack(value, 'UtyaDuck', 'conversation-A');
const cases = [
 ['retains real Telegram set fields', () => { const a=read(pack()); assert.equal(a.title,'Duck'); assert.equal(a.stickers.length,1); assert.equal(a.stickers[0].stickerId,'file_unique_1'); }],
 ['builds preview for selected conversation', () => {const u=new URL(read(pack()).stickers[0].previewUrl,'https://app.tenhchat.com');assert.equal(u.searchParams.get('conversationId'),'conversation-A');assert.equal(u.pathname,'/api/telegram/stickers/preview');}],
 ['remote preview cannot expose bot token', () => {const a=read(pack([native({previewUrl:'https://api.telegram.org/file/botSECRET/secret.png'})]));assert.ok(!a.stickers[0].previewUrl.includes('SECRET'));assert.ok(a.stickers[0].previewUrl.startsWith('/api/telegram/'));}],
 ['missing preview retains fallback', () => assert.equal(read(pack([native({previewUrl:null})])).stickers[0].previewUrl,null)],
 ['failed provider response rejected', () => assert.equal(read(pack([], {success:false})),null)],
 ['wrong set in response rejected', () => assert.equal(read(pack([], {name:'Other'})),null)],
 ['wrong set on sticker ignored', () => assert.equal(read(pack([native({setName:'Other'})])).stickers.length,0)],
 ['case-insensitive set canonicalization', () => assert.equal(read(pack([native({setName:'utyaduck'})], {name:'utyaduck'})).stickers.length,1)],
 ['malformed response rejected', () => {for (const a of [null,[],true,'text',{}, {success:true,stickers:{}}]) assert.equal(read(a),null);}],
 ['invalid IDs ignored', () => {for (const stickerId of ['', 'abc/def', 'a'.repeat(257),'<script>']) assert.equal(read(pack([native({stickerId})])).stickers.length,0);}],
 ['unknown formats ignored', () => assert.equal(read(pack([native({format:'executable'})])).stickers.length,0)],
 ['static animated video formats retained', () => {for(const format of ['static','animated','video']) assert.equal(read(pack([native({format})])).stickers[0].format,format);}],
 ['duplicate stickers deduplicated', () => assert.equal(read(pack([native(),native()])).stickers.length,1)],
 ['caps large packs at 120 items', () => assert.equal(read(pack(Array.from({length:200},(_,i)=>native({stickerId:'f'+i})))).stickers.length,120)],
 ['limits returned text lengths', () => {const a=read(pack([native({label:'a'.repeat(500),emoji:'x'.repeat(500)})],{title:'x'.repeat(500)}));assert.equal(a.title.length,160);assert.equal(a.stickers[0].label.length,160);assert.equal(a.stickers[0].emoji.length,40);}],
 ['recent choices deduplicate newest first', () => {assert.deepEqual(Array.from(ui.rememberStickerChoice(['a','b'],'b', x=>x)),['b','a']);}],
 ['recent choices bounded at 24', () => {assert.equal(ui.rememberStickerChoice(Array.from({length:40},(_,i)=>''+i),'new', x=>x).length,24);}],
 ['recents distinguish sets and identifiers', () => {assert.equal(ui.rememberStickerChoice([native()],native({setName:'Other'}),x=>x.setName+':'+x.stickerId).length,2);}],
 ['search trims whitespace and folds case', () => assert.equal(ui.stickerMatchesSearch(' HELLO ', 'Hello'),true)],
 ['emoji search and empty query', () => {assert.ok(ui.stickerMatchesSearch('🦆',null,'🦆'));assert.ok(ui.stickerMatchesSearch('   ',undefined));}],
 ['nonmatching search rejected', () => assert.equal(ui.stickerMatchesSearch('payment','Hello'),false)],
 ['desktop picker fits above composer', () => {const a=ui.stickerPanelLayout({left:120,top:750,bottom:790},{width:1400,height:900});assert.equal(a.width,420);assert.ok(a.top+a.height<750);assert.ok(a.left>=8);}],
 ['phone picker stays inside viewport', () => {const a=ui.stickerPanelLayout({left:180,top:620,bottom:660},{width:360,height:700});assert.equal(a.width,344);assert.ok(a.left+a.width<=352);assert.ok(a.top>=8);}],
 ['right edge clamps panel', () => {const a=ui.stickerPanelLayout({left:1350,top:780,bottom:800},{width:1400,height:900});assert.ok(a.left+a.width<=1392);}],
 ['near top opens below trigger', () => {const a=ui.stickerPanelLayout({left:120,top:30,bottom:65},{width:900,height:800});assert.ok(a.top>=73);}],
 ['short keyboard viewport is bounded', () => {const a=ui.stickerPanelLayout({left:100,top:500,bottom:540},{width:360,height:300,top:280});assert.ok(a.top>=288);assert.ok(a.top+a.height<=572);}],
 ['panned visual viewport horizontal bounds', () => {const a=ui.stickerPanelLayout({left:20,top:400,bottom:445},{width:320,height:600,left:40});assert.ok(a.left>=48);assert.ok(a.left+a.width<=352);}],
 ['offscreen trigger still yields bounded panel', () => {for(const top of [-1000, -50, 1400]) { const a=ui.stickerPanelLayout({left:100,top,bottom:top+40},{width:360,height:700}); assert.ok(a.top>=8);assert.ok(a.top+a.height<=692);}}],
 ['existing catalog keeps six Telegram packs', () => assert.equal(catalog.TELEGRAM_STICKER_PACKS.length,6)],
];
for (const [name, run] of cases) test(name,run);
const component = fs.readFileSync(path.join(root,'components/inbox/tenh-sticker-picker.tsx'),'utf8');
test('component parses and preserves the existing public API', () => {
 const r=ts.transpileModule(component,{fileName:'picker.tsx',reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}});
 assert.equal(r.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 for(const name of ['TenhStickerPicker','TENH_STICKERS','onSelectTelegram','onSelect','onOpen','conversationId','disabled']) assert.ok(component.includes(name));
});
test('UI is presentational, not a new sending channel', () => {
 for(const forbidden of ['chrome.runtime','/api/facebook/send','/api/telegram/send-sticker','api.telegram.org/bot','service_role','localStorage','sessionStorage']) assert.ok(!component.includes(forbidden));
 assert.ok(component.includes('onSelectTelegram?.(item)')); assert.ok(component.includes('onSelect(new File('));
});
test('explicitly distinguishes native Telegram from image library', () => {
 assert.ok(component.includes('not Facebook’s Sticker Store'));assert.ok(component.includes('not a native Facebook sticker'));assert.ok(component.includes('native Telegram sticker'));
});
test('fixed bottom tabs and independent grid scrolling are present', () => {
 assert.ok(component.includes('role="tablist"')); assert.ok(component.indexOf('role="tabpanel"')<component.indexOf('role="tablist"'));
 assert.ok(component.includes('overflow-y-auto'));assert.ok(component.includes('overflow-x-auto'));assert.ok(component.includes('createPortal('));
});
test('context switch and disable cancel requests and clear scoped caches', () => {
 assert.ok(component.includes('packCache.current.clear()'));assert.ok(component.includes('setRecentTelegram([])'));assert.ok(component.includes('request.current?.abort()'));assert.ok(component.includes('current.current.context !== expectedContext'));assert.ok(component.includes('current.current.disabled'));
});
