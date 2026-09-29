const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');

// Exercise the actual component branches and event handlers using hook/JSX
// doubles. These are structural/handler tests, not real-browser rendering.
function runtime() {
  const slots=[];let cursor=0;
  const React={
    Fragment:Symbol('Fragment'),
    useState(init){const n=cursor++;if(!(n in slots))slots[n]=typeof init==='function'?init():init;return [slots[n],value=>{slots[n]=typeof value==='function'?value(slots[n]):value}]},
    useRef(init){const n=cursor++;if(!(n in slots))slots[n]={current:init};return slots[n]},
    useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){},useLayoutEffect(){},
  };
  const jsx=(type,props,key)=>({type,props:props||{},key});
  return {React,jsx:{jsx,jsxs:jsx,Fragment:React.Fragment},render:(Component,props)=>{cursor=0;return Component(props)},slots};
}
function nodes(tree,predicate){const out=[];function visit(node){if(Array.isArray(node)){node.forEach(visit);return}if(!node||typeof node!=='object')return;if(predicate(node))out.push(node);visit(node.props?.children)}visit(tree);return out;}
function component(name){const fn=()=>null;Object.defineProperty(fn,'name',{value:name});return fn;}
function panelHarness() {
 const rt=runtime(),Copy=component('Copy'),Thumbnail=component('Thumbnail'),Actions=component('Actions'),Box=component('ReplyBox'),noop=()=>null;
 const load=loader({
  react:rt.React,'react/jsx-runtime':rt.jsx,
  '@/components/inbox/messenger-source-card':{MessengerSourceCard:noop},
  '@/lib/inbox/use-facebook-block':{useFacebookBlock:()=>({blocked:false})},
  '@/lib/inbox/use-pinned-messages':{usePinnedMessages:()=>({pins:[],pendingIds:new Set(),toggle:async()=>null})},
  '@/components/inbox/pinned-message-header':{PinnedMessageHeader:noop},
  '@/components/inbox/messenger-message-actions':{MessengerMessageActions:Actions},
  '@/components/inbox/conversation-header':{ConversationHeader:noop},
  '@/components/inbox/reply-box':{ReplyBox:Box},
  '@/components/ui/delete-confirm-dialog':{DeleteConfirmDialog:noop},
  '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'},
  '@/components/inbox/image-copy-button':{ImageCopyButton:Copy},
  '@/components/inbox/reply-image-thumbnail':{ReplyImageThumbnail:Thumbnail},
 }, {URLSearchParams,window:{setTimeout:()=>1,requestAnimationFrame:fn=>fn()},document:{}});
 const {MessagePanel}=load('components/inbox/message-panel.tsx');
 const sent=[];const props={activeConversation:{id:'conv1',business_id:'b1',status:'open',unread_count:0,social_account:{id:'fb1',platform:'facebook',platform_account_id:'p1'},contact:{id:'c1',business_id:'b1',full_name:'Customer',tags:[]}},
  teamMembers:[],viewingAgents:[],typingAgents:[],teamPresence:[],reply:'',replyingToCommentId:null,replyingToFacebookMessageId:null,replyingToTelegramMessageId:null,editingTelegramMessageId:null,
  onReplyToFacebookMessage:id=>sent.push(['facebook',id]),onReplyToTelegramMessage:id=>sent.push(['telegram',id]),onCancelFacebookReply:()=>sent.push(['cancel-facebook']),onCancelTelegramReply:()=>sent.push(['cancel-telegram']),onLoadOlderMessages:async()=>false,
 };
 return {Copy,Thumbnail,Actions,Box,props,sent,render:changes=>rt.render(MessagePanel,{...props,...changes})};
}
const photo=(patch={})=>({id:'m1',business_id:'b1',conversation_id:'conv1',platform_message_id:'mid1',direction:'incoming',message_type:'image',message_text:'[image]',attachment_url:'https://scontent.fbcdn.net/one.jpg',created_at:new Date().toISOString(),platform_created_at:new Date().toISOString(),raw_payload:{},...patch});
const album=()=>photo({raw_payload:{message:{mid:'mid1',attachments:[{type:'image',payload:{url:'https://scontent.fbcdn.net/one.jpg'}},{type:'image',payload:{url:'https://scontent.fbcdn.net/two.jpg'}}]}}});
test('Facebook album renders enabled Reply and Copy for every photo; reactions retain the real row ID',()=>{
 const h=panelHarness(),tree=h.render({messages:[album()]});
 const actions=nodes(tree,node=>node.type===h.Actions&&node.props.photoHover);assert.equal(actions.length,2);
 for(const [i,action] of actions.entries()){assert.equal(action.props.message.id,'m1');assert.equal(action.props.actions.reply,true);action.props.onReply();assert.equal(h.sent[i][1],`m1:photo:${i}`)}
 const copies=nodes(tree,node=>node.type===h.Copy);assert.equal(copies.length,2);assert.equal(copies[1].props.reference.messageId,'m1:photo:1');
});
test('Telegram grouped photos each reply to the correct actual message ID',()=>{
 const h=panelHarness();const msgs=[photo({id:'tg1',platform_message_id:'telegram:123:1'}),photo({id:'tg2',platform_message_id:'telegram:123:2'})];
 const tree=h.render({messages:msgs,activeConversation:{...h.props.activeConversation,social_account:{platform:'telegram'}}});
 const actions=nodes(tree,node=>node.type===h.Actions&&node.props.photoHover);assert.equal(actions.length,2);actions[0].props.onReply();actions[1].props.onReply();assert.deepEqual(h.sent,[['telegram','tg1'],['telegram','tg2']]);
});
test('composer quote uses the exact selected album thumbnail and can cancel that selection',()=>{
 const h=panelHarness(),tree=h.render({messages:[album()],replyingToFacebookMessageId:'m1:photo:1'});
 const thumbs=nodes(tree,node=>node.type===h.Thumbnail);assert.equal(thumbs.length,1);assert.equal(thumbs[0].props.reference.url,'https://scontent.fbcdn.net/two.jpg');
 const selected=nodes(tree,node=>node.type===h.Actions&&node.props.photoHover&&node.props.replying);assert.equal(selected.length,1);selected[0].props.onReply();assert.deepEqual(h.sent,[['cancel-facebook']]);
});
test('a sent image reply renders a thumbnail and jumps to that exact photo inside the album',async()=>{
 const h=panelHarness();const reply=photo({id:'reply',platform_message_id:'mid_reply',direction:'outgoing',message_type:'text',message_text:'This one',attachment_url:null,raw_payload:{reply_to:{mid:'mid1'},tenh_reply:{scope:'facebook',reply_to_local_message_id:'m1',reply_to_platform_message_id:'mid1',preview_text:'Photo',preview_type:'image',preview_image_index:1}}});
 const tree=h.render({messages:[album(),reply]});const thumbs=nodes(tree,node=>node.type===h.Thumbnail);assert.equal(thumbs.length,1);assert.equal(thumbs[0].props.reference.url,'https://scontent.fbcdn.net/two.jpg');
 let scrolled=false;const tile=nodes(tree,node=>node.props?.['data-album-photo-id']==='m1:photo:1')[0];tile.props.ref({scrollIntoView(){scrolled=true}});
 const jump=nodes(tree,node=>node.type==='button'&&node.props.title==='Go to original message')[0];jump.props.onClick({stopPropagation(){}});await Promise.resolve();assert.equal(scrolled,true);
});
test('single photos have Copy and opening the viewer preserves the message reference',()=>{
 const h=panelHarness();let tree=h.render({messages:[photo()]});assert.equal(nodes(tree,node=>node.type===h.Copy).length,1);
 const open=nodes(tree,node=>node.type==='button'&&String(node.props['aria-label']).startsWith('Open '))[0];open.props.onClick();tree=h.render({messages:[photo()]});
 const shortcut=nodes(tree,node=>node.type===h.Copy&&node.props.shortcut)[0];assert.ok(shortcut);assert.equal(shortcut.props.reference.messageId,'m1');
});
test('deleted album does not render copy actions or old image thumbnails',()=>{
 const h=panelHarness(),tree=h.render({messages:[{...album(),raw_payload:{...album().raw_payload,tenh_deleted:{source:'customer'}}}]});
 assert.equal(nodes(tree,node=>node.type===h.Copy).length,0);assert.equal(nodes(tree,node=>node.type===h.Actions&&node.props.photoHover).length,0);
});
function boxHarness(changes={}) {
 const rt=runtime(),noop=()=>null,alerts=[];let submitted=0;const changesSeen=[];
 const load=loader({
  react:rt.React,'react/jsx-runtime':rt.jsx,'emoji-picker-react':noop,'lucide-react':{Send:noop},
  './tenh-sticker-picker':{TenhStickerPicker:noop},
  '@/components/inbox/customer-tag-selector':{CustomerTagSelector:noop},
  '@/components/inbox/location-picker-dialog':{LocationPickerDialog:noop},
  '@/components/inbox/saved-reply-selector':{SavedReplySelector:noop},
  '@/lib/inbox/use-online-status':{useOnlineStatus:()=>({online:true})},
  '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'},
 }, {URLSearchParams,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},window:{alert:message=>alerts.push(message)},document:{querySelector:()=>null},crypto:{randomUUID:()=> 'id'}});
 const {ReplyBox}=load('components/inbox/reply-box.tsx');const props={reply:'',conversationId:'conv1',contactId:'c1',businessId:'b1',initialTags:[],allowAttachments:true,sending:false,error:null,onReplyChange:value=>changesSeen.push(value),onSubmit:()=>{submitted++},...changes};
 const render=()=>rt.render(ReplyBox,props);
 return {render,alerts,slots:rt.slots,changesSeen,submitted:()=>submitted};
}
function paste(h,files,items=[]) {const tree=h.render(),textarea=nodes(tree,node=>node.type==='textarea')[0];let prevented=false;textarea.props.onPaste({clipboardData:{items,files},preventDefault(){prevented=true}});return prevented;}
test('real composer paste handler adds one preview, does not duplicate it, and never auto-sends',()=>{
 const h=boxHarness(),file=new File(['image'],'image.png',{type:'image/png'});assert.equal(paste(h,[file],[{kind:'file',getAsFile:()=>file}]),true);
 const attachments=h.slots.find(slot=>Array.isArray(slot)&&slot[0]?.file);assert.equal(attachments.length,1);assert.equal(attachments[0].kind,'image');assert.equal(h.submitted(),0);assert.equal(h.changesSeen.length,0);
});
test('ordinary text paste stays native and does not add media',()=>{
 const h=boxHarness();assert.equal(paste(h,[],[{kind:'string',getAsFile:()=>null}]),false);assert.equal(h.slots.some(slot=>Array.isArray(slot)&&slot[0]?.file),false);
});
test('paste respects comment attachment restrictions and existing file-size limits',()=>{
 const file=new File(['image'],'x.png',{type:'image/png'});
 const blocked=boxHarness({allowAttachments:false,attachmentsBlockedReason:'Comments take text only'});paste(blocked,[file]);assert.equal(blocked.alerts[0],'Comments take text only');assert.equal(blocked.slots.some(slot=>Array.isArray(slot)&&slot[0]?.file),false);
 const large={name:'large.png',type:'image/png',size:11*1024*1024};const h=boxHarness();paste(h,[large]);assert.match(h.alerts[0],/10 MB/);assert.equal(h.slots.some(slot=>Array.isArray(slot)&&slot[0]?.file),false);
});
