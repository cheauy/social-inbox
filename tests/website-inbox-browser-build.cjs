// Keep every existing assertion; run Inbox, legacy Bot-copy and photos as independent phases.
const fs = require('node:fs'), path = require('node:path');
const root = process.cwd(), sourceRoot = process.env.TENH_BROWSER_SOURCE_ROOT || root, output = process.env.TENH_BROWSER_OUTPUT;
if (!output || !path.isAbsolute(output) || !path.isAbsolute(sourceRoot)) throw Error('Provide absolute TENH_BROWSER_OUTPUT and optional TENH_BROWSER_SOURCE_ROOT.');
const sourcePath = path.join(root, 'tests/fixtures/inbox-paging-browser.entry.cjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('async function run(){'), bot = source.indexOf(" const draft=document.getElementById('drafts-fixture')", start);
const photos = source.indexOf(" const photos=document.getElementById('photos-fixture');check", bot);
const end = source.indexOf(" document.getElementById('result').textContent=JSON.stringify({passed:true", photos);
if ([start, bot, photos, end].some(x => x < 0) || !(start < bot && bot < photos && photos < end)) throw Error('Existing fixture structure changed; do not silently drop checks.');
const bodies = [source.slice(start + 'async function run(){'.length, bot), source.slice(bot, photos), source.slice(photos, end)];
const names = ['inbox', 'legacyBot', 'photos'];
const entry = source.slice(0, start).replace("require('./dashboard-navigation-stub.cjs')", 'require(' + JSON.stringify(path.join(root, 'tests/fixtures/dashboard-navigation-stub.cjs')) + ')') + `
async function run(){
 const groups={},errors={};
 ${bodies.map((body,i) => `{
  const before=checks.length;
  try { await (async()=>{${body}\n})(); } catch(error) { errors.${names[i]}=String(error); }
  const phase=checks.slice(before);groups.${names[i]}={passed:!errors.${names[i]}&&phase.every(c=>c.ok),pass:phase.filter(c=>c.ok).length,fail:phase.filter(c=>!c.ok).length};
 }`).join('\n')}
 document.getElementById('result').textContent=JSON.stringify({passed:Object.values(groups).every(g=>g.passed),groups,errors,viewport:{width:innerWidth,height:innerHeight},checks,requests:calls.length});
}
run().catch(error=>document.getElementById('result').textContent=JSON.stringify({passed:false,error:String(error),checks}));`;
// Verify the original check expressions are present byte-for-byte and in the same order.
const ts = require('typescript');
const assertions = text => { const found=[],ast=ts.createSourceFile('entry.cjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='check')found.push(n.getText(ast));ts.forEachChild(n,visit);}visit(ast);return found; };
if (JSON.stringify(assertions(source)) !== JSON.stringify(assertions(entry))) throw Error('Assertion content changed.');
fs.mkdirSync(output, { recursive: true });
const entryPath = path.join(output, 'entry.cjs'), loader = path.join(output, 'loader.cjs');
fs.writeFileSync(entryPath, entry);
fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(s){return ts.transpileModule(s,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
const webpack = require('next/dist/compiled/webpack/webpack').webpack;
webpack({ mode:'production',entry:entryPath,output:{path:output,filename:'bundle.js'},resolve:{extensions:['.ts','.tsx','.js','.cjs'],alias:{'@/components/settings/settings-sidebar$':path.join(root,'tests/fixtures/settings-sidebar-stub.cjs'),'@':sourceRoot,'next/navigation$':path.join(root,'tests/fixtures/dashboard-navigation-stub.cjs'),'next/link$':path.join(root,'tests/fixtures/dashboard-navigation-stub.cjs')},modules:[path.join(root,'node_modules')]},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false}},(error,stats)=>{
 if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return;}
 fs.writeFileSync(path.join(output,'assertion-contract.json'),JSON.stringify({sourcePath,sourceRoot,assertions:assertions(source).length,unchanged:true},null,2));
 console.log('Built independent Inbox phases with '+assertions(source).length+' unchanged check expressions.');
});
