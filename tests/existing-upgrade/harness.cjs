const {loader,database,baseSeed,ROOT}=require('../tenh-seven/harness.cjs');
class NextRequest extends Request { get nextUrl(){ return new URL(this.url); } }
const NextResponse={json:(data,init={})=>new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...(init.headers||{})}})};
const CONV='11111111-1111-4111-8111-111111111111';
function setup(options={}){
 const seed=baseSeed();seed.conversations[0].id=CONV;seed.facebook_sticker_sends=[];
 if(options.seed)Object.assign(seed,options.seed);
 const db=database(seed);const calls=[],events=[],dispatches=[];
 const member={id:'m1',role:'owner',business_id:'b1',user_id:'u1',full_name:'Agent'};
 const access=async id=>options.denied||!db.tables.conversations.find(x=>x.id===id&&x.business_id==='b1')?{success:false,status:403,error:'Forbidden'}:{success:true,member,businessId:'b1',conversation:db.tables.conversations.find(x=>x.id===id),user:{id:'u1'}};
 const env={STIPOP_API_KEY:'FAKE_TEST_KEY_DO_NOT_USE',...(options.env||{})};
 const scope={success:true,member,businessId:'b1',conversation:db.tables.conversations[0],page:db.tables.social_accounts[0],contact:db.tables.contacts[0]};
 const overrides={
  'next/server':{NextRequest,NextResponse},
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:access},
  '@/lib/auth/get-current-member':{getCurrentMember:async()=>options.denied?{success:false,status:401,error:'Unauthorized'}:{success:true,member}},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>!options.permissionDenied},
  '@/lib/subscription/is-operational-subscription':{businessSubscriptionIsOperational:async()=>!options.expired},
  '@/lib/extension/device-auth':{authenticateDevice:async()=>options.denied?{success:false,status:403,error:'Device revoked'}:{success:true,member,device:{id:'d1',business_id:'b1',user_id:'u1'}},recordExtensionEvent:async event=>events.push(event)},
  '@/lib/facebook/customer-block':{facebookSendBlockReason:async()=>options.blocked?'Customer is blocked':null},
  '@/lib/facebook/messenger-reply-policy':{getFacebookMessengerReplyPolicy:async()=>({windowState:options.windowState||'standard'})},
  '@/app/api/facebook/send-attachment/route':{POST:async request=>{dispatches.push({url:request.url,headers:request.headers,form:await request.formData()});if(options.delegateThrow)throw new Error('Timeout');return NextResponse.json(options.delegateResult||{success:true,messageId:'m_test_1',message:{id:'local1'}},{status:options.delegateStatus||200});}},
 };
 const globals={Buffer,FormData,File,URLSearchParams,crypto:require('node:crypto').webcrypto,process:{env},fetch:async(url,init={})=>{calls.push({url:String(url),init});if(options.fetch)return options.fetch(url,init);return new Response(JSON.stringify({header:{code:'0000'},body:{stickerList:[{stickerId:123,keyword:'Hello',stickerImg:'https://img.stipop.io/test.png'}]}}),{headers:{'content-type':'application/json'}});}};
 const load=loader({...overrides,...(options.overrides||{})},globals);
 const request=(body,{method='POST',origin='https://app.tenhchat.com',path='/api/test',bearer=false}={})=>new NextRequest('https://app.tenhchat.com'+path,{method,headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{}),...(bearer?{Authorization:'Bearer FAKE_DEVICE_CREDENTIAL'}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 return {load,db,events,calls,dispatches,request,scope,env};
}
module.exports={setup,ROOT,CONV,NextRequest,NextResponse};
