"use client";

import { useState } from "react";

import type { ContactNote } from "@/types/inbox";

type NoteItemProps = {
  note: ContactNote;
  currentMemberId: string | null;
  busy: boolean;
  onUpdate: (
    noteId: string,
    noteText: string,
  ) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
};

function formatNoteDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function NoteItem({
  note,
  currentMemberId,
  busy,
  onUpdate,
  onDelete,
}: NoteItemProps) {
  const [editing, setEditing] =
    useState(false);
  const [text, setText] =
    useState(note.note_text);

  const canManage =
    currentMemberId === note.author_id;

  async function save() {
    const cleaned = text.trim();

    if (!cleaned) {
      return;
    }

    await onUpdate(note.id, cleaned);
    setEditing(false);
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
            {(note.author?.full_name ?? "T").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-slate-900">
              {note.author?.full_name ??
                "Team member"}
            </span>

            <span className="block text-[11px] text-slate-400">
              {formatNoteDate(note.created_at)}
              {note.updated_at !== note.created_at
                ? " · edited"
                : ""}
            </span>
          </span>
        </div>

        {canManage && !editing ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="text-[11px] font-semibold text-slate-500 transition hover:text-blue-700 disabled:text-slate-300"
            >
              Edit
            </button>

            <button
              type="button"
              onClick={() => void onDelete(note.id)}
              disabled={busy}
              className="text-[11px] font-semibold text-slate-500 transition hover:text-red-600 disabled:text-slate-300"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(event) =>
              setText(event.target.value)
            }
            rows={4}
            maxLength={5000}
            className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !text.trim()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:bg-slate-300"
            >
              Save
            </button>

            <button
              type="button"
              onClick={() => {
                setText(note.note_text);
                setEditing(false);
              }}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
          {note.note_text}
        </p>
      )}
    </article>
  );
}
