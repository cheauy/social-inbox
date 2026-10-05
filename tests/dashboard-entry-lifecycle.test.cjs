const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader,tick}=require('./inbox-recovery-harness.cjs');
const artifact=process.env.TENH_ENTRY_BASELINE_DIR;
function setup({baseline=false,delay=0,authDenied=false,subscriptionError=false,adminError=false,adminPromise,subscriptionPromise,actualLifecycle=false,lifecycleError=false,locked=false}={}){
 const events=[],start=performance.now();const mark=event=>events.push({event,ms:performance.now()-start});
 const mocks={'next/navigation':{redirect:href=>{throw Error('redirect:'+href)}},
  '@/lib/auth/get-current-member':{getCurrentMember:async()=>authDenied?{success:false,status:401}:{success:true,user:{id:'user'},member:{id:'member',business_id:'business'}}},
  '@/lib/admin/tenh-admin-auth':{isCurrentUserTenhAdminIdentity:async()=>{mark('admin-start');if(adminPromise)await adminPromise;else if(delay)await new Promise(r=>setTimeout(r,delay));mark('admin-end');if(adminError)throw Error('admin unavailable');return false}},
  '@/lib/subscription/get-business-subscription-access':{getBusinessSubscriptionAccess:async business=>{assert.equal(business,'business');mark('subscription-start');if(subscriptionPromise)await subscriptionPromise;else if(delay)await new Promise(r=>setTimeout(r,delay));mark('subscription-end');if(subscriptionError)throw Error('subscription unavailable');return{locked:false}}},
  '@/components/dashboard/dashboard-utility-navigation':{DashboardUtilityNavigation:'utility',DashboardUtilityNavigationProvider:'utility-provider'},
  '@/components/dashboard/dashboard-header':{DashboardHeader:'header'},'@/components/dashboard/inbox-return-context':{InboxReturnContextProvider:'return-provider'},
  '@/components/dashboard/pending-invitations-banner':{PendingInvitationsBanner:'invitations'},'@/components/dashboard/facebook-connection-attention-banner':{FacebookConnectionAttentionBanner:'facebook'},
  '@/lib/auth/use-workspace-permissions':{WorkspacePermissionsProvider:'permissions'},'@/components/dashboard/removed-workspace-access-boundary':{RemovedWorkspaceAccessBoundary:'removed'},
  '@/components/dashboard/workspace-setup-recovery':{WorkspaceSetupRecovery:'recovery'},'@/components/dashboard/connection-status-banner':{ConnectionStatusBanner:'connection'},
  '@/components/subscription/subscription-access-gate':{SubscriptionAccessGate:'access-gate'}};
 if(actualLifecycle){
  delete mocks['@/lib/subscription/get-business-subscription-access'];
  // Execute both real subscription helpers against a bounded offline DB double.
  // Unexpected operations fail rather than permitting financial writes.
  mocks['@/lib/supabase/admin']={supabaseAdmin:{
   async rpc(name,args){assert.equal(name,'tenh_sync_subscription_lifecycle');assert.equal(args.p_business_id,'business');mark('lifecycle-rpc');return{error:lifecycleError?{message:'lifecycle unavailable'}:null}},
   from(table){assert.equal(table,'business_subscriptions');mark('subscription-select');return{select(columns){assert.equal(columns,'*');return this},eq(key,value){assert.equal(key,'business_id');assert.equal(value,'business');return this},async maybeSingle(){return{data:locked?{status:'expired'}:null,error:subscriptionError?{message:'subscription unavailable'}:null}}}}
  }};
 }
 const load=loader(mocks,{console:{error(){}}}),layout=load(baseline?path.join(artifact,'inbox-entry-baseline-layout.tsx'):'app/dashboard/layout.tsx').default;
 return{events,layout};
}
const nodes=tree=>!tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
test('authorized shell waits for successful admin identity before starting subscription access',async()=>{
 let releaseAdmin,releaseSubscription;const adminPromise=new Promise(r=>releaseAdmin=r),subscriptionPromise=new Promise(r=>releaseSubscription=r),f=setup({adminPromise,subscriptionPromise});const pending=f.layout({children:'protected'});
 try{await tick();assert.equal(f.events.filter(e=>e.event==='admin-start').length,1);assert.equal(f.events.filter(e=>e.event==='subscription-start').length,0,'subscription access includes lifecycle work and must retain its existing invocation gate');releaseAdmin();await tick();assert.equal(f.events.filter(e=>e.event==='subscription-start').length,1);}
 finally{releaseAdmin();releaseSubscription();await pending}
});
test('shell denies unsigned users before either task and preserves subscription failure gate',async()=>{
 const denied=setup({authDenied:true});await assert.rejects(denied.layout({children:'protected'}),/redirect:\/login/);assert.equal(denied.events.length,0);
 const failed=setup({subscriptionError:true});const tree=await failed.layout({children:'protected'});assert.ok(nodes(tree).some(n=>n.type==='header'));assert.ok(!nodes(tree).some(n=>n.props?.children==='protected'));assert.equal(failed.events.filter(e=>e.event==='subscription-start').length,1);
 const admin=setup({adminError:true,subscriptionError:true});await assert.rejects(admin.layout({children:'protected'}),/admin unavailable/);await tick();assert.equal(admin.events.filter(e=>e.event==='subscription-start').length,0);
});
test('controlled shell comparison preserves subscription invocation order',{skip:!artifact},async()=>{
 const results=[];for(const baseline of [true,false]){const f=setup({baseline,delay:40}),start=performance.now();await f.layout({children:'protected'});results.push({baseline,elapsedMs:performance.now()-start,events:f.events,productionLatency:false});assert.equal(f.events.filter(e=>e.event==='subscription-start').length,1);}
 for(const result of results)assert.ok(result.events.find(e=>e.event==='subscription-start').ms>=result.events.find(e=>e.event==='admin-end').ms);console.log(JSON.stringify({dashboardShellGateComparison:results}));
});
test('real lifecycle helpers keep zero RPCs after admin exception and baseline counts on all gates',async()=>{
 for(const baseline of artifact?[true,false]:[false])for(const scenario of [
  {authDenied:true,rpcs:0,reads:0,reject:/redirect:\/login/},
  {adminError:true,rpcs:0,reads:0,reject:/admin unavailable/},
  {rpcs:1,reads:1,protected:true},
  {locked:true,rpcs:1,reads:1,gate:true},
  {subscriptionError:true,rpcs:1,reads:1,protected:false},
  {lifecycleError:true,rpcs:1,reads:0,protected:false},
 ]){
  const f=setup({...scenario,baseline,actualLifecycle:true});let tree;
  if(scenario.reject)await assert.rejects(f.layout({children:'protected'}),scenario.reject);else tree=await f.layout({children:'protected'});
  await tick();assert.equal(f.events.filter(e=>e.event==='lifecycle-rpc').length,scenario.rpcs);assert.equal(f.events.filter(e=>e.event==='subscription-select').length,scenario.reads);
  if(scenario.protected!==undefined)assert.equal(nodes(tree).some(n=>n.props?.children==='protected'),scenario.protected);
  if(scenario.gate){const gate=nodes(tree).find(n=>n.type==='access-gate');assert.ok(gate);assert.equal(gate.props.access.locked,true);}
 }
});
