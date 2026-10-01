import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
const root=process.env.TENH_PGLITE_ROOT;
if(!root){test('disabled Bot storage SQL',{skip:'Requires preinstalled disposable PGlite.'},()=>{});}else{
 const {PGlite}=createRequire(resolve(root,'package.json'))('@electric-sql/pglite');
 test('disabled durable storage enforces atomic revisions, scope, RLS and no activation',async()=>{
  const db=new PGlite();const b='00000000-0000-4000-8000-000000000001',c='00000000-0000-4000-8000-000000000002';
  try{await db.exec(`create role anon;create role authenticated;create role service_role;create table businesses(id uuid primary key);create table social_accounts(id uuid primary key,business_id uuid,is_active boolean,platform text);insert into businesses values('${b}');insert into social_accounts values('${c}','${b}',true,'facebook');`);
   await db.exec(readFileSync(new URL('../db/migrations/20261004_tenh_bot_durable_rules.sql',import.meta.url),'utf8'));
   const save=async(revision,rules=[]) => (await db.query('select tenh_bot_save_rule_set($1,$2,$3,$4::jsonb) result',[b,c,revision,JSON.stringify(rules)])).rows[0].result;
   assert.deepEqual(await save(0),{saved:true,revision:1});assert.equal((await save(0)).saved,false);assert.deepEqual(await save(1),{saved:true,revision:2});assert.equal((await save(1)).saved,false);
   await assert.rejects(save(2,[{businessId:'foreign',channelId:c,mode:'draft'}]),/invalid_scope/);
   await assert.rejects(db.exec('update tenh_bot_rule_sets set enabled=true'),/check constraint/);
   const permissions=(await db.query("select has_function_privilege('anon','tenh_bot_save_rule_set(uuid,uuid,bigint,jsonb)','execute') anon,has_function_privilege('authenticated','tenh_bot_save_rule_set(uuid,uuid,bigint,jsonb)','execute') authenticated,has_function_privilege('service_role','tenh_bot_save_rule_set(uuid,uuid,bigint,jsonb)','execute') service")).rows[0];assert.deepEqual(permissions,{anon:false,authenticated:false,service:true});
   assert.equal((await db.query("select relrowsecurity from pg_class where relname='tenh_bot_rule_sets'")).rows[0].relrowsecurity,true);
   const summary=(await db.query(readFileSync(new URL('../docs/sql/tenh-release-preflight-summary.sql',import.meta.url),'utf8'))).rows[0].tenh_release_preflight;assert.equal(summary.bot_storage.exists,true);assert.equal(summary.expected_functions.length,11);assert.ok(summary.missing_dependencies.includes('messages.id'));
  }finally{await db.close();}
 });
}
