const test=require('node:test'),assert=require('node:assert/strict');
const {loader}=require('./tenh-seven/harness.cjs');
const scope={userId:'mock-user',workspaceId:'mock-workspace',memberId:'mock-member',conversationId:'mock-thread'};
function fixture(){
 const directories=new Set(),files=new Set(['file:///picked-original.pdf']),deleted=[];let auth;
 class Directory{
  constructor(base,name){this.uri=(typeof base==='string'?base:base.uri).replace(/\/$/,'')+'/'+name;}
  get exists(){return directories.has(this.uri);}create(){directories.add(this.uri);}delete(){deleted.push(this.uri);for(const value of [...files])if(value.startsWith(this.uri+'/'))files.delete(value);for(const value of [...directories])if(value===this.uri||value.startsWith(this.uri+'/'))directories.delete(value);}
 }
 class File{constructor(uri){this.uri=uri;}get exists(){return files.has(this.uri);}delete(){deleted.push(this.uri);files.delete(this.uri);}}
 const load=loader({'expo-file-system':{Directory,File,Paths:{cache:'file:///cache'}},'./supabase/client':{supabase:{auth:{onAuthStateChange(fn){auth=fn;}}}}});
 const api=load('mobile/lib/workspace-storage-drafts.ts'),owner=api.storageDraftOwner(scope);
 let counter=0;
 function stage(keys=['a','b'],selectedScope=scope){const root=api.storageDraftRoot();root.create();const dir=new Directory(root,'operation-'+(++counter));dir.create();const pending=keys.map(key=>({key,uri:dir.uri+'/'+key+'.jpg',kind:'image',name:key+'.jpg',mimeType:'image/jpeg'}));pending.forEach(p=>files.add(p.uri));const discard=api.registerStorageDraft(selectedScope,pending,dir);return {dir,pending,discard};}
 return {api,owner,files,directories,deleted,stage,auth:(event,next)=>auth(event,next)};
}
test('draft removal deletes only its Storage copy; remaining selected files stay valid',()=>{
 const f=fixture(),staged=f.stage();f.api.removeStorageDraftFile(f.owner,'a');
 assert.equal(f.files.has(staged.pending[0].uri),false);assert.equal(f.files.has(staged.pending[1].uri),true);assert.equal(staged.dir.exists,true);assert.equal(f.files.has('file:///picked-original.pdf'),true);
 f.api.removeStorageDraftFile(f.owner,'b');assert.equal(staged.dir.exists,false);
});
test('confirmed send cleans copies; cleared pending during an active send cannot delete transport files',()=>{
 const f=fixture(),staged=f.stage();f.api.beginStorageDraftSend(f.owner,staged.pending);f.api.reconcileStorageDrafts(f.owner,[]);
 assert.ok(staged.pending.every(p=>f.files.has(p.uri)));
 f.api.finishStorageDraftSend(f.owner,new Set(['a','b']),new Set(),[]);assert.equal(staged.dir.exists,false);assert.equal(f.files.has('file:///picked-original.pdf'),true);
});
test('partial send deletes confirmed copies and retains uncertain/unsent copies until user resolves draft',()=>{
 const f=fixture(),staged=f.stage(['a','b','c']);f.api.beginStorageDraftSend(f.owner,staged.pending);
 const pending=staged.pending.filter(p=>p.key!=='a').map(p=>({...p,deliveryUnknown:p.key==='b'}));
 f.api.finishStorageDraftSend(f.owner,new Set(['a']),new Set(['b']),pending);f.api.reconcileStorageDrafts(f.owner,pending);
 assert.equal(f.files.has(staged.pending[0].uri),false);assert.equal(f.files.has(staged.pending[1].uri),true);assert.equal(f.files.has(staged.pending[2].uri),true);
 f.api.detachStorageDrafts(f.owner);assert.equal(f.files.has(staged.pending[2].uri),false);assert.equal(f.files.has(staged.pending[1].uri),true);
 const restored=f.api.attachStorageDrafts(scope);assert.equal(restored.length,1);assert.equal(restored[0].key,'b');assert.equal(restored[0].deliveryUnknown,true);
 f.api.removeStorageDraftFile(f.owner,'b');assert.equal(staged.dir.exists,false);
});
test('unmount during send defers cleanup, then retains only uncertain bytes after transport finishes',()=>{
 const f=fixture(),staged=f.stage(['a','b','c']);f.api.beginStorageDraftSend(f.owner,staged.pending);f.api.detachStorageDrafts(f.owner);
 assert.ok(staged.pending.every(p=>f.files.has(p.uri)));
 f.api.finishStorageDraftSend(f.owner,new Set(['a']),new Set(['b']),[]);
 assert.equal(f.files.has(staged.pending[0].uri),false);assert.equal(f.files.has(staged.pending[1].uri),true);assert.equal(f.files.has(staged.pending[2].uri),false);
 assert.equal(f.api.attachStorageDrafts({...scope,memberId:'replacement'}).length,0);assert.equal(f.api.attachStorageDrafts(scope).length,1);
});
test('cancelled/rejected staging and clear-all release complete owned directories idempotently',()=>{
 const f=fixture(),cancelled=f.stage();cancelled.discard();cancelled.discard();assert.equal(cancelled.dir.exists,false);
 const accepted=f.stage();f.api.clearStorageDraftOwner(f.owner);assert.equal(accepted.dir.exists,false);assert.equal(f.files.has('file:///picked-original.pdf'),true);
});
test('unmount cleans ordinary accepted drafts even without a send',()=>{
 const f=fixture(),staged=f.stage();f.api.detachStorageDrafts(f.owner);assert.equal(staged.dir.exists,false);
});
test('logout and account switch clear the fixed Storage namespace, including uncertain copies and interrupted orphan copies',()=>{
 for(const event of ['SIGNED_OUT','SIGNED_IN']){
  const f=fixture(),staged=f.stage();f.api.beginStorageDraftSend(f.owner,staged.pending);f.api.finishStorageDraftSend(f.owner,new Set(),new Set(['a','b']),[]);
  f.files.add('file:///cache/tenh-storage-drafts/orphan/partial.jpg');
  f.auth(event,event==='SIGNED_OUT'?null:{user:{id:'other-user'}});
  assert.equal([...f.files].some(uri=>uri.includes('/tenh-storage-drafts/')),false);assert.equal(f.files.has('file:///picked-original.pdf'),true);assert.equal(f.api.attachStorageDrafts(scope).length,0);
 }
});
test('refresh for same account preserves drafts; ownership rejects actual user originals',()=>{
 const f=fixture(),staged=f.stage();f.auth('TOKEN_REFRESHED',{user:{id:scope.userId}});assert.equal(staged.dir.exists,true);
 assert.throws(()=>f.api.registerStorageDraft(scope,[{key:'original',uri:'file:///picked-original.pdf'}],staged.dir),/ownership/);
 assert.equal(f.files.has('file:///picked-original.pdf'),true);
});
test('late staging after logout/account switch cannot register the old account or clear a new account draft',()=>{
 const f=fixture(),old=f.stage();f.auth('SIGNED_IN',{user:{id:'new-user'}});
 const next=f.stage(['new'],{...scope,userId:'new-user'});assert.equal(next.dir.exists,true);
 assert.throws(()=>f.api.registerStorageDraft(scope,old.pending,old.dir),/account changed/);assert.equal(next.dir.exists,true);
});
