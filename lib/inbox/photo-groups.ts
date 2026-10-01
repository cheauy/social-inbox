import type { InboxMessage } from "@/types/inbox";
import { expandAlbumPhotos, isMessageDeleted } from "./message-actions";
const record = (v:unknown):Record<string,unknown> => v && typeof v==="object" && !Array.isArray(v)?v as Record<string,unknown>:{};
const text = (v:unknown) => typeof v==="string" && v.trim()?v.trim():null;
export type PhotoGroup = {lastId:string;members:InboxMessage[]};
export function photoGroupCaption(members:readonly InboxMessage[]):string {
  return [...new Set(members.map(m=>m.message_text?.trim()).filter((value):value is string=>!!value &&
    !/^\[(image|photo|video)\]$/i.test(value) && !["Sent a photo","Sent a video","Message deleted"].includes(value)))].join("\n");
}
/** Timing is never evidence of an album. Scope identities to the exact sender/thread. */
export function photoAlbumIdentity(message:InboxMessage):string|null {
  const raw=record(message.raw_payload),native=record(raw.message),local=record(raw.tenh_media_group);
  const telegram=message.platform_message_id?.startsWith("telegram:") || raw.tenh_source==="telegram" || !!record(native.chat).id;
  const providerId=telegram?text(native.media_group_id)??text(raw.media_group_id):null;
  const localId=message.direction==="outgoing" && local.provider==="telegram"?text(local.id):null;
  const id=localId??providerId;if(!id)return null;
  const extended=message as InboxMessage&{business_id?:string;social_account_id?:string;sent_by_member_id?:string};
  return JSON.stringify([localId?"tenh-telegram-batch":"telegram",extended.business_id??"",extended.social_account_id??"",message.conversation_id,message.direction,message.sender_platform_id,message.recipient_platform_id,extended.sent_by_member_id??"",id]);
}
export function buildPhotoGroups(messages:readonly InboxMessage[]):Map<string,PhotoGroup>{
  const groups=new Map<string,PhotoGroup>(),batches=new Map<string,InboxMessage[]>();
  // A stored item may arrive before its upload response. Fill missing optimistic
  // scope from that exact batch only when every observed owner agrees.
  const scopeKey=(m:InboxMessage)=>{const local=record(record(m.raw_payload).tenh_media_group);return m.direction==="outgoing"&&local.provider==="telegram"&&text(local.id)?JSON.stringify([m.conversation_id,m.direction,m.sender_platform_id,m.recipient_platform_id,local.id]):null;};
  const scopes=new Map<string,Map<string,Set<string>>>();
  for(const m of messages){const key=scopeKey(m);if(!key)continue;const fields=scopes.get(key)??new Map<string,Set<string>>();for(const field of ["business_id","social_account_id","sent_by_member_id"]){const value=text((m as unknown as Record<string,unknown>)[field]);if(value){const values=fields.get(field)??new Set<string>();values.add(value);fields.set(field,values);}}scopes.set(key,fields);}
  for(const message of messages){
    if(isMessageDeleted(message))continue;
    const native=expandAlbumPhotos(message);
    if(native.length>1){groups.set(message.id,{lastId:message.id,members:native});continue;}
    if(message.message_type!=="image" || !message.attachment_url)continue;
    let scoped=message;const key=scopeKey(message),hint=key?scopes.get(key):null;
    if(hint&&message.id.startsWith("optimistic:")){const fields:Record<string,string>={};for(const [field,values] of hint){if(values.size===1&&!text((message as unknown as Record<string,unknown>)[field]))fields[field]=[...values][0];}scoped={...message,...fields};}
    const identity=photoAlbumIdentity(scoped);if(!identity)continue;
    const batch=batches.get(identity)??[];batch.push(message);batches.set(identity,batch);
  }
  for(const batch of batches.values()){
    // Input follows thread chronology; retain that order and existing last-row anchor.
    const seen=new Set<string>(),members=batch.filter(m=>{const id=m.platform_message_id||m.id;if(seen.has(id))return false;seen.add(id);return true;}).sort((a,b)=>{
      const at=Date.parse(a.platform_created_at??a.created_at),bt=Date.parse(b.platform_created_at??b.created_at);
      if(Number.isFinite(at)&&Number.isFinite(bt)&&at!==bt)return at-bt;
      const ai=Number(a.platform_message_id?.split(":").at(-1)),bi=Number(b.platform_message_id?.split(":").at(-1));
      return Number.isSafeInteger(ai)&&Number.isSafeInteger(bi)?ai-bi:a.id.localeCompare(b.id);
    });
    if(members.length<2)continue;
    const group={lastId:batch[batch.length-1].id,members};for(const item of batch)groups.set(item.id,group);
  }
  return groups;
}
