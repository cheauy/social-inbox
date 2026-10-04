const test=require('node:test'),assert=require('node:assert/strict');const {loader}=require('./tenh-seven/harness.cjs');
function fixture({admin=false,subscriptionError=false,signedOut=false}={}){let identityCalls=0;const overrides={
 'next/navigation':{redirect:path=>{throw Error('redirect:'+path)}},
 '@/lib/auth/get-current-member':{getCurrentMember:async()=>signedOut?{success:false,status:401}:{success:true,user:{id:'fixture-user'},member:{id:'fixture-member',business_id:'fixture-business'}}},
 '@/lib/admin/tenh-admin-auth':{isCurrentUserTenhAdminIdentity:async()=>{identityCalls++;return admin}},
 '@/lib/subscription/get-business-subscription-access':{getBusinessSubscriptionAccess:async()=>{if(subscriptionError)throw Error('Synthetic subscription failure');return {allowed:true}}},
 '@/components/dashboard/dashboard-utility-navigation':{DashboardUtilityNavigation:'utility-navigation',DashboardUtilityNavigationProvider:'utility-provider'},
 '@/components/dashboard/dashboard-header':{DashboardHeader:'dashboard-header'},
 '@/components/dashboard/pending-invitations-banner':{PendingInvitationsBanner:'invitations'},
 '@/components/dashboard/facebook-connection-attention-banner':{FacebookConnectionAttentionBanner:'facebook-attention'},
 '@/lib/auth/use-workspace-permissions':{WorkspacePermissionsProvider:'permissions'},
 '@/components/dashboard/removed-workspace-access-boundary':{RemovedWorkspaceAccessBoundary:'removed-access'},
 '@/components/dashboard/workspace-setup-recovery':{WorkspaceSetupRecovery:'workspace-recovery'},
 '@/components/dashboard/connection-status-banner':{ConnectionStatusBanner:'connection-banner'},
 '@/components/subscription/subscription-access-gate':{SubscriptionAccessGate:'subscription-gate'}};
 return {layout:loader(overrides,{console:{error(){}}})('app/dashboard/layout.tsx').default,calls:()=>identityCalls};}
function nodes(element){if(!element||typeof element!=='object')return [];return [element,...[element.props?.children].flat(Infinity).flatMap(nodes)];}
for(const admin of [false,true])test('shared layout forwards existing server admin identity '+admin,async()=>{const f=fixture({admin}),tree=await f.layout({children:'Fixture content'});assert.equal(tree.type,'utility-provider');assert.equal(tree.props.isAdmin,admin);assert.equal(f.calls(),1);assert(nodes(tree).some(n=>n.type==='utility-navigation'&&n.props.placement==='shared'));assert(nodes(tree).some(n=>n.type==='subscription-gate'));});
test('subscription read error retains authorized navigation without bypassing access gate',async()=>{const f=fixture({admin:true,subscriptionError:true}),tree=await f.layout({children:'Protected content'});assert.equal(tree.props.isAdmin,true);assert(nodes(tree).some(n=>n.type==='utility-navigation'));assert(!nodes(tree).some(n=>n.props?.children==='Protected content'));});
test('signed-out layout still redirects before admin navigation identity checks',async()=>{const f=fixture({signedOut:true});await assert.rejects(f.layout({children:'Protected'}),/redirect:\/login/);assert.equal(f.calls(),0);});
