/* eslint-disable @typescript-eslint/no-require-imports */
// Local deterministic proposal assembly only. Never connects to any database or provider.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),output=path.join(__dirname,'20261016111054_khqr_checkout_cancellation_atomic.sql');
const sources=['db/migrations/20261016083154_payment_cancellation_safety.sql','db/migrations/20261016093000_bakong_checkout_lifecycle.sql','db/proposals/20261016105717_bakong_closed_checkout_accounting.sql','db/proposals/20261016111428_bakong_admin_original_plan_resolution.sql'];
const contracts=[
 ['public.tenh_apply_bakong_payment(uuid,uuid)','734581860b23f49c831d70163f9ae6a4',false],
 ['public.tenh_bakong_inquiry_status(uuid,text,integer)','1ecd8c644bd746baa06c7dcfb02649aa',false],
 ['tenh_bakong_private.apply_subscription(text,numeric,numeric,text,text,integer,text,jsonb,boolean)','84fac054c9e942ada433a889cb242cd1',false],
 ['tenh_bakong_private.reserved_inquiries(text,uuid)','5100e8ddc036e632e8dce4a29d2657fc',true],
 ['public.tenh_claim_bakong_check(uuid,text,integer)','a2d6677fbce1d804263509cbf4c06174',false],
 ['public.tenh_complete_bakong_check(uuid,uuid,jsonb,uuid)','ec932badc13a255a6ba22ade33d9e549',false],
 ['public.tenh_guard_pending_payment_claim()','c3b036562bcab59da37ef43211dc76d7',true],
 ['public.tenh_issue_billing_invoice(text,uuid)','a66bcfe08a0ee05dc25390f9aaedd911',false],
 ['public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer)','49a41bf868233e6409574b347818de19',true],
];
const relations=[['tenh_bakong_private.request_budgets','budget_key'],['public.business_subscriptions','id'],['public.billing_transactions','id'],['public.bakong_payment_attempts','id'],['public.manual_payment_requests','id'],['public.manual_payment_uploads','id'],['public.tenh_billing_invoices','id'],['tenh_bakong_private.provider_calls','id'],['tenh_bakong_private.settlements','hash'],['tenh_bakong_private.events','id']];
const quote=value=>"'"+String(value).replaceAll("'","''")+"'",sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const components=sources.map(name=>{const raw=fs.readFileSync(path.join(root,name)),normalized=raw.toString('utf8').replace(/\r\n/g,'\n');assert.equal((normalized.match(/^begin;\s*$/gm)||[]).length,1,name+' transaction start');assert.equal((normalized.match(/^commit;\s*$/gm)||[]).length,1,name+' transaction end');return{name,rawSha256:sha(raw),normalizedSha256:sha(normalized),body:normalized.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')};});
const prelude=`-- LOCAL ATOMIC PROPOSAL ONLY. CLI-generated filename; deliberately outside db/migrations.
-- No hosted execution, enablement, provider inquiries, refunds or transfers.
-- Requires the installed CHAT billing/manual/Bakong core through the reviewed authorization era.
-- Expected body hashes were independently matched by read-only metadata queries on CHAT
-- dvieoqprsmzydtepbxwn (PostgreSQL17.6) at 2026-10-16 11:36 UTC. Recheck before any rollout.
-- Fence/drain billing writers before any separately authorized rollout. Unknown/partial schemas fail closed.
-- Component comments are provenance, not separate rollout instructions. Final accounting removes the
-- historical one-hour grace reservations within this single uncommitted transaction. No QR-count cap.
${components.map(c=>'-- Source '+c.name+' raw-sha256='+c.rawSha256+' lf-sha256='+c.normalizedSha256).join('\n')}
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
do $base$
begin
  if current_user not in ('postgres','supabase_admin') or not public.tenh_payment_application_guards_ready()
    or to_regclass('public.payment_cancellations') is not null
    or to_regclass('tenh_bakong_private.late_application_resolutions') is not null then
    raise exception 'Review the trusted owner and exact unmodified CHAT checkout baseline'; end if;
  if not exists(select 1 from pg_attribute where attrelid='public.team_members'::regclass and attname='permissions' and atttypid='jsonb'::regtype and not attisdropped)
    or not exists(select 1 from pg_attribute a where a.attrelid='public.billing_transactions'::regclass and a.attname='request_time' and a.atttypid='text'::regtype and a.attnotnull
      and not exists(select 1 from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)) then
    raise exception 'Review membership permissions and required billing timestamp columns'; end if;
end $base$;
lock table ${relations.map(([name])=>name).join(',')} in share row exclusive mode;
create temporary table khqr_bundle_functions on commit drop as
select p.oid,p.proacl,p.proowner,p.prosecdef,p.proconfig,c.signature,c.body_md5,c.may_change,
  md5(replace(p.prosrc,chr(13),'')) original_body_md5
from (values ${contracts.map(([sig,hash,changes])=>'('+quote(sig)+','+quote(hash)+','+changes+')').join(',\n')}) c(signature,body_md5,may_change)
left join pg_proc p on p.oid=to_regprocedure(c.signature);
do $contracts$
begin
  if exists(select 1 from khqr_bundle_functions where oid is null or original_body_md5<>body_md5) then
    raise exception 'Exact installed checkout function contract mismatch; no partial installation is allowed'; end if;
end $contracts$;
create temporary table khqr_bundle_relations(relation_name text primary key,key_column text) on commit drop;
insert into khqr_bundle_relations values ${relations.map(([name,key])=>'('+quote(name)+','+quote(key)+')').join(',')};
create temporary table khqr_bundle_rows(relation_name text,row_key text,row_digest text,primary key(relation_name,row_key)) on commit drop;
do $snapshot$
declare r record;
begin
  for r in select * from khqr_bundle_relations loop
    execute format('insert into khqr_bundle_rows select %L,t.%I::text,md5(to_jsonb(t)::text) from %s t',r.relation_name,r.key_column,r.relation_name::regclass);
  end loop;
end $snapshot$;
`;
const epilogue=`
-- Read-only deployment capability probe; it never enables the application code gate.
create function public.tenh_khqr_checkout_capabilities() returns jsonb language sql immutable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'accounting','open-checkout-reservations','originalPlanResolution','explicit-admin','qrCountCap',false)
$$;
revoke all on function public.tenh_khqr_checkout_capabilities() from public,anon,authenticated,service_role;
grant execute on function public.tenh_khqr_checkout_capabilities() to service_role;
do $preserve$
declare r record; changed boolean;
begin
  if exists(select 1 from khqr_bundle_functions b left join pg_proc p on p.oid=b.oid where p.oid is null
    or row(p.proacl,p.proowner,p.prosecdef,p.proconfig) is distinct from row(b.proacl,b.proowner,b.prosecdef,b.proconfig)
    or (not b.may_change and md5(replace(p.prosrc,chr(13),''))<>b.original_body_md5)) then
    raise exception 'Existing billing algorithm, RPC identity or privileges changed unexpectedly'; end if;
  for r in select * from khqr_bundle_relations loop
    execute format('select exists((select t.%I::text,md5(to_jsonb(t)::text) from %s t except select row_key,row_digest from khqr_bundle_rows where relation_name=%L) union all (select row_key,row_digest from khqr_bundle_rows where relation_name=%L except select t.%I::text,md5(to_jsonb(t)::text) from %s t))',r.key_column,r.relation_name::regclass,r.relation_name,r.relation_name,r.key_column,r.relation_name::regclass) into changed;
    if changed then raise exception 'Existing rows changed during checkout DDL: %',r.relation_name; end if;
  end loop;
  if exists(select 1 from pg_proc p where p.oid in (
    'public.tenh_request_payment_cancellation(text,text,uuid,uuid,uuid,boolean)'::regprocedure,
    'public.tenh_bakong_original_plan_preview(uuid[])'::regprocedure,
    'public.tenh_apply_reviewed_bakong_original_plan(uuid,uuid,uuid,text,text)'::regprocedure,
    'public.tenh_khqr_checkout_capabilities()'::regprocedure)
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then
    raise exception 'An untrusted client can execute a checkout administration RPC'; end if;
  if not (select relrowsecurity from pg_class where oid='public.payment_cancellations'::regclass)
    or not (select relrowsecurity from pg_class where oid='tenh_bakong_private.late_application_resolutions'::regclass)
    or has_table_privilege('service_role','public.payment_cancellations','INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role','tenh_bakong_private.late_application_resolutions','INSERT,UPDATE,DELETE') then
    raise exception 'Checkout audit storage protection changed'; end if;
  if exists(select 1 from pg_proc where oid in (
    'tenh_bakong_private.reserved_inquiries(text,uuid)'::regprocedure,
    'public.tenh_bakong_blocking_attempt(uuid)'::regprocedure,
    'tenh_bakong_private.original_plan_conflict(uuid)'::regprocedure,
    'public.tenh_bakong_original_plan_preview(uuid[])'::regprocedure) and provolatile<>'v') then
    raise exception 'Authoritative checkout checks must use fresh snapshots after lock waits'; end if;
end $preserve$;
commit;
`;
const sql=prelude+components.map(c=>'\n-- BEGIN COMPONENT '+c.name+'\n'+c.body+'\n-- END COMPONENT '+c.name+'\n').join('')+epilogue;
if(process.argv.includes('--write'))fs.writeFileSync(output,sql);else assert.equal(fs.readFileSync(output,'utf8').replace(/\r\n/g,'\n'),sql,'Rebuild the reviewed local atomic proposal after component edits');
console.log(JSON.stringify({file:path.relative(root,output),sha256:sha(sql),components:components.map(component=>({name:component.name,rawSha256:component.rawSha256,normalizedSha256:component.normalizedSha256}))}));
