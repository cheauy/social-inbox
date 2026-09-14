const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database, baseSeed } = require('./tenh-seven/harness.cjs');
for (const echo of [false, true]) test(echo ? 'Page echo preserves the customer comment channel' : 'customer DM switches the channel to Messenger', async () => {
  const seed=baseSeed(), db=database(seed);
  db.failures.push({table:'conversations',op:'upsert',message:'Stop after inspecting channel write'});
  const overrides = {};
  for (const name of ['capture-native-reply','get-message-content','get-facebook-page-access-token','facebook-profile-photo']) overrides[`@/lib/facebook/${name}`]={};
  const load=loader({...overrides,
    '@/lib/inbox/save-detected-customer-phone':{}, '@/lib/inbox/conversation-preview':{},
    '@/lib/facebook/customer-block':{readFacebookBlock:async()=>({state:null})},
    '@/lib/facebook/get-facebook-customer-profile':{getFacebookCustomerProfile:async()=>null},
    '@/lib/supabase/admin':{supabaseAdmin:db},
  }, {console:{log(){},warn(){}}});
  const page=seed.social_accounts[0].platform_account_id, customer=seed.contacts[0].platform_user_id;
  await assert.rejects(load('lib/facebook/process-message.ts').processFacebookMessage({
    sender:{id:echo?page:customer},recipient:{id:echo?customer:page},timestamp:Date.now(),message:{mid:'new-message',text:'Hello',is_echo:echo},
  }), /Stop after inspecting channel write/);
  const write=db.history.find(row=>row.table==='conversations'&&row.op==='upsert').body;
  assert.equal(write.source_type,echo?undefined:'messenger');
});
