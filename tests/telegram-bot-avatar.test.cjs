const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');
function setup({authorized=true, business='b1', photos=true}={}) {
  let calls=0;
  const db=database({social_accounts:[{id:'a1',business_id:business,platform:'telegram',is_active:true,telegram_token_status:'verified',platform_account_id:'123',telegram_bot_token_encrypted:'encrypted'}]});
  const load=loader({
    'next/server':{NextResponse:Response},
    '@/lib/inbox/get-inbox-resource-access':{authorizeInboxBusinessAccess:async()=>authorized?{success:true,businessId:'b1'}:{success:false,status:403}},
    '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/channels/channel-token-crypto':{decryptChannelCredential:()=> 'private-token'},
    '@/lib/telegram/telegram-api':{
      getTelegramUserProfilePhotos:async()=>{calls++;return {photos:photos?[[{width:96,file_id:'f1'}]]:[]};},
      getTelegramFile:async()=>({file_path:'photos/file.jpg'}),
      downloadTelegramFile:async()=>new Response(new Uint8Array([1,2,3])),
    },
    sharp:()=>({rotate(){return this;},resize(){return this;},jpeg(){return this;},toBuffer:async()=>Buffer.from([1,2,3])}),
  });
  const {GET}=load('app/api/telegram/bot-avatar/route.ts');
  return {get:()=>GET({nextUrl:new URL('https://example.com/api/telegram/bot-avatar?businessId=b1&accountId=a1')}),calls:()=>calls};
}
test('rejects unauthorized photo requests without calling Telegram',async()=>{const h=setup({authorized:false});assert.equal((await h.get()).status,403);assert.equal(h.calls(),0);});
test('does not expose another workspace bot',async()=>{const h=setup({business:'other'});assert.equal((await h.get()).status,404);assert.equal(h.calls(),0);});
test('authorized photo is private and cached',async()=>{const h=setup();const r=await h.get();assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.match(r.headers.get('cache-control'),/^private/);await h.get();assert.equal(h.calls(),1);});
test('missing profile is safely cached',async()=>{const h=setup({photos:false});assert.equal((await h.get()).status,404);await h.get();assert.equal(h.calls(),1);});
