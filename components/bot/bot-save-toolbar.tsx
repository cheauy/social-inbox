"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle, Save } from "lucide-react";

type Slot="modern"|"comments";
export type BotSaveResult={ok:boolean;message:string};
type SaveState={dirty:boolean;busy:boolean;canSave:boolean;message:string;save:()=>Promise<BotSaveResult>};
const SaveContext=createContext<((slot:Slot,state:SaveState|null)=>void)|null>(null);

/** Register stable commands without lifting or discarding either editor's state. */
export function useBotSaveRegistration(slot:Slot,state:Omit<SaveState,"save">,save:()=>Promise<BotSaveResult>) {
 const register=useContext(SaveContext),command=useRef(save);
 useEffect(()=>{command.current=save;},[save]);
 const execute=useCallback(()=>command.current(),[]);
 const {dirty,busy,canSave,message}=state;
 useEffect(()=>{register?.(slot,{dirty,busy,canSave,message,save:execute});return()=>register?.(slot,null);},[register,slot,dirty,busy,canSave,message,execute]);
 return register!==null;
}

export function BotSaveWorkspace({children,heading}:{children:ReactNode;heading?:ReactNode}) {
 const [editors,setEditors]=useState<Partial<Record<Slot,SaveState>>>({}),[saving,setSaving]=useState(false),[report,setReport]=useState<BotSaveResult|null>(null);
 const inFlight=useRef(false);
 const register=useCallback((slot:Slot,state:SaveState|null)=>setEditors(previous=>({...previous,[slot]:state??undefined})),[]);
 const pending=(['modern','comments'] as Slot[]).filter(slot=>editors[slot]?.dirty),busy=saving||Object.values(editors).some(editor=>editor?.busy);
 const blocked=pending.find(slot=>!editors[slot]?.canSave);
 useEffect(()=>{
  if(!pending.length)return;
  const leave=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const anchor=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement|null;
   if(!anchor||anchor.target==="_blank"||anchor.hasAttribute("download"))return;
   const next=new URL(anchor.href,window.location.href);
   if(next.pathname===window.location.pathname&&next.search===window.location.search)return;
   if(!window.confirm("Leave without saving these Bot rules? Your unfinished changes will be lost.")){event.preventDefault();event.stopPropagation();}
  };
  document.addEventListener("click",leave,true);return()=>document.removeEventListener("click",leave,true);
 },[pending.length]);
 async function saveAll(){
  if(inFlight.current||busy||!pending.length||blocked)return;
  inFlight.current=true;setSaving(true);setReport(null);const completed:string[]=[],messages:string[]=[];
  try{for(const slot of pending){const result=await editors[slot]!.save();if(!result.ok){setReport({ok:false,message:(completed.length?completed.join(" and ")+" saved. ":"")+result.message+" Unsaved work is retained."});return;}completed.push(slot==="modern"?"Page Bot rules":"Comment Auto Reply");messages.push(result.message);}setReport({ok:true,message:messages.join(" ")});}
  catch{setReport({ok:false,message:(completed.length?completed.join(" and ")+" saved. ":"")+"The remaining save failed. Unsaved work is retained."});}
  finally{inFlight.current=false;setSaving(false);}
 }
 return <SaveContext.Provider value={register}>
  <div data-bot-save-toolbar className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
   <div className="min-w-0 flex-1">{heading}<p role={report?.ok===false?"alert":"status"} className={`text-sm ${report?.ok===false?"text-red-700":"text-slate-600"}`}>
    {saving?"Saving changes…":report?.ok===false?report.message:blocked?editors[blocked]?.message:pending.length?"Unsaved rule changes":report?.message??"No unsaved rules"}</p>
    <p className="mt-0.5 text-xs text-slate-400">Bot rules save together for the selected Page. Comment Auto Reply saves separately.</p>
   </div>
   <button type="button" onClick={()=>void saveAll()} disabled={busy||!pending.length||Boolean(blocked)} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50">
    {saving?<LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none"/>:report?.ok&&!pending.length?<Check aria-hidden="true" className="h-4 w-4"/>:<Save aria-hidden="true" className="h-4 w-4"/>}
    {saving?"Saving…":"Save all changes"}
   </button>
  </div>
  {children}
 </SaveContext.Provider>;
}
