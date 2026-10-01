import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {readFileSync} from 'node:fs';
const root=process.env.TENH_PGLITE_ROOT;
if(!root){test('table privilege repair',{skip:'Disposable PGlite required'},()=>{});}else{
 const {PGlite}=createRequire(resolve(root,'package.json'))('@electric-sql/pglite');
 const names=['tenh_bot_rule_sets','tenh_bot_execution_controls','tenh_bot_recipient_state','tenh_bot_events','tenh_bot_execution_jobs'];
 const sql=readFileSync(new URL('../docs/sql/tenh-bot-service-table-privilege-repair.sql',import.meta.url),'utf8');
 const maintain=readFileSync(new URL('../docs/sql/tenh-bot-maintain-repair-and-verify.sql',import.meta.url),'utf8');
 async function fixture(){const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;alter default privileges in schema public grant all on tables to service_role;');for(const n of names)await db.exec(`create table public.${n}(id integer primary key);alter table public.${n} enable row level security;insert into public.${n} values(1);`);return db;}
 test('default ALL grants reproduce excess access; bounded repair preserves rows and S/I/U without changing defaults',async()=>{const db=await fixture();try{
  for(const n of names)assert.equal((await db.query(`select has_table_privilege('service_role','public.${n}','DELETE') allowed`)).rows[0].allowed,true);
  await db.exec(sql);
  for(const n of names){for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await db.query(`select has_table_privilege('service_role','public.${n}',$1) allowed`,[p])).rows[0].allowed,['SELECT','INSERT','UPDATE'].includes(p));assert.equal((await db.query(`select count(*) n from public.${n}`)).rows[0].n,1);}
  await db.exec('create table public.unrelated(id integer)');assert.equal((await db.query("select has_table_privilege('service_role','public.unrelated','DELETE') allowed")).rows[0].allowed,true);
 }finally{await db.close();}});
 test('MAINTAIN-only combined repair verifies the complete table privilege set while preserving data/defaults',async()=>{const db=await fixture();try{
  await db.exec(sql);assert.equal((await db.query("select has_table_privilege('service_role','public.tenh_bot_events','MAINTAIN') allowed")).rows[0].allowed,true);
  const results=await db.exec(maintain),verification=results.at(-1).rows[0].tenh_release_postinstall;
  assert.ok(verification.tables.every(t=>t.present&&t.service_maintain===false&&t.service_maintain_grant_option===false&&t.service_any_column_references===false&&Object.values(t.service_grant_options).every(x=>x===false)));
  for(const n of names){assert.equal((await db.query(`select count(*) n from public.${n}`)).rows[0].n,1);for(const p of ['SELECT','INSERT','UPDATE'])assert.equal((await db.query(`select has_table_privilege('service_role','public.${n}',$1) allowed`,[p])).rows[0].allowed,true);}
  await db.exec('create table public.unchanged_default(id integer)');assert.equal((await db.query("select has_table_privilege('service_role','public.unchanged_default','MAINTAIN') allowed")).rows[0].allowed,true);
 }finally{await db.close();}});
 for(const mode of ['pg_maintain','grant_option','column_reference'])test(`MAINTAIN repair rolls back rather than broadening ${mode} correction`,async()=>{const db=await fixture();try{
  await db.exec(sql);
  if(mode==='pg_maintain')await db.exec('grant pg_maintain to service_role');
  else if(mode==='grant_option')await db.exec('grant select on public.tenh_bot_events to service_role with grant option');
  else await db.exec('grant references(id) on public.tenh_bot_events to service_role');
  await assert.rejects(db.exec(maintain),/separately approved role correction|grant option requires separate review|column privileges require separate review/);await db.exec('rollback');
  assert.equal((await db.query("select has_table_privilege('service_role','public.tenh_bot_rule_sets','MAINTAIN') allowed")).rows[0].allowed,true);
 }finally{await db.close();}});
 for(const mode of ['inheritance','ownership'])test(`remaining ${mode} rights abort the repair without changing roles or tables`,async()=>{const db=await fixture();try{
  if(mode==='inheritance')await db.exec('create role inherited_access;grant inherited_access to service_role;grant delete on public.tenh_bot_events to inherited_access');else await db.exec('alter table public.tenh_bot_events owner to service_role');
  await assert.rejects(db.exec(sql),/Excess effective service privilege remains|Unexpected service ownership/);await db.exec('rollback');
  assert.equal((await db.query("select has_table_privilege('service_role','public.tenh_bot_rule_sets','DELETE') allowed")).rows[0].allowed,true);
  assert.equal((await db.query('select count(*) n from public.tenh_bot_events')).rows[0].n,1);
 }finally{await db.close();}});
}
