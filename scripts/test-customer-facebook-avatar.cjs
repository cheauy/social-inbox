/* Component state/lifecycle mocks: automatic opening, saving and cancellation. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const urls={};vm.runInNewContext(compile('lib/facebook/customer-profile-url.ts'),{exports:urls,URL});
const code=compile('components/inbox/customer-facebook-avatar.tsx');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const context={businessId:'workspace',pageId:'123456',threadId:'987654',conversationId:'conversation'};
const profile='https://www.facebook.com/profile.php?id=61555135812581';
const result={...context,resolved:true,verified:true,profileUrl:profile,openToken:'ticket'};
function harness(config={}){
 let answer,current={id:'conversation',business_id:'workspace',source_type:'messenger',social_account:{platform:'facebook',platform_account_id:'123456'},contact:{id:'contact',platform_user_id:'987654',full_name:'Customer',facebook_profile_id:config.savedId}};
 const pending=new Promise(resolve=>answer=resolve),lookups=[],opens=[],patches=[],states=[],refs=[],effects=[],clipboard=[];
 let si=0,ri=0,ei=0;const exports={};
 vm.runInNewContext(code,{exports,URL,AbortController,AbortSignal,
 navigator:{clipboard:{writeText:async text=>{clipboard.push(text);}}},
 fetch:async(url,init={})=>{
   if(init.method==='PATCH'){patches.push({url,body:JSON.parse(init.body)});return {ok:!config.saveFailure,json:async()=>({success:!config.saveFailure})};}
   return {ok:true,json:async()=>({success:true,profileUrl:config.savedUrl??null,updatedAt:'original-revision'})};
 },require:name=>{
   if(name==='react')return {useState:value=>{const i=si++;if(!(i in states))states[i]=value;return [states[i],value=>states[i]=value]},
     useRef:value=>{const i=ri++;return refs[i]??(refs[i]={current:value})},
     useEffect:(fn,deps)=>{const i=ei++,old=effects[i];if(!old||deps.some((d,n)=>old.deps[n]!==d)){old?.cleanup?.();effects[i]={deps,cleanup:fn()};}}};
   if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
   if(name==='@/components/customer-avatar')return {CustomerAvatar:()=>null};
   if(name==='@/lib/facebook/customer-profile-url')return urls;
   if(name==='@/lib/facebook/profile-lookup-error')return {profileLookupError:r=>r};
   if(name==='@/lib/extension/use-companion')return {useCompanion:()=>({installed:config.installed!==false,version:config.version||'1.2.28',
     openFacebookProfile:options=>{lookups.push(options);return pending},
     openResolvedFacebookProfile:async(token,ctx)=>{opens.push({token,ctx});return config.openResult||{...context,opened:true,verified:true,profileUrl:profile};}})};
   throw Error(name);
 }});
 let tree;const render=()=>{si=ri=ei=0;return tree=exports.CustomerFacebookAvatar({conversation:current})};render();
 return {answer,lookups,opens,patches,clipboard,render,tree:()=>tree,click:()=>tree.props.children[0].props.onClick(),
   unmount:()=>effects.forEach(e=>e.cleanup?.()),switchTo:patch=>{current={...current,...patch};render();}};
}
function findElement(node,predicate){
 if(Array.isArray(node)){for(const child of node){const found=findElement(child,predicate);if(found)return found;}return null;}
 if(!node||typeof node!=='object')return null;
 return predicate(node)?node:findElement(node.props?.children,predicate);
}
test('failed lookup shows a simple customer-facing notice without technical lookup details',async()=>{
 const h=harness();h.click();await tick();h.answer({reason:'profile_customer_heading_missing',token:'SECRET',
  lookupDetails:{expectedName:'Facebook Customer',headingRegions:0,cardRegions:0,profileActions:1,linkActions:1,html:'PRIVATE_CHAT'}});await tick();
 const rendered=JSON.stringify(h.render());
 assert.ok(rendered.includes('profile_customer_heading_missing'));
 assert.ok(!rendered.includes('Copy lookup details'));assert.ok(!rendered.includes('PRIVATE_CHAT'));assert.ok(!rendered.includes('SECRET'));
 assert.equal(h.opens.length,0);
});
test('switching conversations clears the previous customer notice',async()=>{
 const h=harness();h.click();await tick();h.answer({reason:'profile_customer_heading_missing'});await tick();
 assert.ok(JSON.stringify(h.render()).includes('profile_customer_heading_missing'));h.switchTo({id:'other'});
 assert.ok(!JSON.stringify(h.render()).includes('profile_customer_heading_missing'));
});
test('one click resolves, opens verified profile, saves for team with original revision',async()=>{
 const h=harness();h.click();await tick();assert.equal(h.lookups.length,1);h.answer(result);await tick();
 assert.equal(h.opens.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.opens[0].ctx)),context);
 assert.equal(h.patches.length,1);assert.equal(h.patches[0].body.profileUrl,profile);assert.equal(h.patches[0].body.expectedUpdatedAt,'original-revision');
 const link=h.render().props.children[0];assert.equal(link.type,'a');assert.equal(link.props.href,profile);
});
test('double click starts only one lookup',async()=>{const h=harness();h.click();h.click();await tick();assert.equal(h.lookups.length,1);h.answer({reason:'profile_link_missing'});await tick();});
test('same-name different Page/customer/workspace/conversation never opens or saves',async()=>{
 for(const patch of [{pageId:'other'},{threadId:'other'},{businessId:'other'},{conversationId:'other'},{verified:false},{profileUrl:'https://www.facebook.com/987654'},{profileUrl:'https://www.facebook.com/123456'}]){
  const h=harness();h.click();await tick();h.answer({...result,...patch});await tick();assert.equal(h.opens.length,0);assert.equal(h.patches.length,0);
 }
});
for(const action of ['unmount','switch'])test(action+' during lookup cancels opening and saving',async()=>{
 const h=harness();h.click();await tick();if(action==='unmount')h.unmount();else h.switchTo({id:'new-conversation'});
 h.answer(result);await tick();assert.equal(h.opens.length,0);assert.equal(h.patches.length,0);
});
test('saved link is direct anchor, with no extension required',async()=>{
 const h=harness({installed:false,savedUrl:'https://www.facebook.com/customer.test'});await tick();const a=h.render().props.children[0];
 assert.equal(a.type,'a');assert.equal(a.props.href,'https://www.facebook.com/customer.test');assert.equal(a.props.target,'_blank');assert.equal(h.lookups.length,0);
});
test('old or absent extension produces update instruction immediately',async()=>{
 for(const config of [{installed:false},{version:'1.2.25'}]){const h=harness(config);h.click();await tick();assert.equal(h.lookups.length,0);assert.ok(JSON.stringify(h.render()).includes('1.2.28'));}
});
test('comment conversation cannot masquerade as Messenger lookup',async()=>{
 const h=harness();h.switchTo({source_type:'facebook_comment'});h.click();await tick();assert.equal(h.lookups.length,0);assert.ok(JSON.stringify(h.render()).includes('profile_messenger_required'));
});
test('failed open does not persist link',async()=>{
 const h=harness({openResult:{opened:false,reason:'profile_resolution_expired'}});h.click();await tick();h.answer(result);await tick();assert.equal(h.patches.length,0);assert.equal(h.render().props.children[0].type,'button');
});
test('save failure is reported but verified profile remains usable',async()=>{
 const h=harness({saveFailure:true});h.click();await tick();h.answer(result);await tick();assert.equal(h.opens.length,1);assert.equal(h.patches.length,1);
 assert.equal(h.render().props.children[0].type,'a');assert.ok(JSON.stringify(h.tree()).includes('could not save'));
});
test('no manual URL form is added',async()=>{
 const h=harness();h.click();await tick();h.answer({reason:'profile_link_missing'});await tick();assert.ok(!JSON.stringify(h.render()).includes('"type":"form"'));
});
