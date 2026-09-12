/* Server-side mapping tests: Messenger PSID and Facebook inbox ID are distinct. */
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,baseSeed}=require('../tests/tenh-seven/harness.cjs');
const MODULE='lib/facebook/customer-conversation-link.ts';
const ROUTE='app/api/extension/conversations/open-context/route.ts';
const pageInboxFixture=require('./fixtures/facebook-conversation-page-inbox.json');
const page='203981939455120', psid='26958541250498877', inbox='100003773480379';
const link=`https://business.facebook.com/latest/inbox/all/?asset_id=${page}&business_id=1594812998092301&mailbox_id=${page}&selected_item_id=${inbox}&thread_type=FB_MESSAGE`;
const payload=(p=page,s=psid,l=link,name='Jame Jame')=>({data:[{id:'t_conversation',link:l,participants:{data:[{id:p,name:'Page'},{id:s,name}]}}]});
test('Page inbox: actual Meta response retains relative path and messages section',async()=>{
 const f=pageInboxFixture,h=setup({fetchResults:[f.response]});
 const r=await h.load(MODULE).getCustomerConversationLink(f.pageId,f.psid);
 assert.equal(r.conversationLink,'https://www.facebook.com'+f.response.data[0].link);
 assert.equal(r.graphConversationId,f.response.data[0].id);
 assert.equal(r.customerName,'Jame Jame');assert.equal(r.linkSource,'meta_conversations_api');
});
test('Page inbox: same path format works for other Pages and customers',()=>{
 const api=setup().load(MODULE);
 for(const [p,s,id] of [['111111','99999999999999999','4444444444444444'],['888888','77777777777777777','5555555555555555']]){
  const l=`/${p}/inbox/${id}/?section=messages`;
  assert.equal(api.selectCustomerConversationLink(payload(p,s,l,'Other customer'),p,s).conversationLink,'https://www.facebook.com'+l);
 }
});
test('Page inbox: authorized route returns the actual API path to the extension',async()=>{
 const f=pageInboxFixture,seed=baseSeed();seed.conversations[0].source_type='messenger';
 seed.social_accounts[0].platform_account_id=f.pageId;seed.contacts[0].platform_user_id=f.psid;
 const h=setup({seed,fetchResults:[f.response]});
 const res=await h.load(ROUTE).POST(h.request({businessId:'b1',conversationId:'conv1',pageId:f.pageId,threadId:f.psid,profileLookup:true}));
 assert.equal(res.status,200);assert.equal((await res.json()).conversationLink,'https://www.facebook.com'+f.response.data[0].link);
});
test('Page inbox: wrong Page, section, ambiguous selectors and non-thread paths remain rejected',()=>{
 const f=pageInboxFixture,api=setup().load(MODULE),raw=f.response.data[0].link;
 for(const value of [raw.replace(f.pageId,'111111'),raw.replace('1187032264483411','not-a-thread'),raw.replace('/?','/extra/?'),
  raw.replace('section=messages','section=comments'),raw+'&section=comments',raw+'&selected_item_id=123',raw+'&tid=123',raw+'&asset_id=111111',
  'https://www.facebook.com.evil.test'+raw])assert.equal(api.normalizeFacebookConversationLink(value,f.pageId),null,value);
});
test('distinct API failures are not mislabeled as Meta withholding the link',async()=>{
 const f=pageInboxFixture,api=setup().load(MODULE);
 for(const [change,reason] of [
  [p=>delete p.data[0].link,'profile_conversation_link_missing'],
  [p=>p.data[0].link='/unsupported/path','profile_conversation_link_unsupported'],
  [p=>p.data[0].participants.data[0].id='another','profile_conversation_participants_unmatched'],
  [p=>delete p.data[0].participants.data[0].name,'profile_conversation_name_unavailable'],
  [p=>p.data=[],'profile_conversation_not_found'],
 ]){
  const p=structuredClone(f.response);change(p);assert.equal(api.selectCustomerConversationLink(p,f.pageId,f.psid).reason,reason);
 }
 const h=setup({fetchResults:[{error:{code:100,message:'unsupported requested field'}}]});
 assert.equal((await h.load(MODULE).getCustomerConversationLink(f.pageId,f.psid)).reason,'profile_conversation_request_failed');
});
test('reported customer: provider links a long PSID to a different inbox ID',()=>{
 const api=setup().load(MODULE),r=api.selectCustomerConversationLink(payload(),page,psid);
 assert.equal(r.linkSource,'meta_conversations_api');assert.equal(r.customerName,'Jame Jame');
 assert.equal(new URL(r.conversationLink).searchParams.get('selected_item_id'),inbox);
 assert.ok(!r.conversationLink.includes(psid));
});
test('same algorithm supports other customers and Pages without a Jame-specific rule',()=>{
 const api=setup().load(MODULE);
 for(const [p,s,id] of [['111111','99999999999999999','10000222222222'],['888888','77777777777777777','10000333333333']]){
  const l=`https://business.facebook.com/latest/inbox/all/?asset_id=${p}&selected_item_id=${id}`;
  assert.equal(api.selectCustomerConversationLink(payload(p,s,l,'Other customer'),p,s).conversationLink,l);
 }
});
test('same display name cannot override mismatching participants or Page',()=>{
 const api=setup().load(MODULE);
 for(const p of [payload(page,'000000',link),payload('111111',psid,link)])assert.equal(api.selectCustomerConversationLink(p,page,psid).reason,'profile_conversation_participants_unmatched');
});
test('missing link is unavailable; PSID and Graph thread ID are not used to invent one',()=>{
 const api=setup().load(MODULE),p=payload();delete p.data[0].link;
 const r=api.selectCustomerConversationLink(p,page,psid);assert.equal(r.reason,'profile_conversation_link_missing');assert.equal(r.conversationLink,undefined);
});
test('group, partial participant list, ambiguous matches and paged results are rejected',()=>{
 const api=setup().load(MODULE),group=payload(),partial=payload(),duplicate=payload(),paged=payload();
 group.data[0].participants.data.push({id:'another'});partial.data[0].participants.paging={next:'next'};
 duplicate.data.push({...duplicate.data[0],id:'different'});paged.paging={next:'next'};
 for(const p of [group,partial,duplicate,paged])assert.equal(api.selectCustomerConversationLink(p,page,psid).conversationLink,undefined);
});
for(const bad of ['https://evil.test/messages/t/123','https://www.facebook.com.evil.test/messages/t/123','https://user:password@www.facebook.com/messages/t/123','https://www.facebook.com/galaxystar.james','https://www.facebook.com/profile.php?id=123','https://business.facebook.com/latest/inbox/all/?asset_id=111111&selected_item_id=123','https://business.facebook.com/latest/inbox/all/?asset_id='+page+'&selected_item_id=123&selected_item_id=456','https://business.facebook.com/latest/inbox/all/?asset_id='+page+'&selected_item_id=123&thread_type=COMMENT','javascript:alert(1)'])test('reject non-conversation or conflicting provider link '+bad,()=>{
 const api=setup().load(MODULE);assert.equal(api.normalizeFacebookConversationLink(bad,page),null);
});
test('provider legacy thread link and Messenger thread route are retained without ID conversion',()=>{
 const api=setup().load(MODULE);
 for(const raw of [`/${page}/messages/?tid=cid.c.${page}:${inbox}`,'https://www.facebook.com/messages/t/t_thread_123']){
  const r=api.normalizeFacebookConversationLink(raw,page);assert.ok(r);assert.ok(!r.includes(psid));
 }
});
test('token stays in server Authorization header and requested PSID remains an exact string',async()=>{
 const h=setup({fetchResults:[payload()]}),r=await h.load(MODULE).getCustomerConversationLink(page,psid);
 assert.equal(r.linkSource,'meta_conversations_api');const call=h.calls[0],url=new URL(call.url);
 assert.equal(url.searchParams.get('user_id'),psid);assert.equal(url.searchParams.get('fields'),'id,link,participants');
 assert.equal(url.searchParams.has('access_token'),false);assert.equal(call.init.headers.Authorization,'Bearer FAKE_TOKEN');
 assert.ok(!JSON.stringify(r).includes('FAKE_TOKEN'));
});
for(const code of [10,190,100])test('Meta refusal exposes a safe error without raw provider details '+code,async()=>{
 const h=setup({fetchResults:[{error:{code,message:'secret-sensitive-provider-text'}}]}),r=await h.load(MODULE).getCustomerConversationLink(page,psid);
 assert.ok(r.reason);assert.equal(r.conversationLink,undefined);assert.ok(!JSON.stringify(r).includes('secret-sensitive-provider-text'));
});
test('route rejects unpaired/foreign-workspace context before any Meta request',async()=>{
 for(const config of [{denied:true},{}]){
  const h=setup(config);const response=await h.load(ROUTE).POST(h.request({businessId:'other',conversationId:'conv1',pageId:page,threadId:psid,profileLookup:true}));
  assert.equal(response.status,403);assert.equal(h.calls.length,0);
 }
});
test('missing API link has explicit route status; no fabricated routing response',async()=>{
 const seed=baseSeed();seed.conversations[0].source_type='messenger';const h=setup({seed,fetchResults:[{data:[]}]});
 const response=await h.load(ROUTE).POST(h.request({businessId:'b1',conversationId:'conv1',pageId:seed.social_accounts[0].platform_account_id,threadId:seed.contacts[0].platform_user_id,profileLookup:true}));
 assert.equal(response.status,424);assert.equal((await response.json()).reason,'profile_conversation_not_found');
});
