"use client";

import { useEffect, useState } from "react";

import { NoteItem } from "@/components/inbox/note-item";
import type { ContactNote } from "@/types/inbox";

type CustomerNotesProps = {
  contactId: string;
  conversationId: string;
  currentMemberId: string | null;
  currentMemberName: string | null;
};

type NotesResponse = {
  success?: boolean;
  error?: string;
  notes?: ContactNote[];
  note?: ContactNote;
};
async function readJsonResponse<T>(
  response: Response,
): Promise<T | null> {
  const text =
    await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
export function CustomerNotes({
   contactId,
  conversationId,
  currentMemberId,
  currentMemberName,
}: CustomerNotesProps) {
  const [notes, setNotes] =
    useState<ContactNote[]>([]);
  const [newNote, setNewNote] =
    useState("");
  const [loading, setLoading] =
    useState(true);
  const [busy, setBusy] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadNotes() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/contacts/${contactId}/notes`,
          {
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as NotesResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ??
              "Unable to load internal notes.",
          );
        }

        if (!cancelled) {
          setNotes(result.notes ?? []);
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
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadNotes();

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  async function createNote() {
    const noteText = newNote.trim();

    if (!noteText || !currentMemberId) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/contacts/${contactId}/notes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
         body: JSON.stringify({
  noteText,
  conversationId,
}),
        },
      );

      const result =
        (await response.json()) as NotesResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.note
      ) {
        throw new Error(
          result.error ??
            "Unable to create internal note.",
        );
      }

      setNotes((current) => [
        result.note as ContactNote,
        ...current,
      ]);
      setNewNote("");
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

  async function updateNote(
    noteId: string,
    noteText: string,
  ) {
    if (!currentMemberId) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/contacts/${contactId}/notes/${noteId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
         body: JSON.stringify({
  noteText,
  conversationId,
}),
        },
      );

      const result =
        (await response.json()) as NotesResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.note
      ) {
        throw new Error(
          result.error ??
            "Unable to update internal note.",
        );
      }

      setNotes((current) =>
        current.map((note) =>
          note.id === noteId
            ? (result.note as ContactNote)
            : note,
        ),
      );
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
    if (!currentMemberId) {
      return;
    }

    const confirmed = window.confirm(
      "Delete this internal note?",
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/contacts/${contactId}/notes/${noteId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
         body: JSON.stringify({
  conversationId,
}),
        },
      );

      const result =
        (await response.json()) as NotesResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to delete internal note.",
        );
      }

      setNotes((current) =>
        current.filter(
          (note) => note.id !== noteId,
        ),
      );
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
    <section className="border-t border-slate-200 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Internal notes
          </p>

          <p className="mt-1 text-xs text-slate-500">
            Private. Customers cannot see these notes.
          </p>
        </div>

        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {notes.length}
        </span>
      </div>

      {!currentMemberId ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Assign this conversation to a staff member
          before adding notes.
        </div>
      ) : (
        <div className="mt-3">
          <textarea
            value={newNote}
            onChange={(event) =>
              setNewNote(event.target.value)
            }
            rows={4}
            maxLength={5000}
            placeholder={`Add a private note as ${
              currentMemberName ?? "assigned staff"
            }...`}
            disabled={busy}
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
          />

          <button
            type="button"
            onClick={() => void createNote()}
            disabled={busy || !newNote.trim()}
            className="mt-2 w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:bg-slate-300"
          >
            {busy ? "Saving..." : "Add internal note"}
          </button>
        </div>
      )}

      {error ? (
        <p className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm text-slate-500">
            Loading notes...
          </p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-slate-500">
            No internal notes yet.
          </p>
        ) : (
          notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              currentMemberId={
                currentMemberId
              }
              busy={busy}
              onUpdate={updateNote}
              onDelete={deleteNote}
            />
          ))
        )}
      </div>
    </section>
  );
}
