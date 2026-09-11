const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const file='components/analytics/dashboard-overview-panel.tsx';
const source=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let period,callback;
function walk(n){if(ts.isVariableDeclaration(n)){if(n.name.getText(ast)==='effectivePeriod')period=n.initializer.getText(ast);if(n.name.getText(ast)==='loadOverview')callback=n.initializer.arguments[0].getText(ast);}ts.forEachChild(n,walk)}walk(ast);
function dashboard(rangeView,requestJson){
 const context={rangeView,requestJson,slaMinutes:10,mountedRef:{current:true},requestVersionRef:{current:0},EMPTY_CUSTOMERS:{},EMPTY_CONVERSATIONS:{},EMPTY_AGENT_SUMMARY:{},exports:{},updates:[]};
 for(const name of source.match(/\bset[A-Z]\w+/g))context[name]=value=>context.updates.push([name,value]);
 vm.runInNewContext(ts.transpileModule(`const effectivePeriod=${period}; exports.run=${callback}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
 return context;
}
for(const range of ['today','yesterday','7d','30d'])test(range+' reaches every dated dashboard endpoint',async()=>{
 const urls=[];const h=dashboard(range,async url=>{urls.push(url);return {ok:false}});await h.exports.run();
 assert.equal(urls.filter(u=>u.includes('/analytics/')).length,3);
 for(const u of urls.filter(u=>u.includes('/analytics/')))assert.equal(new URL(u,'https://test').searchParams.get('period'),range);
 assert(urls.includes('/api/team/workload?includeLive=1&slaMinutes=10'));
});
test('a late response cannot overwrite a newer dashboard refresh',async()=>{
 const waiting=[];const h=dashboard('today',()=>new Promise(r=>waiting.push(r)));
 const older=h.exports.run();const newer=h.exports.run();
 waiting.slice(4).forEach(r=>r({ok:false}));await newer;const count=h.updates.length;
 waiting.slice(0,4).forEach(r=>r({ok:false}));await older;assert.equal(h.updates.length,count);
});
for(const route of ['customers','conversations','agents']){
 const path=`app/api/analytics/${route}/route.ts`,text=fs.readFileSync(path,'utf8');
 const tree=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);
 const wanted=new Set(['getLocalCalendarParts','localMidnightUtc','getPeriodRange']);
 const code=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&wanted.has(n.name.text)).map(n=>n.getText(tree)).join('\n');
 const context={exports:{},PERIOD_DAYS:{'7d':7,'30d':30,'90d':90}};
 vm.runInNewContext(ts.transpileModule(code+'\nexports.range=getPeriodRange;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
 test(route+' uses Cambodia midnight and correct rolling durations',()=>{
  const now=new Date('2026-01-01T00:30:00Z');
  const range=period=>context.exports.range({period,now,tzOffsetMinutes:-420});
  assert.equal(range('today').start.toISOString(),'2025-12-31T17:00:00.000Z');
  assert.equal(range('yesterday').start.toISOString(),'2025-12-30T17:00:00.000Z');
  assert.equal(range('yesterday').end.toISOString(),range('today').start.toISOString());
  for(const days of [7,30])assert.equal(+range(days+'d').end-+range(days+'d').start,days*86400000);
 });
}
