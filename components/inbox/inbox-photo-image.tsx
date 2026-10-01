"use client";
import {useState} from "react";
import {inboxImageEndpoint,type ReplyImageReference} from "@/lib/inbox/message-actions";
const loadedSources = new Set<string>();
function rememberLoaded(src: string) { loadedSources.delete(src); loadedSources.add(src); if (loadedSources.size > 256) loadedSources.delete(loadedSources.values().next().value!); }
/** Stable geometry and bounded recovery; never change the selected album photo. */
export function InboxPhotoImage({src,previewSrc,alt,className,reference,layout="fill",onOpen}:{src:string;previewSrc?:string;alt:string;className:string;reference?:ReplyImageReference;layout?:"single"|"fill"|"preview";onOpen?:()=>void}) {
  const recovery = reference && !reference.messageId?.startsWith("optimistic:") ? inboxImageEndpoint(reference, layout!=="preview") : null;
  const sources = [...new Set([previewSrc?.startsWith("blob:") ? previewSrc : null, src, recovery].filter((url):url is string=>Boolean(url)))];
  const identity = JSON.stringify([sources, reference?.conversationId, reference?.messageId, reference?.photoIndex]);
  const [state,setState]=useState({identity:"",stage:0,loaded:false,attempt:0});
  const current=state.identity===identity?state:{identity,stage:0,loaded:false,attempt:0};
  const source=sources[current.stage],failed=!source,loaded=current.loaded||loadedSources.has(source);
  const image = !failed ? (
    // eslint-disable-next-line @next/next/no-img-element -- Authenticated media requires the browser session.
    <img key={`${source}:${current.attempt}`} src={source} alt={alt} className={className}
      style={layout==="preview"?{position:"relative",display:"block",maxHeight:"92vh",maxWidth:"94vw",width:"auto",height:"auto",objectFit:"contain"}:{position:"absolute",inset:0,height:"100%",width:"100%",objectFit:layout==="single"?"contain":"cover"}}
      loading={layout==="preview"?"eager":"lazy"} decoding="async" ref={element=>{if(element?.complete&&element.naturalWidth>0&&!loaded){rememberLoaded(source);setState({...current,loaded:true});}}}
      onLoad={()=>{rememberLoaded(source);setState({...current,loaded:true});}}
      onError={()=>{loadedSources.delete(source);setState({...current,stage:current.stage+1,loaded:false});}} />
  ) : null;
  return <span className={layout==="preview"?"relative block overflow-hidden":"relative block w-full overflow-hidden bg-slate-100"} data-photo-state={failed?"failed":loaded?"loaded":"loading"}
    style={layout==="preview"?{minWidth:240,minHeight:180}:layout==="single"?{aspectRatio:"4 / 3"}:{height:"100%",minHeight:64}}>
    {failed ? <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-600">
      <span role="img" aria-label={`${alt}: Photo unavailable`}>Photo unavailable</span>
      <button type="button" onClick={event=>{event.stopPropagation();setState({identity,stage:0,loaded:false,attempt:current.attempt+1});}}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700" aria-label={`Retry ${alt}`}>Retry photo</button>
    </span> : <>
      {!loaded ? <span role="status" aria-label={`${alt}: Photo loading`} className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-8 w-8"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 5-5 5 5 3-3 5 5"/><circle cx="15" cy="8" r="1.5"/></svg>
        <span className="sr-only">Photo loading</span>
      </span> : null}
      {onOpen ? <button type="button" onClick={onOpen} className="absolute inset-0 h-full w-full cursor-zoom-in" aria-label={`Open ${alt}`}>{image}</button> : image}
    </>}
  </span>;
}
