/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loader}=require('./tenh-seven/harness.cjs');
const {Buffer}=require('node:buffer');
const uid='10000000-0000-4000-8000-000000000001',current='20000000-0000-4000-8000-000000000001',target='20000000-0000-4000-8000-000000000002';
function fixture(options={}){
  const calls=[];
  const client={auth:{getUser:async()=>({data:{user:{id:uid}},error:null}),
    getSession:async()=>({data:{session:{access_token:'x.'+Buffer.from(JSON.stringify({session_id:'forged-current'})).toString('base64url')+'.x'}}}),
    signOut:async body=>{calls.push(['provider-others',body]);if(options.providerThrows)throw Error('fixture network');return {error:options.providerError?{message:'unavailable'}:null};}},
    rpc:async(name,args)=>{calls.push(['provider-rpc',name,args]);if(options.providerThrows)throw Error('fixture network');return name==='tenh_list_user_sessions'?{data:options.rows??[],error:null}:
      {data:options.missingTarget?false:true,error:options.providerError?{code:'FAIL'}:null};}};
  const load=loader({'@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/supabase/admin':{supabaseAdmin:{rpc:async(name,args)=>{calls.push(['service-rpc',name,args]);return {data:options.rows??[],error:options.listError?{code:'PGRST202'}:null};}}},
    '@/lib/auth/session-policy':{checkSessionPolicy:async()=>options.denied?{allowed:false,status:401,reason:'revoked'}:{allowed:true,sessionId:current},
      revokeSessionPolicies:async(...args)=>{calls.push(['ledger',...args]);return !options.ledgerError;}},
  },{Buffer});return {calls,load,run:load('lib/auth/user-sessions.ts')};
}
test('other-session revocation durably blocks ledger before provider while excluding the verified current session',async()=>{
  const h=fixture(),result=await h.run.revokeOtherSessions();assert.equal(result.success,true);
  const ledger=h.calls.findIndex(x=>x[0]==='ledger'),provider=h.calls.findIndex(x=>x[0]==='provider-others');
  assert.ok(ledger>=0&&provider>ledger);assert.equal(h.calls[ledger][2],null);assert.equal(h.calls[ledger][3].exceptSessionId,current);
  assert.equal(h.calls[provider][1].scope,'others');
});
test('single-device revocation rejects the verified current device and invalid IDs before any mutation',async()=>{
  const h=fixture();assert.equal((await h.run.revokeSession(current)).status,400);
  assert.equal((await h.run.revokeSession('not-a-session')).status,400);assert.deepEqual(h.calls,[]);
});
test('single-device revocation is user-bound, ledger-first and reports partial remote failures honestly',async()=>{
  for(const options of [{},{providerError:true},{providerThrows:true},{ledgerError:true},{missingTarget:true}]){
    const h=fixture(options),result=await h.run.revokeSession(target);
    const ledger=h.calls.findIndex(x=>x[0]==='ledger'),provider=h.calls.findIndex(x=>x[0]==='provider-rpc');
    assert.ok(ledger>=0&&provider>ledger);assert.equal(h.calls[ledger][1].id,uid);assert.equal(h.calls[ledger][2],target);
    assert.equal(result.success,!options.providerError&&!options.providerThrows&&!options.ledgerError&&!options.missingTarget);
    if(options.providerError||options.providerThrows||options.ledgerError)assert.equal(result.status,502);
  }
  for(const options of [{providerError:true},{providerThrows:true},{ledgerError:true}]){const h=fixture(options);assert.equal((await h.run.revokeOtherSessions()).status,502);}
});

test('actual policy-aware list SQL enforces effective expiry, revocation, staged legacy rules and bounded ownership',
  {skip:!(process.env.TENH_AUTH_PGLITE_MODULE||process.env.TENH_PGLITE_MODULE)},async()=>{
    const {PGlite}=require(process.env.TENH_AUTH_PGLITE_MODULE||process.env.TENH_PGLITE_MODULE),db=new PGlite();
    const sid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    try{
      await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
        create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
        create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz,user_agent text,ip inet,aal text);
        create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        insert into auth.users values('${uid}',now(),null,null);`);
      await db.exec(fs.readFileSync('db/migrations/20261015120849_auth_session_policy.sql','utf8'));
      await db.exec(fs.readFileSync('db/migrations/20261015124240_auth_effective_session_list.sql','utf8'));
      const add=async(n,age='0 seconds',owner=uid)=>db.query("insert into auth.sessions(id,user_id,created_at,user_agent) values($1,$2,clock_timestamp()-$3::interval,'Fixture browser')",[sid(n),owner,age]);
      const bind=n=>db.query('select public.tenh_bind_session_policy($1,$2,true)',[uid,sid(n)]);
      const list=async()=> (await db.query('select public.tenh_list_effective_user_sessions($1,$2) result',[uid,current])).rows[0].result;
      await add(1,'2 minutes');await bind(1);await add(2,'1 minute');
      await db.query("update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=$1",[sid(2)]);await bind(2);
      await add(3,'2 days');await db.query("insert into tenh_auth_private.session_policies(session_id,user_id,authenticated_at,expires_at,remembered,kind) select id,user_id,created_at,created_at+interval '1 day',false,'normal' from auth.sessions where id=$1",[sid(3)]);
      await add(4);await bind(4);await db.query('select public.tenh_revoke_session_policies($1,$2,null)',[uid,sid(4)]);
      await add(5);await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[sid(5)]);
      await add(6,'0 seconds','10000000-0000-4000-8000-000000000099');
      await db.query(`insert into auth.sessions(id,user_id,created_at) select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,clock_timestamp() from generate_series(100,205)n`,[uid]);
      await db.query(`insert into tenh_auth_private.session_policies(session_id,user_id,authenticated_at,expires_at,remembered,kind,revoked_at)
        select id,user_id,created_at,created_at+interval '1 day',false,'normal',clock_timestamp() from auth.sessions where id::text>='20000000-0000-4000-8000-000000000100'`);
      const rows=await list();assert.deepEqual(rows.map(x=>x.id),[sid(1),sid(2)]);
      assert.equal(Date.parse(rows[0].not_after),new Date((await db.query('select expires_at from tenh_auth_private.session_policies where session_id=$1',[sid(1)])).rows[0].expires_at).getTime());
      assert.equal(Date.parse(rows[1].not_after),new Date((await db.query('select not_after from auth.sessions where id=$1',[sid(2)])).rows[0].not_after).getTime());
      await add(7,'1 minute');await add(8);
      await db.exec("update tenh_auth_private.session_settings set enforcement_enabled=true,native_rollout_approval='local fixture',legacy_created_before=clock_timestamp()-interval '30 seconds',legacy_grace_until=clock_timestamp()+interval '1 day'");
      assert.deepEqual((await list()).map(x=>x.id).sort(),[sid(1),sid(2),sid(7)].sort());
      for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.tenh_list_effective_user_sessions(uuid,uuid)','execute') allowed",[role])).rows[0].allowed,false);
      await db.exec('set role service_role');assert.equal((await list())[0].id,current);await db.exec('reset role');
      await db.query(`insert into auth.sessions(id,user_id,created_at) select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,clock_timestamp() from generate_series(300,410)n`,[uid]);
      await db.query(`insert into tenh_auth_private.session_policies(session_id,user_id,authenticated_at,expires_at,remembered,kind)
        select id,user_id,created_at,created_at+interval '1 day',false,'normal' from auth.sessions where id::text>='20000000-0000-4000-8000-000000000300'`);
      const bounded=await list();assert.equal(bounded.length,100);assert.equal(bounded[0].id,current);assert.equal(new Set(bounded.map(x=>x.id)).size,100);
    }finally{await db.close();}
  });
test('revoked caller policy cannot enumerate or revoke any session',async()=>{
  const h=fixture({denied:true});
  for(const result of [await h.run.listUserSessions(),await h.run.revokeOtherSessions(),await h.run.revokeSession(target)])assert.equal(result.status,401);
  assert.deepEqual(h.calls,[]);
});
test('listing uses one user-bound effective-policy RPC and verified current identity; missing migration fails closed',async()=>{
  const row={id:current,user_agent:'Mozilla/5.0',not_after:'2026-10-16T00:00:00Z',created_at:'2026-10-15T00:00:00Z'};
  const h=fixture({rows:[row]}),result=await h.run.listUserSessions();
  assert.equal(result.currentSessionId,current);assert.equal(result.sessions[0].expiresAt,row.not_after);assert.equal(result.sessions[0].isCurrent,true);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0][1],'tenh_list_effective_user_sessions');assert.equal(h.calls[0][2].p_user_id,uid);
  const missing=fixture({listError:true});assert.equal((await missing.run.listUserSessions()).success,false);
});
test('revoke endpoint rejects missing/sibling Origin, non-JSON and invalid/null scope before helper mutations',async()=>{
  let mutations=0;
  const route=loader({'@/lib/auth/user-sessions':{revokeOtherSessions:async()=>{mutations++;return {success:true};},revokeSession:async()=>{mutations++;return {success:true};}}})('app/api/settings/sessions/revoke/route.ts');
  for(const [body,headers] of [[{scope:'others'},{Origin:''}],[{scope:'others'},{Origin:'https://tenhchat.com'}],[{scope:'others'},{'Content-Type':'text/plain'}],[null,{}],[{scope:'global',sessionId:target},{}]]){
    const response=await route.POST(new Request('https://app.tenhchat.com/api/settings/sessions/revoke',{method:'POST',headers:{Origin:'https://app.tenhchat.com','Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
    assert.ok([400,403,415].includes(response.status));
  }
  assert.equal(mutations,0);
});
