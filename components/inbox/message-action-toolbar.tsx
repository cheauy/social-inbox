"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MessageActionToolbarProps = {
  outgoing: boolean;
  actions: { reply: boolean; pin: boolean; edit: boolean; delete: boolean };
  replying: boolean;
  pinned: boolean;
  pinPending?: boolean;
  reactionControl?: ReactNode;
  copyControl?: ReactNode;
  reserveActions?: MessageActionToolbarProps["actions"];
  reserveReaction?: boolean;
  keepVisible?: boolean;
  photoHover?: boolean;
  contextual?: boolean;
  onReply: () => void;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function MessageActionToolbar({ outgoing, actions, replying, pinned, pinPending, reactionControl, copyControl, reserveActions, reserveReaction, keepVisible, photoHover, contextual, onReply, onPin, onEdit, onDelete }: MessageActionToolbarProps) {
  if (!Object.values(actions).some(Boolean) && !reactionControl && !copyControl && !reserveActions && !reserveReaction) return null;
  const normal = "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 disabled:cursor-wait";
  // Keep the same responsive footprint before provider confirmation enables actions.
  const reservation = (enabled: boolean) => enabled ? {} : {
    disabled: true, "aria-hidden": true as const, tabIndex: -1,
    style: { visibility: "hidden" as const, pointerEvents: "none" as const },
  };
  const controls = (afterAction?: () => void) => {
    const run = (action: () => void) => () => { action(); afterAction?.(); };
    return <div role="group" aria-label="Message actions" className={`inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 text-[11px] shadow-[0_1px_4px_rgba(15,23,42,0.10)] [&>*]:shrink-0 ${contextual ? "[&>button]:min-h-11 [&>button]:min-w-11" : ""}`} onClick={(event) => event.stopPropagation()}>
        {!contextual && copyControl}
        {reactionControl ?? (reserveReaction ? <span aria-hidden="true" className="h-7 w-8" /> : null)}
        {(actions.reply || reserveActions?.reply) && <button type="button" {...reservation(actions.reply)} className={normal} onClick={run(onReply)}>{replying ? "Cancel reply" : "Reply"}</button>}
        {(actions.pin || reserveActions?.pin) && <button type="button" disabled={pinPending} {...reservation(actions.pin)} className={normal} title="Pin in this TENH conversation" onClick={run(onPin)}>{pinPending ? "Saving…" : pinned ? "Unpin" : "Pin"}</button>}
        {(actions.edit || reserveActions?.edit) && <button type="button" {...reservation(actions.edit)} className={normal} onClick={run(onEdit)}>Edit</button>}
        {(actions.delete || reserveActions?.delete) && <button type="button" {...reservation(actions.delete)} className={`${normal} hover:!bg-red-50 hover:!text-red-600`} onClick={run(onDelete)}>Delete</button>}
      </div>;
  };
  if (contextual) return <AlbumActionMenu outgoing={outgoing} disabled={!Object.values(actions).some(Boolean) && !reactionControl} controls={controls} />;
  return (
    <div data-message-action-toolbar data-message-action-persistent={keepVisible || undefined} className={`mt-1 flex min-w-0 px-1 ${keepVisible ? "opacity-100" : "opacity-0"} transition-opacity duration-150 focus-within:opacity-100 ${photoHover ? "group-hover/photo:opacity-100" : "group-hover:opacity-100"} [@media(hover:none)]:opacity-100 ${outgoing ? "justify-end" : "justify-start"}`}>
      {controls()}
    </div>
  );
}

function AlbumActionMenu({outgoing,disabled,controls}:{outgoing:boolean;disabled:boolean;controls:(afterAction:()=>void)=>ReactNode}) {
  const [open,setOpen]=useState(false),[position,setPosition]=useState({top:0,left:0});
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),id=useId();
  const close=useCallback(()=>setOpen(false),[]);
  useLayoutEffect(()=>{
    if(!open || !panel.current || !trigger.current) return;
    const anchor=trigger.current.getBoundingClientRect(),box=panel.current.getBoundingClientRect();
    const left=Math.max(8,Math.min(outgoing?anchor.right-box.width:anchor.left,window.innerWidth-box.width-8));
    const top=Math.max(8,Math.min(anchor.top>=box.height+8?anchor.top-box.height-4:anchor.bottom+4,window.innerHeight-box.height-8));
    setPosition(previous=>previous.top===top && previous.left===left?previous:{top,left});
  },[open,outgoing,controls]);
  useEffect(()=>{
    if(!open) return;
    const popup=panel.current,button=trigger.current;
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    const outside=(event:PointerEvent)=>{
      const target=event.target as HTMLElement;
      if(!panel.current?.contains(target) && !trigger.current?.contains(target) && !target.closest?.('[aria-label="Choose a Messenger reaction"]')) setOpen(false);
    };
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape') close();};
    const scroll=(event:Event)=>{if(!panel.current?.contains(event.target as Node)) setOpen(false);};
    const resize=()=>setOpen(false);
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',resize);
    return()=>{
      document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',resize);
      if(button?.isConnected && (document.activeElement===document.body || popup?.contains(document.activeElement))) button.focus({preventScroll:true});
    };
  },[open,close]);
  return <div data-album-action-menu className={`absolute -left-14 top-0 z-20 h-full w-14 ${open?'opacity-100':'opacity-0'} transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 [@media(hover:none)]:opacity-100`}>
    <button ref={trigger} type="button" disabled={disabled} aria-label="Album actions" aria-haspopup="dialog" aria-controls={id} aria-expanded={open}
      onClick={event=>{event.stopPropagation();setOpen(value=>!value);}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);}}}
      className="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-lg font-semibold text-slate-600 shadow-[0_1px_4px_rgba(15,23,42,0.10)] hover:bg-blue-100 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50">⋯</button>
    {open?createPortal(<div ref={panel} id={id} role="dialog" aria-label="Album actions" className="fixed z-[9999] w-max max-w-[calc(100vw-16px)] overflow-y-auto" style={{...position,maxHeight:'calc(100dvh - 16px)'}}
      onKeyDown={event=>{
        if(event.key==='Tab'){event.preventDefault();close();return;}
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));if(!buttons.length) return;
        event.preventDefault();const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length]?.focus();
      }}>{controls(close)}</div>,document.body):null}
  </div>;
}
