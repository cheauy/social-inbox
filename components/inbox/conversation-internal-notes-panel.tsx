"use client";

import { useEffect, useMemo, useState } from "react";

type NoteAuthor = {
  id?: string;
  full_name?: string | null;
  email?: string | null;
};

type InternalNote = {
  id: string;
  contact_id: string;
  author_id: string;
  note_text: string;
  created_at: string;
  updated_at: string;
  author?: NoteAuthor | NoteAuthor[] | null;
};

type NotesResponse = {
  success?: boolean;
  error?: string;
  notes?: InternalNote[];
  note?: InternalNote;
  currentMemberId?: string;
};

type ConversationInternalNotesPanelProps = {
  conversationId: string;
  contactId: string;
  customerName: string;
  onClose: () => void;
};

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function authorName(note: InternalNote) {
  const raw = Array.isArray(note.author) ? note.author[0] : note.author;
  return raw?.full_name?.trim() || raw?.email?.trim() || "Team member";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ConversationInternalNotesPanel({
  conversationId,
  contactId,
  customerName,
  onClose,
}: ConversationInternalNotesPanelProps) {
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = useMemo(
    () => Boolean(draft.trim()) && !busy,
    [busy, draft],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/contacts/${contactId}/notes`, {
          cache: "no-store",
        });
        const result = await readJson<NotesResponse>(response);
        if (!response.ok || !result?.success) {
          throw new Error(result?.error ?? "Unable to load internal notes.");
        }
        if (!cancelled) {
          setNotes(result.notes ?? []);
          setCurrentMemberId(result.currentMemberId ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load internal notes.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  async function createNote() {
    const noteText = draft.trim();
    if (!noteText || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText, conversationId }),
      });
      const result = await readJson<NotesResponse>(response);
      if (!response.ok || !result?.success || !result.note) {
        throw new Error(result?.error ?? "Unable to create internal note.");
      }
      setNotes((current) => [result.note as InternalNote, ...current]);
      setDraft("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create internal note.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(noteId: string) {
    const noteText = editingText.trim();
    if (!noteText || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/contacts/${contactId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText, conversationId }),
      });
      const result = await readJson<NotesResponse>(response);
      if (!response.ok || !result?.success || !result.note) {
        throw new Error(result?.error ?? "Unable to update internal note.");
      }
      setNotes((current) =>
        current.map((note) =>
          note.id === noteId ? (result.note as InternalNote) : note,
        ),
      );
      setEditingId(null);
      setEditingText("");
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update internal note.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(noteId: string) {
    if (busy || !window.confirm("Delete this internal note?")) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/contacts/${contactId}/notes/${noteId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const result = await readJson<NotesResponse>(response);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to delete internal note.");
      }
      setNotes((current) => current.filter((note) => note.id !== noteId));
      if (editingId === noteId) {
        setEditingId(null);
        setEditingText("");
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete internal note.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/35 p-4">
      <button
        type="button"
        aria-label="Close internal notes"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <section className="relative z-10 flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">
              Internal only
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">Internal notes</h2>
            <p className="mt-1 text-sm text-slate-500">{customerName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="border-b border-slate-200 bg-amber-50/60 p-4">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            maxLength={5000}
            placeholder="Add a private note for your team. This is never sent to the customer."
            className="w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">{draft.length}/5000</span>
            <button
              type="button"
              onClick={() => void createNote()}
              disabled={!canCreate}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Add internal note"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="animate-pulse rounded-xl border border-slate-200 p-4">
                  <div className="h-3 w-32 rounded bg-slate-200" />
                  <div className="mt-3 h-3 w-full rounded bg-slate-100" />
                  <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : notes.length === 0 ? (
            <div className="py-12 text-center">
              <p className="font-semibold text-slate-800">No internal notes yet</p>
              <p className="mt-1 text-sm text-slate-500">Add the first private note for this customer.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => {
                const ownNote = Boolean(currentMemberId && note.author_id === currentMemberId);
                const editing = editingId === note.id;

                return (
                  <article key={note.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{authorName(note)}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{formatDate(note.updated_at || note.created_at)}</p>
                      </div>
                      {ownNote ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(note.id);
                              setEditingText(note.note_text);
                            }}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-blue-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteNote(note.id)}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-red-50 hover:text-red-600"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {editing ? (
                      <div className="mt-3">
                        <textarea
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          rows={3}
                          maxLength={5000}
                          className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditingText("");
                            }}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveEdit(note.id)}
                            disabled={!editingText.trim() || busy}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                        {note.note_text}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
