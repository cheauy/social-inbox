"use client";

export type MessageActionToolbarProps = {
  outgoing: boolean;
  actions: { reply: boolean; pin: boolean; edit: boolean; delete: boolean };
  replying: boolean;
  pinned: boolean;
  pinPending?: boolean;
  onReply: () => void;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function MessageActionToolbar({ outgoing, actions, replying, pinned, pinPending, onReply, onPin, onEdit, onDelete }: MessageActionToolbarProps) {
  if (!Object.values(actions).some(Boolean)) return null;
  const normal = "rounded-full px-2.5 py-1 font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 disabled:cursor-wait";
  return (
    <div className={`mt-1 flex px-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${outgoing ? "justify-end" : "justify-start"}`}>
      <div role="group" aria-label="Message actions" className="inline-flex flex-wrap items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 text-[11px] shadow-[0_1px_4px_rgba(15,23,42,0.10)]" onClick={(event) => event.stopPropagation()}>
        {actions.reply && <button type="button" className={normal} onClick={onReply}>{replying ? "Cancel reply" : "Reply"}</button>}
        {actions.pin && <button type="button" className={normal} disabled={pinPending} title="Pin in this TENH conversation" onClick={onPin}>{pinPending ? "Saving…" : pinned ? "Unpin" : "Pin"}</button>}
        {actions.edit && <button type="button" className={normal} onClick={onEdit}>Edit</button>}
        {actions.delete && <button type="button" className={`${normal} hover:!bg-red-50 hover:!text-red-600`} onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
