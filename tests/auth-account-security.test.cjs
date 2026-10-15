/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated Auth mocks and embedded PostgreSQL. Never sends email or revokes real sessions.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loader,database}=require('./tenh-seven/harness.cjs');
const origin='https://app.tenhchat.com';
function account(options={}){
  const effects=[],user={id:'user',email:'person@example.invalid',identities:[{provider:'google'}],user_metadata:{has_password:false},...options.user};
  const client={rpc:async()=>({data:false,error:{message:'old helper unavailable'}}),auth:{
    getUser:async()=>{effects.push('getUser');return {data:{user:options.signedOut?null:user},error:null};},
    signOut:async args=>{effects.push(['provider-revoke',args]);return {error:options.providerError?{message:'offline'}:null};},
  }};
  const load=loader({
    'next/server':{NextResponse:{json:(data,init)=>Response.json(data,init)}},
    'next/headers':{cookies:async()=>({getAll:()=>[{name:'sb-project-auth-token.0'},{name:'tenh_active_business_id'},{name:'theme'}],set:(...args)=>effects.push(['cookie',...args])})},
    '@/lib/auth/get-current-member':{TENH_ACTIVE_BUSINESS_COOKIE:'tenh_active_business_id'},
    '@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/supabase/admin':{supabaseAdmin:{rpc:async(name,args)=>{effects.push(['status',name,args]);if(options.statusThrows)throw Error('fixture network');return {data:options.hasPassword??true,error:options.statusError?{message:'unavailable'}:null};},
      auth:{admin:{updateUserById:async(...args)=>{effects.push(['update',...args]);return {error:null};},signOut:async()=>({error:null})}}}},
    '@supabase/supabase-js':{createClient:()=>({auth:{signInWithPassword:async()=>{effects.push('verify-password');return options.wrongPassword?{data:{user:null},error:{message:'wrong'}}:{data:{user,session:{access_token:'throwaway'}},error:null};}}})},
    '@/lib/auth/session-policy':{checkSessionPolicy:async()=>options.policyDenied?{allowed:false,status:401,reason:'revoked'}:
      {allowed:true,sessionId:'session',recentAuthentication:options.recent!==false},revokeSessionPolicies:async(...args)=>{effects.push(['ledger-revoke',...args]);return !options.ledgerError;}},
    '@/lib/auth/rate-limit':{consumeAuthRateLimit:async()=>({allowed:!options.rateLimited,retryAfterSeconds:60})},
  },{process:{env:{NODE_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture'}}});
  const invoke=async(file,body={},headers={},method='POST')=>{
    const response=await load(file)[method](new Request(origin+'/api/test',{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})}));
    return {status:response.status,...await response.json()};
  };
  return {effects,invoke,load};
}
const password='app/api/account/password/route.ts',recovery='app/api/account/recovery-email/route.ts',logout='app/api/auth/sign-out/route.ts';

test('CSRF trusts the configured app origin rather than matching attacker-controlled request/Host headers',()=>{
  const validate=account().load('lib/auth/mutation-request.ts').validateAuthMutationRequest;
  const forged=new Request('https://attacker.invalid/api/test',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json',Host:'app.tenhchat.com','X-Forwarded-Host':'app.tenhchat.com'}});
  assert.equal(validate(forged).success,false);
  assert.equal(validate(new Request(origin+'/api/test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'}})).success,false);
  assert.equal(validate(new Request(origin+'/api/test',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json; charset=UTF-8'}})).success,true);
});

test('browser account mutations reject sibling/missing/null origins and deceptive JSON before Auth effects',async()=>{
  for(const file of [password,recovery,logout])for(const headers of [{Origin:''},{Origin:'null'},{Origin:'https://tenhchat.com'},{Origin:'https://app.tenhchat.com.attacker.invalid'},{'Content-Type':'application/jsonp'},{'Sec-Fetch-Site':'same-site'}]){
    const h=account(),result=await h.invoke(file,{newPassword:'new-password',recoveryEmail:'backup@example.invalid'},headers);
    assert.ok([403,415].includes(result.status),file+JSON.stringify(headers));assert.deepEqual(h.effects,[]);
  }
});
test('password status errors and non-boolean responses fail closed rather than report passwordless',async()=>{
  for(const options of [{statusError:true},{hasPassword:'false'},{statusThrows:true}]){
    const h=account(options);assert.equal((await h.invoke(password,{}, {},'GET')).status,503);
    assert.equal((await h.invoke(password,{newPassword:'new-password'})).status,503);
    assert.equal(h.effects.some(x=>Array.isArray(x)&&x[0]==='update'),false);
  }
});
test('OAuth accounts with a stored password must verify current password despite editable metadata',async()=>{
  const h=account({hasPassword:true});
  assert.equal((await h.invoke(password,{newPassword:'new-password'})).requiresCurrentPassword,true);
  assert.equal(h.effects.some(x=>Array.isArray(x)&&x[0]==='update'),false);
  assert.equal((await h.invoke(password,{newPassword:'new-password',currentPassword:'old-password'})).status,200);
  assert.ok(h.effects.includes('verify-password'));
  const status=h.effects.find(x=>Array.isArray(x)&&x[0]==='status');assert.equal(status[1],'tenh_account_has_password_for_user');
  assert.equal(status[2].p_user_id,'user');
  const revoke=h.effects.find(x=>Array.isArray(x)&&x[0]==='ledger-revoke');assert.equal(revoke[2],null);assert.equal(revoke[3].exceptSessionId,'session');
});
test('first OAuth password requires recent current-session authentication; revoked sessions cannot update contacts',async()=>{
  const stale=account({hasPassword:false,recent:false});assert.equal((await stale.invoke(password,{newPassword:'new-password'})).status,403);
  const fresh=account({hasPassword:false});assert.equal((await fresh.invoke(password,{newPassword:'new-password'})).wasFirstPassword,true);
  assert.equal(fresh.effects.includes('verify-password'),false);
  const revoked=account({policyDenied:true});assert.equal((await revoked.invoke(recovery,{recoveryEmail:'backup@example.invalid'})).status,401);
  assert.equal(revoked.effects.some(x=>Array.isArray(x)&&x[0]==='update'),false);
});
test('shared limit blocks updates and malformed JSON shapes cannot clear backup contact',async()=>{
  for(const file of [password,recovery]){
    const limited=account({rateLimited:true});assert.equal((await limited.invoke(file,{newPassword:'new-password'})).status,429);
    const invalid=account();assert.equal((await invalid.invoke(file,null)).status,400);
    assert.equal(invalid.effects.some(x=>Array.isArray(x)&&x[0]==='update'),false);
  }
});
test('logout revokes local or global ledger before provider and clears only private cookies even on provider failure',async()=>{
  for(const scope of ['local','global'])for(const providerError of [false,true]){
    const h=account({providerError}),result=await h.invoke(logout,{scope});
    assert.equal(result.status,providerError?502:200);assert.equal(result.signedOutLocally,true);
    const ledger=h.effects.findIndex(x=>Array.isArray(x)&&x[0]==='ledger-revoke'),provider=h.effects.findIndex(x=>Array.isArray(x)&&x[0]==='provider-revoke');
    assert.ok(ledger>=0&&provider>ledger);assert.equal(h.effects[ledger][2],scope==='global'?null:'session');
    const cleared=h.effects.filter(x=>Array.isArray(x)&&x[0]==='cookie').map(x=>x[1]);
    assert.ok(cleared.includes('tenh_active_business_id'));assert.ok(cleared.includes('sb-project-auth-token.0'));assert.equal(cleared.includes('theme'),false);
  }
});

function membershipFixture(){
  const db=database({team_members:[{id:'removed',user_id:'user',business_id:'A',is_active:false,role:'agent'},
    {id:'active',user_id:'user',business_id:'B',is_active:true,role:'owner'}],business_subscriptions:[]});
  const memo=new Map();
  const load=loader({react:{cache:fn=>fn},'next/headers':{cookies:async()=>({get:()=>({value:'A'})})},
    '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})}})},
    '@/lib/supabase/admin':{supabaseAdmin:db},'@/lib/server/usage-context':{attributeUsage:()=>{}},
    '@/lib/server/request-scope':{requestMemo:(key,fn)=>{if(!memo.has(key))memo.set(key,fn());return memo.get(key);}},
    '@/lib/settings/ensure-workspace-default-content':{DEFAULT_TAG_SEED_MARKER:'fixture'},
  });return {db,load};
}
test('a removed selected membership does not hide another active workspace on reads or retarget strict mutations',async()=>{
  const h=membershipFixture(),auth=h.load('lib/auth/get-current-member.ts');
  const read=await auth.getCurrentMember();assert.equal(read.success,true);assert.equal(read.member.business_id,'B');
  const strict=await auth.getCurrentMember(true);assert.equal(strict.success,false);assert.equal(strict.code,'WORKSPACE_ACCESS_REMOVED');
  assert.equal(h.db.history.some(x=>x.op!=='read'),false);
});

test('provisioning calls only the safe wrapper and refuses a foreign or inactive returned membership',async()=>{
  for(const invalid of [false,true]){
    const row={id:'member',business_id:'workspace',user_id:invalid?'another':'user',email:'person@example.invalid',is_active:true};
    const db=database({team_members:[{id:'known',user_id:'user',email:row.email}],business_subscriptions:[]});
    const from=db.from;db.from=name=>{const q=from(name);q.ilike=(key,value)=>{q.filters.push(r=>String(r[key]).toLowerCase()===value.toLowerCase());return q;};return q;};
    const calls=[];db.rpc=async(name)=>{calls.push(name);return {data:[row],error:null};};
    const run=loader({'@/lib/supabase/admin':{supabaseAdmin:db},
      '@/lib/onboarding/trial-security':{getTrialClaimForUser:async()=>null,reserveFreeTrial:async()=>{assert.fail('Existing member must not reserve another trial');}},
      '@/lib/settings/ensure-workspace-default-content':{ensureWorkspaceDefaultContent:async()=>assert.fail('Existing member must not create defaults')},
    })('lib/onboarding/ensure-user-workspace.ts');
    const result=await run.provisionUserWorkspace({id:'user',email:row.email,email_confirmed_at:'2026-10-15T00:00:00Z',user_metadata:{}},new Request(origin));
    assert.equal(result.success,!invalid);assert.deepEqual(calls,['tenh_ensure_user_workspace_safe']);
    assert.equal(db.history.some(x=>x.op!=='read'),false);
  }
});

test('actual account migration: authoritative password, service ACL, inactive membership and retry-safe provisioning',
  {skip:!process.env.TENH_PGLITE_MODULE},async()=>{
    const {PGlite}=require(process.env.TENH_PGLITE_MODULE),db=new PGlite();
    const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    try{
      await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text,raw_user_meta_data jsonb default '{}');
        create table public.team_members(id uuid primary key default gen_random_uuid(),user_id uuid,business_id uuid default gen_random_uuid(),
          email text,full_name text,role text default 'owner',is_active boolean default true,created_at timestamptz default now());
        create function public.tenh_ensure_user_workspace(p_user_id uuid,p_full_name text,p_email text,p_business_name text)
          returns setof public.team_members language plpgsql as $$ begin
          return query insert into public.team_members(user_id,email,full_name) values(p_user_id,p_email,p_full_name) returning *;end $$;
        insert into auth.users values('${id(1)}','one@example.invalid',now(),'bcrypt-existing','{"has_password":false}'),
          ('${id(2)}','two@example.invalid',now(),'', '{"has_password":true}'),
          ('${id(3)}','three@example.invalid',now(),null,'{}'),('${id(4)}','four@example.invalid',null,null,'{}');
        insert into public.team_members(user_id,email,is_active) values('${id(1)}','one@example.invalid',false),('${id(1)}','one@example.invalid',true),
          ('${id(2)}','two@example.invalid',false);`);
      await db.exec(fs.readFileSync('db/migrations/20261015120514_auth_account_provisioning_safety.sql','utf8'));
      const safe=(n,email)=>db.query('select * from public.tenh_ensure_user_workspace_safe($1,$2,$3,$4)',[id(n),'Fixture',email, 'Fixture workspace']);
      const count=async()=>Number((await db.query('select count(*) n from public.team_members')).rows[0].n);
      assert.equal((await db.query('select public.tenh_account_has_password_for_user($1) result',[id(1)])).rows[0].result,true);
      assert.equal((await db.query('select public.tenh_account_has_password_for_user($1) result',[id(2)])).rows[0].result,false);
      const initial=await count();const active=await safe(1,'one@example.invalid');assert.equal(active.rows[0].is_active,true);assert.equal(await count(),initial);
      await assert.rejects(safe(2,'two@example.invalid'),/explicit Owner action/);assert.equal(await count(),initial);
      assert.equal((await db.query('select is_active from public.team_members where user_id=$1',[id(2)])).rows[0].is_active,false);
      await assert.rejects(safe(4,'four@example.invalid'),/verified/);await assert.rejects(safe(3,'one@example.invalid'),/identity mismatch/);
      const first=await safe(3,'three@example.invalid'),again=await safe(3,'three@example.invalid');assert.deepEqual(first.rows,again.rows);assert.equal(await count(),initial+1);
      for(const role of ['anon','authenticated']){
        const acl=(await db.query(`select has_function_privilege($1,'public.tenh_account_has_password_for_user(uuid)','execute') password,
          has_function_privilege($1,'public.tenh_ensure_user_workspace_safe(uuid,text,text,text)','execute') safe,
          has_function_privilege($1,'public.tenh_ensure_user_workspace(uuid,text,text,text)','execute') legacy`,[role])).rows[0];
        assert.deepEqual(acl,{password:false,safe:false,legacy:false});
      }
      await db.exec('set role service_role');
      assert.equal((await db.query('select public.tenh_account_has_password_for_user($1) result',[id(1)])).rows[0].result,true);
      await assert.rejects(db.query('select * from public.tenh_ensure_user_workspace($1,$2,$3,$4)',[id(1),'Fixture','one@example.invalid','Fixture workspace']),/permission denied/);
      assert.equal((await safe(1,'one@example.invalid')).rows[0].user_id,id(1));
      await db.exec('reset role');
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[id(5),'invite@example.invalid',id(6),'fresh@example.invalid']);
      await db.query('insert into public.team_members(user_id,email,is_active) values(null,$1,true)',['invite@example.invalid']);
      const beforeInvitation=await count();await assert.rejects(safe(5,'invite@example.invalid'),/explicit Owner action/);assert.equal(await count(),beforeInvitation);
      await db.exec(`create or replace function public.tenh_ensure_user_workspace(p_user_id uuid,p_full_name text,p_email text,p_business_name text)
        returns setof public.team_members language plpgsql as $$ begin
        return query insert into public.team_members(user_id,email) values('${id(1)}',p_email) returning *;end $$;`);
      await assert.rejects(safe(6,'fresh@example.invalid'),/another or inactive/);assert.equal(await count(),beforeInvitation,'Foreign legacy result must roll back its insertion');
    }finally{await db.close();}
  });
