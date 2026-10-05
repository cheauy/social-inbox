/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
// REVIEW generator only: no database, provider, deployment or credential access.
// Requires the separately captured, private five-query enrollment packet.
const fs=require('node:fs'),crypto=require('node:crypto');
const {build:originalBuild}=require('./build-payway-installer-draft.cjs');
const expectedIds=['178798123601437','178798124683199','178740541334731','178740542390545','178740902940328','178793067865680'].sort();
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
// Restore only the two numeric column presentations confirmed by all original
// PostgreSQL MD5s. JSON.stringify would strip their significant trailing zeros.
function serializeEnrollmentCapture(value,path=[]){
 if(['payment_identity.amount','subscription_identity.last_paid_amount'].includes(path.join('.'))){
  if(value===null)return 'null';
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('Captured money must be a finite JSON number.');
  const cents=Math.round(value*100);
  if(!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>0.000001)throw Error('Captured money cannot be rounded during exact serialization.');
  return (cents/100).toFixed(2);
 }
 if(Array.isArray(value))return '['+value.map(item=>serializeEnrollmentCapture(item,path)).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).map(([key,item])=>JSON.stringify(key)+':'+serializeEnrollmentCapture(item,[...path,key])).join(',')+'}';
 return JSON.stringify(value);
}
function validate(packet){
 if(!packet||!Array.isArray(packet.enrollments)||!Array.isArray(packet.payway_pending)||!Array.isArray(packet.manual_pending)||!Array.isArray(packet.constraints)||!packet.constraints.length||!packet.session_settings||!packet.captured_at||!packet.capture_reference)throw Error('Missing authenticated five-query enrollment capture.');
 if(packet.session_settings.default_transaction_isolation!=='read committed')throw Error('Reviewed default transaction isolation must be READ COMMITTED.');
 const ids=packet.enrollments.map(r=>r.provider_transaction_id).sort();
 if(JSON.stringify(ids)!==JSON.stringify(expectedIds))throw Error('Enrollment must contain exactly the six reviewed historical transaction IDs.');
 if(JSON.stringify(packet.payway_pending.map(r=>r.provider_transaction_id).sort())!==JSON.stringify(expectedIds))throw Error('Unknown or missing pending PayWay payments require separate review.');
 if(packet.manual_pending.length)throw Error('Unresolved manual payments require separate review.');
 for(const r of packet.enrollments){
  if(!/^[0-9a-f]{32}$/.test(r.payment_fingerprint)||!/^[0-9a-f]{32}$/.test(r.subscription_fingerprint))throw Error('Original PostgreSQL capture fingerprints are required.');
  if(r.status!=='pending'||r.environment!=='sandbox'||String(r.live_enabled)!=='false'||!r.payment_identity||!r.subscription_identity||!r.payment_fingerprint||!r.subscription_fingerprint||r.verified_at||r.callback_received_at)throw Error('Enrollment state, environment, evidence or baseline requires review.');
  if(r.payment_identity.id!==r.id||r.payment_identity.business_id!==r.business_id||r.payment_identity.provider!=='payway'||r.payment_identity.provider_transaction_id!==r.provider_transaction_id)throw Error('Enrollment identity differs.');
  // Merchant binding remains unknown. Real evidence and a separate review are
  // required before changing this generator to allow captured-v1 activation.
  if(r.activation_policy&&r.activation_policy!=='review'||r.merchant_binding_verified===true)throw Error('This preservation installer supports review-only, unverified merchant enrollment.');
 }
 return packet;
}
function once(source,pattern,replacement,label){let count=0;const result=source.replace(pattern,(...args)=>{count++;return typeof replacement==='function'?replacement(...args):replacement;});if(count!==1)throw Error('Reviewed source boundary differs: '+label);return result;}
function privateCopy(signature,name){return "do $copy$ declare v_source text; begin select pg_get_functiondef("+quote(signature)+"::regprocedure) into v_source; if v_source !~ '^CREATE OR REPLACE FUNCTION public\\.' then raise exception 'Reviewed private copy prefix differs.'; end if; v_source:=regexp_replace(v_source,'^CREATE OR REPLACE FUNCTION public\\.[a-z_]+\\(','CREATE OR REPLACE FUNCTION tenh_billing_private."+name+"('); execute v_source; end $copy$;\n";}
function build(packet){
 validate(packet);
 if(packet.artifact_generation_allowed===false)throw Error('Capture transcription checks have not authorized exact artifact generation.');
 const old=originalBuild(),boundary=old.indexOf('  if exists(select 1 from public.billing_transactions where status=\'pending\'');
 if(boundary<0)throw Error('Original full-source preflight boundary differs.');
 const start=old.slice(0,boundary)+'end;\n$locked_preflight$;\n';
 const core=read('tests/fixtures/payway-legacy-coexistence-core.sql');
 const split=core.indexOf('create or replace function public.tenh_activate_verified_payway_payment(');
 if(split<0)throw Error('Compatibility core boundary differs.');
 const capture=serializeEnrollmentCapture(packet.enrollments),literal=quote(capture)+'::jsonb';
 const constraintLiteral=quote(JSON.stringify(packet.constraints))+'::jsonb';
 const actualConstraints="select jsonb_build_object('conname',conname,'pg_get_constraintdef',pg_get_constraintdef(oid)) as definition from pg_constraint where conrelid in ('public.billing_transactions'::regclass,'public.manual_payment_requests'::regclass)";
 const enroll="\ndo $enrollment$ declare r jsonb;b public.billing_transactions%rowtype;s public.business_subscriptions%rowtype;v_payment_identity jsonb;v_subscription_identity jsonb; begin\n"+
 "if (select count(*) from public.billing_transactions where provider='payway' and status='pending')<>6 or exists(select 1 from public.manual_payment_requests where status in ('draft','pending','submitted')) then raise exception 'Unresolved inventory drifted.'; end if;\n"+
 'if exists((select value from jsonb_array_elements('+constraintLiteral+')) except ('+actualConstraints+')) or exists(('+actualConstraints+') except (select value from jsonb_array_elements('+constraintLiteral+"))) then raise exception 'Captured payment constraints drifted.'; end if;\n"+
 'for r in select value from jsonb_array_elements('+literal+") loop\n select * into b from public.billing_transactions where id=(r->>'id')::uuid; if not found then raise exception 'Captured payment missing.'; end if;\n select * into s from public.business_subscriptions where business_id=b.business_id; if not found then raise exception 'Captured subscription missing.'; end if;\n"+
 "select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_payment_identity from jsonb_each(to_jsonb(b)) where key=any(array['id','business_id','provider','provider_transaction_id','plan_code','billing_cycle','amount','currency','target_member_limit','target_channel_limit','renew_same','pricing_version','pricing_snapshot','requested_by_member_id','request_time','created_at']);\n v_subscription_identity:=to_jsonb(s)-array['id','created_at','updated_at'];\n"+
 "if md5((r->'payment_identity')::text) is distinct from r->>'payment_fingerprint' or md5((r->'subscription_identity')::text) is distinct from r->>'subscription_fingerprint' then raise exception 'Captured raw PostgreSQL identity fingerprint differs from the supplied original oracle.'; end if;\n"+
 "if md5(v_payment_identity::text) is distinct from r->>'payment_fingerprint' or md5(v_subscription_identity::text) is distinct from r->>'subscription_fingerprint' then raise exception 'Live raw PostgreSQL identity fingerprint drifted under the locked preflight.'; end if;\n"+
 "if b.status<>'pending' or b.provider_transaction_id is distinct from r->>'provider_transaction_id' or b.metadata->>'environment' is distinct from 'sandbox' or b.metadata->>'live_enabled' is distinct from 'false' or b.verified_at is not null or b.callback_received_at is not null or public.tenh_compat_payment_identity(to_jsonb(b)) is distinct from public.tenh_compat_payment_identity(r->'payment_identity') or public.tenh_compat_subscription_identity(to_jsonb(s)) is distinct from public.tenh_compat_subscription_identity(r->'subscription_identity') then raise exception 'Captured immutable payment or baseline drifted.'; end if;\n"+
 "insert into tenh_billing_private.legacy_payway_enrollments values(b.id,b.provider_transaction_id,b.business_id,public.tenh_compat_payment_identity(to_jsonb(b)),public.tenh_compat_subscription_identity(to_jsonb(s)),'review',false,'UNKNOWN',"+quote(packet.capture_reference)+",clock_timestamp());\n end loop; end $enrollment$;\n";
 let upgrade=read('db/migrations/20261011_custom_upgrade_optional_extension.sql');
 upgrade=once(upgrade,/  if exists \(select 1 from public\.billing_transactions where status='pending'[\s\S]*?raise exception 'Drain unresolved legacy Custom Upgrade payments before migration\.';\n  end if;/,"  -- Exact enrollment inventory and immutable baselines were checked under the outer locks.",'legacy drain check');
 upgrade=once(upgrade,/lock table public\.billing_transactions, public\.manual_payment_requests,\n  public\.business_subscriptions in share row exclusive mode;/,'-- Outer ACCESS EXCLUSIVE NOWAIT locks already held.','inner locks');
 upgrade=upgrade.replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
 const pricing=read('db/migrations/20261012_custom_capacity_price_alignment.sql').replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
 const signature='public.tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean)';
 const guard="do $guard$ declare v_source text; begin select pg_get_functiondef('public.tenh_guard_custom_upgrade_approval()'::regprocedure) into v_source; if length(v_source)-length(replace(lower(v_source),E'\\nbegin\\n',''))<>7 then raise exception 'Reviewed approval guard boundary differs.'; end if; v_source:=regexp_replace(v_source,E'\\nbegin\\n',E'\\nbegin\\n if tg_table_name=\\'billing_transactions\\' and new.status=\\'approved\\' and old.status is distinct from \\'approved\\' and coalesce(new.pricing_snapshot->>\\'custom_upgrade_version\\',\\'\\')<>\\'2\\' and public.tenh_legacy_approval_authorized(new.id) then return new; end if;\\n','i'); execute v_source; end $guard$;\n";
 return '-- SEPARATE REPLACEMENT REVIEW DRAFT. NOT APPROVED FOR EXECUTION.\n'+
 '-- Captured enrollment is private; do not publish this generated script.\n'+
 '-- Preserves all six payments; merchant unknown => review-only, no activation.\n'+
 '-- Replaces the duplicate-incompatible unique index with cross-provider guards.\n'+
 '-- Requires independently verified full traffic quiescence, native concurrency tests,\n'+
 '-- same-connection fail-fast execution and exact user SQL approval.\n'+
 '-- Original combined installer remains unchanged and is not executed here.\n'+
 start+core.slice(0,split)+enroll+privateCopy(signature,'activate_payway_v1')+
 pricing+'\n'+upgrade+'\n'+privateCopy(signature,'activate_payway_v2')+
 privateCopy('public.tenh_approve_manual_payment(uuid,uuid,text,text)','approve_manual_v2')+
 core.slice(split)+guard+'\ncommit;\n';
}
module.exports={build,validate,serializeEnrollmentCapture};
if(require.main===module){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Supply private capture JSON and separate reviewed output path.');
 const sql=build(JSON.parse(read(input)));fs.writeFileSync(output,sql);
 console.log(JSON.stringify({review_only:true,sha256:crypto.createHash('sha256').update(sql).digest('hex')}));
}
