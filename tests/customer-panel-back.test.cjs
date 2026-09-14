const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { ROOT } = require('./tenh-seven/harness.cjs');
const source = fs.readFileSync(path.join(ROOT, 'mobile/components/customer-panel.tsx'), 'utf8');
const marker = source.indexOf('// Consume Android');
const start = source.indexOf('useEffect(() => {', marker);
const end = source.indexOf('}, [open, mounted]);', start) + '}, [open, mounted]);'.length;
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const guardStart = source.indexOf('useEffect(() => {', source.indexOf('// Keep this protection inside the shared panel'));
const guardEnd = source.indexOf('}, [navigation, open, mounted]);', guardStart) + '}, [navigation, open, mounted]);'.length;
const guardCode = ts.transpileModule(source.slice(guardStart, guardEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [open, mounted] of [[true,true],[false,true],[false,false]]) test(`shared panel owns iOS gesture protection (${open}, ${mounted})`, () => {
  const options=[]; let cleanup;
  vm.runInNewContext(guardCode,{open,mounted,navigation:{setOptions:value=>options.push(value.gestureEnabled)},useEffect:callback=>{cleanup=callback();}});
  if(open || mounted) { assert.deepEqual(options,[false]); cleanup(); assert.deepEqual(options,[false,true]); }
  else assert.deepEqual(options,[]);
});
for (const [open, mounted] of [[true,true],[false,true],[false,false]]) test(`Back is consumed only while details are visible or closing (${open}, ${mounted})`, () => {
  let handler, cleanup, closed=0, removed=0;
  vm.runInNewContext(code, {open,mounted,useEffect:callback=>{cleanup=callback();},closePanelRef:{current:()=>closed++},BackHandler:{addEventListener:(event,callback)=>{assert.equal(event,'hardwareBackPress');handler=callback;return {remove:()=>removed++};}}});
  if (open || mounted) { assert.equal(handler(),true); assert.equal(closed,open?1:0); cleanup(); assert.equal(removed,1); }
  else assert.equal(handler,undefined);
});
test('horizontal panel swipe closes details; vertical scrolling and short drags do not', () => {
  const start=source.indexOf('  const drag = useRef('),end=source.indexOf('  ).current;',start)+'  ).current;'.length;
  let handlers,closed=0,springs=0;
  vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
    useRef:value=>({current:value}),PanResponder:{create:value=>{handlers=value;return {}; }},
    slide:{setValue(){}},DISMISS_AFTER:100,closePanelRef:{current:()=>closed++},Animated:{spring:()=>({start:()=>springs++})},
  });
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null,{dx:20,dy:2}),true);
  assert.equal(handlers.onMoveShouldSetPanResponderCapture(null,{dx:2,dy:20}),false);
  handlers.onPanResponderRelease(null,{dx:120,vx:0});assert.equal(closed,1);
  handlers.onPanResponderRelease(null,{dx:20,vx:0});assert.equal(closed,1);assert.equal(springs,1);
  assert.equal(handlers.onPanResponderTerminationRequest(),false);
});
