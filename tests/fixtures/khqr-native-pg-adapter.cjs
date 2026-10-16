/* eslint-disable @typescript-eslint/no-require-imports */
// Opt-in adapter for a NEW disposable native PostgreSQL17 cluster only. No automatic provisioning.
const assert=require('node:assert/strict');
function configuration(){
 assert.equal(process.env.TENH_KHQR_NATIVE_TEST_OPT_IN,'I_APPROVE_DISPOSABLE_LOCAL_TEST_DATA','Explicit isolated-test authorization is required');
 const address=process.env.TENH_KHQR_NATIVE_TEST_URL;assert.ok(address,'A dedicated test URL is required');const url=new URL(address);
 assert.ok(['postgres:','postgresql:'].includes(url.protocol),'Only PostgreSQL URLs are allowed');assert.equal(url.search,'','Connection override parameters are forbidden');
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Only loopback PostgreSQL is allowed');
 assert.match(url.pathname,/^\/tenh_khqr_test_[a-z0-9_]+$/,'Use a fresh disposable test database');assert.equal(decodeURIComponent(url.username),'postgres','A dedicated disposable cluster owner is required');
 assert.ok(process.env.TENH_KHQR_NATIVE_PG_MODULE,'Point to an already approved pg client module; this harness installs nothing');
 return{connectionString:address,application_name:'tenh_khqr_isolated_fixture',connectionTimeoutMillis:5000};
}
class PGlite{
 constructor(){
  this.config=configuration();const{Client}=require(process.env.TENH_KHQR_NATIVE_PG_MODULE);this.Client=Client;this.client=new Client(this.config);
  this.ready=this.client.connect().then(async()=>{
   const row=(await this.client.query("select current_setting('server_version_num')::int version,current_database() name,current_user owner,(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema') objects,(select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) app_roles")).rows[0];
   assert.ok(row.version>=170000&&row.version<180000,'PostgreSQL17 is required');assert.equal(row.owner,'postgres');assert.equal(Number(row.objects),0,'Database must be empty');assert.equal(Number(row.app_roles),0,'Use a fresh dedicated cluster, not an existing application cluster');
  });
 }
 async exec(sql){await this.ready;return this.client.query(sql);}
 async query(sql,args){await this.ready;return this.client.query(sql,args);}
 async connection(){await this.ready;const client=new this.Client(this.config);await client.connect();return client;}
 async close(){await this.client.end();}
}
module.exports={PGlite};
