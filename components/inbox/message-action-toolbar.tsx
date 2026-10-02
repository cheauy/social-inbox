"use client";
import type { ReactNode } from "react";

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
  onReply: () => void;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function MessageActionToolbar({ outgoing, actions, replying, pinned, pinPending, reactionControl, copyControl, reserveActions, reserveReaction, keepVisible, photoHover, onReply, onPin, onEdit, onDelete }: MessageActionToolbarProps) {
  if (!Object.values(actions).some(Boolean) && !reactionControl && !copyControl && !reserveActions && !reserveReaction) return null;
  const normal = "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 disabled:cursor-wait";
  // Keep the same responsive footprint before provider confirmation enables actions.
  const reservation = (enabled: boolean) => enabled ? {} : {
    disabled: true, "aria-hidden": true as const, tabIndex: -1,
    style: { visibility: "hidden" as const, pointerEvents: "none" as const },
  };
  return (
    <div className={`mt-1 flex min-w-0 px-1 ${keepVisible ? "opacity-100" : "opacity-0"} transition-opacity duration-150 focus-within:opacity-100 ${photoHover ? "group-hover/photo:opacity-100" : "group-hover:opacity-100"} [@media(hover:none)]:opacity-100 ${outgoing ? "justify-end" : "justify-start"}`}>
      <div role="group" aria-label="Message actions" className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 text-[11px] shadow-[0_1px_4px_rgba(15,23,42,0.10)] [&>*]:shrink-0" onClick={(event) => event.stopPropagation()}>
        {copyControl}
        {reactionControl ?? (reserveReaction ? <span aria-hidden="true" className="h-7 w-8" /> : null)}
        {(actions.reply || reserveActions?.reply) && <button type="button" {...reservation(actions.reply)} className={normal} onClick={onReply}>{replying ? "Cancel reply" : "Reply"}</button>}
        {(actions.pin || reserveActions?.pin) && <button type="button" disabled={pinPending} {...reservation(actions.pin)} className={normal} title="Pin in this TENH conversation" onClick={onPin}>{pinPending ? "Saving…" : pinned ? "Unpin" : "Pin"}</button>}
        {(actions.edit || reserveActions?.edit) && <button type="button" {...reservation(actions.edit)} className={normal} onClick={onEdit}>Edit</button>}
        {(actions.delete || reserveActions?.delete) && <button type="button" {...reservation(actions.delete)} className={`${normal} hover:!bg-red-50 hover:!text-red-600`} onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
