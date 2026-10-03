const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loader}=require('./tenh-seven/harness.cjs');
const queryHelpers=loader()('lib/storage/workspace-storage-query.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n,extra={})=>({id:id(n),business_id:'shop-a',display_name:`Product ${n}.jpg`,mime_type:'image/jpeg',size_bytes:3,file_kind:'image',storage_bucket:'tenh-workspace-files',storage_path:`shop-a/${n}.jpg`,created_at:'2026-10-03T00:00:00.123456+00:00',deleted_at:null,category_id:null,...extra});
function fixture(options={}) {
 const tables={workspace_files:options.rows??[],workspace_file_categories:[],workspace_file_favorites:options.favorites??[],business_subscriptions:options.subscriptions??[],...options.tables};
 const history=[],signed=[],mutations=[];let strictCalls=0;
 class Query{
  constructor(name){this.name=name;this.filters=[];this.sorts=[];this.count=Infinity;this.selector='';}
  select(value){this.selector=value;return this;}eq(key,value){this.filters.push(r=>key==='workspace_file_favorites.member_id'?tables.workspace_file_favorites?.some(f=>f.member_id===value&&f.file_id===r.id):r[key]===value);return this;}
  is(key,value){this.filters.push(r=>(r[key]??null)===value);return this;}in(key,values){this.filters.push(r=>values.includes(r[key]));return this;}
  order(key,{ascending}){this.sorts.push([key,ascending]);return this;}limit(count){this.count=count;return this;}
  ilike(key,pattern){const literal=pattern.slice(1,-1).replace(/\\([\\%_])/g,'$1').toLowerCase();this.filters.push(r=>r[key].toLowerCase().includes(literal));return this;}
  or(expr){const m=/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^\)]+)\)$/.exec(expr);assert.ok(m,expr);assert.equal(m[1],m[2]);this.filters.push(r=>r.created_at<m[1]||(r.created_at===m[1]&&r.id<m[3]));return this;}
  maybeSingle(){return this.execute(true);}then(resolve,reject){return this.execute().then(resolve,reject);}
  async execute(single=false){history.push({table:this.name,selector:this.selector,count:this.count});
   if(options.readError===this.name)return {data:null,error:{code:'FAIL',message:'Mock database failure'}};
   if(!tables[this.name]||(this.selector.includes('workspace_file_favorites!inner')&&!tables.workspace_file_favorites))return {data:null,error:{code:'42P01'}};
   let rows=tables[this.name].filter(r=>this.filters.every(f=>f(r)));
   rows=[...rows].sort((a,b)=>{for(const [key,asc]of this.sorts){if(a[key]!==b[key])return (a[key]<b[key]?-1:1)*(asc?1:-1);}return 0;}).slice(0,this.count);
   return {data:single?(rows[0]??null):rows,error:null};
  }
 }
 const db={from:name=>new Query(name),storage:{from:bucket=>({createSignedUrl:async path=>{signed.push([bucket,path]);return{data:{signedUrl:'https://mock.invalid/fresh'},error:null};},createSignedUploadUrl:async path=>{mutations.push(path);return{data:{token:'mock-token'},error:null};}})}};
 const member={id:options.memberId??'member-a',business_id:options.businessId??'shop-a',role:'agent'};
 const load=loader({'@/lib/auth/get-current-member':{getCurrentMember:async strict=>{strictCalls++;assert.equal(strict,true);return options.authError?{success:false,status:403,error:'Selected workspace removed'}:{success:true,member};}},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>options.canManage??false},'@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/media/signed-urls':{cachedSignedUrls:async(bucket,paths)=>{signed.push(...paths.map(p=>[bucket,p]));return paths.map(path=>({path,signedUrl:'https://mock.invalid/preview'}));}}});
 const route=load('app/api/workspace-storage/files/route.ts'),categories=load('app/api/workspace-storage/categories/route.ts');
 const get=params=>route.GET(new Request('https://mock.invalid/api/workspace-storage/files'+(params?'?'+new URLSearchParams(params):'')));
 const post=(body,category=false)=>(category?categories:route).POST(new Request('https://mock.invalid/api/workspace-storage/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {get,post,history,signed,mutations,strictCalls:()=>strictCalls};
}
test('strict selection and expired subscriptions block every Storage route before bytes or mutations',async()=>{
 const states=[{authError:true},{subscriptions:[{business_id:'shop-a',status:'expired',created_at:'2026-10-02'}]},
  {subscriptions:[{business_id:'shop-a',status:'active',current_period_end:'2020-01-01',created_at:'2026-10-02'}]},
  {subscriptions:[{business_id:'shop-a',status:'trialing',trial_ends_at:'2020-01-01',created_at:'2026-10-02'}]}];
 for(const options of states){const f=fixture(options);assert.equal((await f.get()).status,options.authError?403:409);
  for(const action of ['prepare-upload','finalize-upload','get-file-url','toggle-favorite','set-category','delete-files'])assert.equal((await f.post({action,fileId:id(1)})).status,options.authError?403:409);
  for(const action of ['add','edit','delete'])assert.equal((await f.post({action,categoryId:id(1),name:'Mock'},true)).status,options.authError?403:409);
  assert.equal(f.history.some(h=>h.table!=='business_subscriptions'),false);assert.equal(f.signed.length,0);assert.equal(f.mutations.length,0);assert.equal(f.strictCalls(),10);
 }
});
test('subscription lookup errors fail closed and latest active/legacy state remains compatible',async()=>{
 const failed=fixture({readError:'business_subscriptions'});assert.equal((await failed.get()).status,500);assert.equal(failed.signed.length,0);
 for(const subscriptions of [[],[{business_id:'shop-a',status:'active',created_at:'2026-10-03',current_period_end:'2999-01-01'}, {business_id:'shop-a',status:'expired',created_at:'2026-10-01'}]]){
  const f=fixture({subscriptions});assert.equal((await f.get()).status,200);
 }
});
test('legacy web GET retains 200-file contract; native keyset pages traverse all 245 files without ties/duplicates',async()=>{
 const rows=Array.from({length:245},(_,i)=>row(i+1)),f=fixture({rows});
 const legacy=await(await f.get()).json();assert.equal(legacy.files.length,200);assert.equal('hasMore'in legacy,false);
 const ids=[];let cursor;
 do{const response=await f.get({limit:'30',...(cursor?{cursor}:{})});assert.equal(response.status,200);const page=await response.json();assert.equal(page.businessId,'shop-a');assert.equal(page.memberId,'member-a');assert.ok(page.files.length<=30);ids.push(...page.files.map(f=>f.id));cursor=page.nextCursor;if(!page.hasMore){assert.equal(cursor,null);break;}}while(cursor);
 assert.equal(ids.length,245);assert.equal(new Set(ids).size,245);assert.equal(ids.at(-1),id(1));assert.ok(f.history.filter(h=>h.table==='workspace_files'&&h.count!==200).every(h=>h.count===31));
});
test('server search, literal wildcard text, types, categories and member favorites apply before pagination',async()=>{
 const old=row(1,{display_name:'Archive 100%_sale.pdf',file_kind:'file',mime_type:'application/pdf',category_id:id(999)});
 const rows=[old,...Array.from({length:244},(_,i)=>row(i+2)),row(999,{business_id:'shop-b',storage_path:'shop-b/999.jpg',display_name:old.display_name})];
 const f=fixture({rows,favorites:[{member_id:'member-a',file_id:id(1)},{member_id:'other-member',file_id:id(2)}]});
 for(const params of [{q:'100%_sale'}, {kind:'files'}, {view:`category:${id(999)}`}, {view:'favorites'}]){
  const response=await f.get({limit:'30',...params});assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.files.map(f=>f.id),[id(1)]);assert.equal(result.hasMore,false);
 }
 assert.ok(f.signed.every(([,path])=>path.startsWith('shop-a/')));
 assert.match(f.history.find(h=>h.selector.includes('!inner')).selector,/workspace_file_favorites!inner/);
});
test('cursors are bound to membership, workspace and filters; malformed/injected requests stop before file queries',async()=>{
 const f=fixture({rows:[row(1),row(2)]});const first=await(await f.get({limit:'1'})).json();assert.ok(first.nextCursor);
 for(const other of [fixture({rows:[row(1)],memberId:'replacement'}),fixture({businessId:'shop-b'}),f]){
  const response=await other.get({limit:'1',cursor:first.nextCursor,...(other===f?{q:'other'}:{})});assert.equal(response.status,400);
 }
 const malicious=Buffer.from(JSON.stringify({createdAt:'2026-10-03T00:00:00Z),business_id.neq.shop-a',id:id(1),key:'a'.repeat(64)})).toString('base64url');
 for(const params of [{cursor:malicious},{cursor:'%%%bad'},{limit:'0'},{limit:'101'},{kind:'any'},{view:'category:bad'},{q:'x'.repeat(121)}]){
  const next=fixture();assert.equal((await next.get(params)).status,400);assert.equal(next.history.some(h=>h.table==='workspace_files'),false);
 }
});
test('foreign bucket/path and deleted file metadata never produce signed media capabilities',async()=>{
 for(const extra of [{business_id:'shop-b',storage_path:'shop-b/1.jpg'},{storage_path:'shop-b/1.jpg'},{storage_path:'shop-a/nested/1.jpg'},{storage_bucket:'foreign-bucket'},{deleted_at:'2026-10-03'}]){
  const f=fixture({rows:[row(1,extra)]});assert.equal((await f.post({action:'get-file-url',fileId:id(1)})).status,404);assert.equal(f.signed.length,0);
  const response=await f.get({limit:'30'});assert.ok([200,500].includes(response.status));assert.equal(f.signed.length,0);
 }
});
test('missing organization permits Recent pages but never silently changes a favorite/category request to Recent',async()=>{
 const f=fixture({rows:[row(1)],tables:{workspace_file_categories:undefined,workspace_file_favorites:undefined}});
 assert.equal((await f.get({limit:'30'})).status,200);assert.equal((await f.get({view:'favorites',limit:'30'})).status,503);assert.equal((await f.get({view:`category:${id(999)}`,limit:'30'})).status,503);
});
test('read-only diagnostic examines catalogs and one bucket, with no customer rows, object data or mutations',()=>{
 const sql=fs.readFileSync('docs/sql/workspace-storage-catalog-diagnostic.sql','utf8'),body=sql.replace(/--[^\n]*/g,'');
 assert.match(body,/begin transaction read only/i);assert.match(body,/pg_policies/);assert.match(body,/aclexplode/);assert.match(body,/storage\.buckets where id = 'tenh-workspace-files'/);
 assert.doesNotMatch(body.replace(/'(?:''|[^'])*'/g,"''"),/\b(?:insert|update|delete|create|alter|drop|grant|revoke|execute|copy|call)\b/i);
 assert.doesNotMatch(body,/\bfrom\s+(?:public\.)?(?:customers?|contacts|messages|workspace_files|workspace_file_favorites|team_members|business_subscriptions|storage\.objects)\b/i);
 assert.equal(queryHelpers.storageSearchPattern('100%_x\\'),'%100\\%\\_x\\\\%');
});
