/* eslint-disable @typescript-eslint/no-require-imports -- Read-only provider return regression. */
const test=require('node:test'),assert=require('node:assert/strict'),{loader}=require('./tenh-seven/harness.cjs');
test('provider close GET is read-only navigation with a presentation hint, never financial cancellation',async()=>{
 const effects=[];const denied=name=>()=>{effects.push(name);throw Error('Unexpected '+name);};
 const route=loader({'next/headers':{cookies:denied('cookies')},'next/server':{NextResponse:{redirect:url=>Response.redirect(url,307)}},
  '@/lib/auth/get-current-member':{getCurrentMember:denied('auth')},'@/lib/billing/cancel-payment':{cancelPayment:denied('cancel')},
  '@/lib/supabase/admin':{supabaseAdmin:{from:denied('database')}}})('app/api/payway/cancel-return/route.ts');
 const url=new URL('https://fixture.invalid/api/payway/cancel-return?tran_id=original-saved');const response=await route.GET({url:url.href,nextUrl:url});
 const redirect=new URL(response.headers.get('location'));assert.equal(redirect.pathname,'/dashboard/subscription/payment');assert.equal(redirect.searchParams.get('tran_id'),'original-saved');assert.equal(redirect.searchParams.get('payway'),'closed');assert.deepEqual(effects,[]);
});
