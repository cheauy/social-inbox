const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=process.cwd(),temp=process.env.TEMP;
const source=fs.readFileSync(path.join(root,'components/inbox/message-panel.tsx'),'utf8');
const ast=ts.createSourceFile('panel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression, flightWrapper, pageLoader;const viewAst=ts.createSourceFile('view.tsx',fs.readFileSync(path.join(root,'components/inbox/inbox-view.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visitView=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='handleLoadOlderMessages')flightWrapper=node.getText(viewAst);if(ts.isFunctionDeclaration(node)&&node.name?.text==='loadOlderMessagePage')pageLoader=node.getText(viewAst);ts.forEachChild(node,visitView);};visitView(viewAst);const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='jumpToTelegramReplyTarget')expression=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);
const extracted=path.join(temp,'tenh-search-jump-fixture.ts');
fs.writeFileSync(extracted,`import {useCallback} from 'react';
export function useSearchJump(scope:any){const {jumpConversationRef,latestMessagesRef,hasMoreOlderMessagesRef,loadOlderForJumpRef,photoGroups,resolvePhotoReplyTarget,photoElementRefs,messageElementRefs,deferredMessageRefs,userNearBottomRef,setShowScrollToLatest,setJumpHighlightedMessageId,showActionNotice}=scope;return ${expression};}
export function createFlightLoader(scope:any){const {resolvedActiveConversationId,olderMessageFlightRef,loadOlderMessagePage,setLoadingOlderMessages=()=>{}}=scope;${flightWrapper};return handleLoadOlderMessages;}
export function createOwnedLoader(scope:any){const {resolvedActiveConversationId,olderMessageFlightRef,desiredConversationIdRef,hasMoreOlderMessages,liveMessages,MESSAGE_PAGE_SIZE,setHasMoreOlderMessages,setLoadingOlderMessages,setOlderMessagesError,setLiveMessages,messageOrderMs,readMessagePageResponse,fetch}=scope;${flightWrapper};${pageLoader};return handleLoadOlderMessages;}`);
const loaderPath=path.join(temp,'tenh-search-ts-loader.cjs');
fs.writeFileSync(loaderPath,`const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
const webpack=require(path.join(root,'node_modules/next/dist/compiled/webpack/webpack')).webpack;
webpack({mode:'production',plugins:[new webpack.DefinePlugin({'process.env.SEARCH_JUMP_FIXTURE':JSON.stringify(extracted)})],
  entry:path.join(root,'tests/fixtures/inbox-search-browser.entry.cjs'),output:{path:temp,filename:'tenh-search-browser-bundle.js'},
  resolve:{extensions:['.ts','.tsx','.js'],alias:{'@/components/settings/settings-sidebar$':path.join(root,'tests/fixtures/settings-sidebar-stub.cjs'),'@':root,'next/navigation$':path.join(root,'tests/fixtures/dashboard-navigation-stub.cjs'),'next/link$':path.join(root,'tests/fixtures/dashboard-navigation-stub.cjs')},modules:[path.join(root,'node_modules'),'node_modules']},
  module:{rules:[{test:/\.tsx?$/,use:loaderPath}]},optimization:{minimize:false}},(error,stats)=>{
  if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return;}
  fs.writeFileSync(path.join(temp,'tenh-search-browser.html'),'<html><head><meta charset="utf-8"></head><body><div id="app"></div><pre id="result">PENDING</pre><script src="tenh-search-browser-bundle.js"></script></body></html>');
  console.log('Isolated search fixture ready.');
});
