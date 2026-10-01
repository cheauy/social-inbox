"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, Info, MessageCircle, Phone, Video } from "lucide-react";

type Slot="modern"|"comments";
type Preview={kind:string;channel:string;customerText:string;reply:string;away?:string;publicReply?:string;internal?:string;outcomes?:{kind:string;status:string;text?:string;reason?:string}[]};
const PreviewContext=createContext<((slot:Slot,preview:Preview|null)=>void)|null>(null);
export function useBotPreviewRegistration(slot:Slot,preview:Preview){
 const register=useContext(PreviewContext),encoded=JSON.stringify(preview);
 useEffect(()=>{register?.(slot,JSON.parse(encoded));return()=>register?.(slot,null);},[register,slot,encoded]);
}
export function BotPreviewWorkspace({selected,children}:{selected:Slot;children:ReactNode}){
 const [previews,setPreviews]=useState<Partial<Record<Slot,Preview>>>({});
 const register=useCallback((slot:Slot,preview:Preview|null)=>setPreviews(previous=>({...previous,[slot]:preview??undefined})),[]);
 return <PreviewContext.Provider value={register}><div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div className="min-w-0">{children}</div>
  <aside data-bot-phone-preview className="min-w-0 border-t border-slate-200 bg-slate-50 px-4 py-5 lg:border-l lg:border-t-0">
   <div className="mx-auto w-full max-w-[280px] lg:sticky lg:top-40"><MessengerPreview preview={previews[selected]}/></div>
  </aside>
 </div></PreviewContext.Provider>;
}
function MessengerPreview({preview}:{preview?:Preview}){
 const [scenario,setScenario]=useState("message");
 const reply=scenario==="away"&&preview?.away?preview.away:preview?.reply;
 return <section aria-label="Fictional Messenger preview" className="space-y-3">
  <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-800">Messenger preview</h2><span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">Preview</span></div>
  <p className="text-xs text-slate-500">{preview?.channel||"Choose a Facebook Page"} · Fictional customer</p>
  {preview?.away?<label className="block text-xs text-slate-600">Template scenario<select value={scenario} onChange={event=>setScenario(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2"><option value="message">Welcome template</option><option value="away">Away template</option></select></label>:null}
  {preview?.publicReply?<div data-public-comment-preview className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="text-xs font-semibold text-slate-700">Public Facebook comment</h3><p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">{preview.publicReply}</p></div>:null}
  <div className="overflow-hidden rounded-[34px] border-[7px] border-slate-900 bg-white shadow-sm">
   <div className="flex h-8 items-center justify-center bg-white"><span aria-hidden="true" className="h-4 w-20 rounded-full bg-slate-900"/></div>
   <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-3"><ChevronLeft aria-hidden="true" className="h-4 w-4 text-blue-500"/><div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">A</div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-900">Alex</p><p className="text-[10px] text-slate-400">Sample customer</p></div><Phone aria-hidden="true" className="h-4 w-4 text-blue-500"/><Video aria-hidden="true" className="h-4 w-4 text-blue-500"/></div>
   <div className="min-h-[250px] space-y-4 px-3 py-5"><p className="text-center text-[10px] text-slate-400">Fictional conversation</p>
    <div className="mr-7 rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2.5 text-xs text-slate-700">{preview?.customerText||"Hello, can you help me?"}</div>
    {reply?<div data-template-preview className="ml-7"><p className="mb-1 text-right text-[10px] text-slate-400">{preview?.kind==="facebook_comment_auto_reply"?"Private reply template":"Configured reply template"}</p><div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-blue-500 px-3 py-2.5 text-xs text-white">{reply}</div></div>:<p className="px-3 text-center text-xs text-slate-400">{preview?.internal?"This Bot uses internal actions. No customer reply is shown.":"Write a reply to preview its template here."}</p>}
   </div>
   <div aria-hidden="true" className="flex items-center gap-2 border-t border-slate-100 px-3 py-3"><MessageCircle className="h-4 w-4 text-blue-500"/><span className="flex-1 rounded-full bg-slate-100 px-3 py-1.5 text-[10px] text-slate-400">Preview only</span></div><div aria-hidden="true" className="mx-auto mb-2 h-1 w-20 rounded-full bg-slate-900"/>
  </div>
  {preview?.internal?<div className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="text-xs font-semibold text-slate-700">Internal outcome preview</h3><p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{preview.internal}</p></div>:null}
  {preview?.outcomes?.length?<div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><h3 className="text-xs font-semibold text-blue-800">Sample test plan</h3><ul className="mt-1 space-y-1 text-xs text-blue-700">{preview.outcomes.map((action,index)=><li key={index} className="whitespace-pre-wrap break-words">{action.kind}: {action.status}{action.reason?" — "+action.reason:""}</li>)}</ul></div>:null}
  <p className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-400"><Info aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0"/>Templates show appearance only. Sample tests determine planned actions. Nothing is sent, hidden or activated.</p>
 </section>;
}
