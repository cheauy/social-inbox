"use client";

import { useEffect, useRef, useState } from "react";

type Room = { id: string; name: string; description: string | null; is_general: boolean };
export function EditTeamGroupDialog({ room, onClose, onSaved }: {
  room: Room; onClose: () => void; onSaved: (room: { id: string; name: string; description: string | null }) => void;
}) {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lock.current) close.current();
      if (e.key !== "Tab") return;
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea') ?? []);
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    document.addEventListener("keydown", keys);
    return () => { document.removeEventListener("keydown", keys); previous?.focus(); };
  }, []);
  async function save() {
    if (lock.current || room.is_general || !name.trim()) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/team-chat/rooms/${encodeURIComponent(room.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success || result.room?.id !== room.id) throw new Error(result.error || "Unable to save this group.");
      onSaved(result.room); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save this group."); }
    finally { lock.current = false; setBusy(false); }
  }
  if (room.is_general) return null;
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="edit-team-group-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
      <h2 id="edit-team-group-title" className="text-lg font-bold text-slate-900">Edit group</h2>
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <label className="mt-5 block text-sm font-medium text-slate-700">Group name<input autoFocus required maxLength={80} disabled={busy} value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 outline-none focus:ring-2 focus:ring-blue-400" /></label>
        <label className="mt-4 block text-sm font-medium text-slate-700">Description<textarea maxLength={240} rows={3} disabled={busy} value={description} onChange={e => setDescription(e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 outline-none focus:ring-2 focus:ring-blue-400" /></label>
        {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm">Cancel</button><button type="submit" disabled={busy || !name.trim()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button></div>
      </form>
    </div>
  </div>;
}
