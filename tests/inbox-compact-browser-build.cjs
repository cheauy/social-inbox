/* Isolated full Inbox fixture. All auth/data/provider traffic is mocked locally. */
const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),out=fs.mkdtempSync(path.join(process.env.TEMP,'tenh-inbox-compact-'));
const navigation=process.argv.includes('--navigation');
const evidence=process.env.TENH_INBOX_EVIDENCE || (navigation?'docs/evidence/compact-navigation-20261012':'docs/evidence/inbox-compact-web');
const baseline=process.argv.includes('--baseline'),sourceRoot=baseline?fs.readFileSync(evidence+'/baseline-path.txt','utf8').trim():root;
const write=(name,source)=>fs.writeFileSync(path.join(out,name),source);
const webpack=require('next/dist/compiled/webpack/webpack').webpack;
write('loader.cjs',`const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
write('navigation.cjs',`const R=require('react');const change=()=>dispatchEvent(new Event('fixture-url'));for(const kind of ['pushState','replaceState']){const original=history[kind].bind(history);history[kind]=(...args)=>{original(...args);change()}}const subscribe=fn=>{addEventListener('fixture-url',fn);addEventListener('popstate',fn);return()=>{removeEventListener('fixture-url',fn);removeEventListener('popstate',fn)}};const url=()=>location.href;const router={push(url){history.pushState(null,'',url)},replace(url){history.replaceState(null,'',url)},refresh(){window.fixtureRefreshes++},prefetch(){}};exports.useRouter=()=>router;exports.useSearchParams=()=>new URL(R.useSyncExternalStore(subscribe,url,url)).searchParams;exports.usePathname=()=>new URL(R.useSyncExternalStore(subscribe,url,url)).pathname;`);
write('link.cjs',`const R=require('react');module.exports=function Link({href,children,onNavigate,prefetch,...props}){return R.createElement('a',{...props,href,onClick:event=>{props.onClick?.(event);if(!event.defaultPrevented){event.preventDefault();let cancelled=false;onNavigate?.({preventDefault(){cancelled=true}});if(!cancelled)history.pushState(null,'',href)}}},children)};`);
write('image.cjs',`const R=require('react');module.exports=function Image({priority,fill,unoptimized,...props}){return R.createElement('img',props)};`);
fs.appendFileSync(path.join(out,'link.cjs'),'\nmodule.exports.useLinkStatus=()=>({pending:false});');
write('profile.cjs',`const R=require('react'),{ProfileMenu}=require('@/components/dashboard/profile-menu');exports.CurrentUserProfileMenu=()=>R.createElement(ProfileMenu,{name:'Fixture Agent',email:'fixture@example.invalid',avatarUrl:null});`);
write('font.cjs',`module.exports=new Proxy({}, {get:()=>()=>({className:'fixture-font',style:{fontFamily:'Arial'}})});`);
write('language.cjs',`exports.useWorkspaceLanguageId=()=>new URLSearchParams(location.search).get('language')==='km'?'km':'en';exports.WorkspaceLanguageText=({en,km})=>exports.useWorkspaceLanguageId()==='km'?km:en;`);
write('supabase.cjs',`const user={id:'00000000-0000-4000-8000-000000000902',email:'fixture@example.invalid'};const client={auth:{getUser:async()=>({data:{user}}),getSession:async()=>({data:{session:{user,access_token:'isolated-fixture'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},realtime:{setAuth:async()=>{}},from(table){let single=false;const query=new Proxy({}, {get(_,key){if(key==='then')return resolve=>resolve({data:single?null:[],error:null});return(...args)=>{window.fixtureQueries.push({table,method:key});if(key==='single'||key==='maybeSingle')single=true;return query}}});return query},channel(name){const c={name,on(){return c},subscribe(fn){window.fixtureSubscriptions.push(name);queueMicrotask(()=>fn?.('SUBSCRIBED'));return c},presenceState(){return{}},track:async()=>{},untrack:async()=>{},send:async()=>({status:'ok'}),unsubscribe:async()=>{}};return c},removeChannel:async()=>{}};exports.createClient=()=>client;`);
async function main(){
  let entry=path.join(root,process.env.TENH_INBOX_ENTRY || 'tests/fixtures/inbox-compact-browser.entry.cjs');
  if(navigation){
    let source=fs.readFileSync(entry,'utf8');const start=source.indexOf('async function run(){'),end=source.indexOf('\nif (!process.env.TENH_INBOX_PERF_FIXTURE)',start);
    if(start<0||end<0)throw Error('Inbox fixture entry missing');
    source=source.slice(0,start)+`async function run(){const header=await DashboardHeader();await require(${JSON.stringify(path.join(root,'tests/fixtures/compact-navigation-app.cjs'))})({React,createRoot,InboxView,header,DashboardUtilityNavigationProvider,InboxReturnContextProvider,h,uuid,rows,messages});}`+source.slice(end);
    write('navigation-entry.cjs',source);entry=path.join(out,'navigation-entry.cjs');
  }
  const css=await require('postcss')([require('@tailwindcss/postcss')()]).process(fs.readFileSync(path.join(sourceRoot,'app/globals.css'),'utf8'),{from:path.join(sourceRoot,'app/globals.css')});write('style.css',css.css);
  const alias={
    'next/navigation$':path.join(out,'navigation.cjs'),
    'next/link$':path.join(out,'link.cjs'),
    'next/image$':path.join(out,'image.cjs'),
    'next/font/google$':path.join(out,'font.cjs'),
    '@/components/dashboard/current-user-profile-menu$':path.join(out,'profile.cjs'),
    '@/lib/supabase/client$':path.join(out,'supabase.cjs'),
    '@/components/display/workspace-language-text$':path.join(out,'language.cjs'),
    '@':sourceRoot,
  };
  await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:out,filename:'bundle.js'},plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development',TENH_INBOX_PERF_FIXTURE:process.env.TENH_INBOX_PERF_FIXTURE || '',NEXT_PUBLIC_TIKTOK_ADVERTISER_ENABLED:'false',NEXT_PUBLIC_TIKTOK_ACCOUNT_HOLDER_ENABLED:'false'})})],resolve:{extensions:['.ts','.tsx','.js','.cjs'],alias,modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,use:path.join(out,'loader.cjs')}]},optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  write('index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><link rel="stylesheet" href="/style.css"><title>Isolated TENH Inbox</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  console.log(out);fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(evidence+'/'+(baseline?'baseline-fixture-path.txt':'fixture-path.txt'),out);
}
main().catch(error=>{console.error(error);process.exitCode=1});
