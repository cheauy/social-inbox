"use client";

import { useEffect, useState } from "react";

import { NoteItem } from "@/components/inbox/note-item";
import { createClient } from "@/lib/supabase/client";
import { MentionComposer } from "@/components/team/mention-composer";
import type { ContactNote } from "@/types/inbox";
import {
  useWorkspaceLanguageId,
} from "@/components/display/workspace-language-text";

type CustomerNotesProps = {
  contactId: string;
  conversationId: string;
  currentMemberId: string | null;
  currentMemberName: string | null;
  /*
   * Reports how many internal notes this contact has, so the panel above can
   * badge the Notes tab. Fires on load and after every add, edit and delete,
   * which is what keeps the badge falling when a note is removed.
   */
  onNoteCountChange?: (count: number) => void;
};

type MentionMember = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  profile_picture_url: string | null;
};

type NotesResponse = {
  success?: boolean;
  error?: string;
  notes?: ContactNote[];
  note?: ContactNote;
  currentMemberId?: string;
};

type TeamResponse = {
  success?: boolean;
  members?: MentionMember[];
  currentMember?: {
    id: string;
  };
};

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

async function readJsonResponse<T>(
  response: Response,
): Promise<T | null> {
  const text = await response.text();

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
  onNoteCountChange,
}: CustomerNotesProps) {
  const isKhmer = useWorkspaceLanguageId() === "km";

  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] =
    useState<MentionMember[]>([]);
  const [loggedInMemberId, setLoggedInMemberId] =
    useState<string | null>(null);
  const [mentionedMemberIds, setMentionedMemberIds] =
    useState<string[]>([]);
  const [mentionEveryone, setMentionEveryone] =
    useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadNotes() {
      if (refreshKey === 0) {
        setLoading(true);
      }

      setError(null);

      try {
        const [notesResponse, teamResponse] =
          await Promise.all([
            fetch(
              `/api/contacts/${contactId}/notes`,
              { cache: "no-store" },
            ),
            fetch("/api/team/members", {
              cache: "no-store",
            }),
          ]);

        const notesResult =
          await readJsonResponse<NotesResponse>(
            notesResponse,
          );
        const teamResult =
          await readJsonResponse<TeamResponse>(
            teamResponse,
          );

        if (
          !notesResponse.ok ||
          !notesResult?.success
        ) {
          throw new Error(
            notesResult?.error ??
              "Unable to load internal notes.",
          );
        }

        if (!cancelled) {
          const loadedNotes = notesResult.notes ?? [];
          const viewerId =
            notesResult.currentMemberId ??
            teamResult?.currentMember?.id ??
            null;

          setNotes(loadedNotes);
          setLoggedInMemberId(viewerId);

          if (
            teamResponse.ok &&
            teamResult?.success
          ) {
            setTeamMembers(teamResult.members ?? []);
          }
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
  }, [contactId, refreshKey]);

  /*
   * A note written by one teammate has to reach everyone else looking at this
   * customer, so the list follows contact_notes over realtime and refetches
   * on any insert, update or delete. Refetching rather than patching the row
   * keeps the author join intact, which the payload does not carry.
   */
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`tenh-contact-notes-${contactId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contact_notes",
          filter: `contact_id=eq.${contactId}`,
        },
        () => {
          setRefreshKey((current) => current + 1);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [contactId]);

  /*
   * Reported from an effect, not from inside a setNotes updater: React runs
   * updaters during render, so notifying the parent there updated it mid
   * render. This fires after commit, once per real change.
   */
  useEffect(() => {
    onNoteCountChange?.(notes.length);
  }, [notes.length, onNoteCountChange]);

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
            mentionedMemberIds,
            mentionEveryone,
          }),
        },
      );

      const result =
        await readJsonResponse<NotesResponse>(response);

      if (
        !response.ok ||
        !result?.success ||
        !result.note
      ) {
        throw new Error(
          result?.error ??
            "Unable to create internal note.",
        );
      }

      setNotes((current) => [
        result.note as ContactNote,
        ...current,
      ]);
      setNewNote("");
      setMentionedMemberIds([]);
      setMentionEveryone(false);
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
        await readJsonResponse<NotesResponse>(response);

      if (
        !response.ok ||
        !result?.success ||
        !result.note
      ) {
        throw new Error(
          result?.error ??
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
        await readJsonResponse<NotesResponse>(response);

      if (!response.ok || !result?.success) {
        throw new Error(
          result?.error ??
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
    <section>
      {/*
       * The count lives on the Notes tab as a red unread badge, so it is
       * deliberately not repeated here.
       */}
      <p className="flex items-center gap-1.5 text-[12px] leading-5 text-slate-500">
        <span className="text-slate-400">
          <LockIcon />
        </span>
        {isKhmer
          ? "ឯកជន។ អតិថិជនមើលមិនឃើញទេ។ ប្រើ @ ដើម្បីជូនដំណឹងសមាជិកក្រុម។"
          : "Private. Customers cannot see these. Use @ to notify a teammate."}
      </p>

      {!currentMemberId ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
          {isKhmer
            ? "ចាត់តាំងការសន្ទនានេះទៅសមាជិកបុគ្គលិក មុនពេលបន្ថែមកំណត់ចំណាំ។"
            : "Assign this conversation to a staff member before adding notes."}
        </div>
      ) : (
        <div className="mt-3">
          <MentionComposer
            value={newNote}
            onChange={setNewNote}
            members={teamMembers.filter(
              (member) =>
                member.id !== loggedInMemberId,
            )}
            mentionedMemberIds={mentionedMemberIds}
            onMentionedMemberIdsChange={
              setMentionedMemberIds
            }
            mentionEveryone={mentionEveryone}
            onMentionEveryoneChange={
              setMentionEveryone
            }
            rows={4}
            maxLength={5000}
            placeholder={
              isKhmer
                ? `បន្ថែមកំណត់ចំណាំឯកជនក្នុងនាម ${currentMemberName ?? "បុគ្គលិកដែលបានចាត់តាំង"}...`
                : `Add a private note as ${currentMemberName ?? "assigned staff"}...`
            }
            disabled={busy}
            tone="note"
          />

          {/* Save sits inline with Mention rather than as a full-width bar. */}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void createNote()}
              disabled={busy || !newNote.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {busy
                ? isKhmer ? "កំពុងរក្សាទុក..." : "Saving..."
                : isKhmer ? "រក្សាទុកកំណត់ចំណាំ" : "Save note"}
            </button>
          </div>
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
            {isKhmer ? "កំពុងផ្ទុកកំណត់ចំណាំ..." : "Loading notes..."}
          </p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-slate-500">
            {isKhmer ? "មិនទាន់មានកំណត់ចំណាំផ្ទៃក្នុងទេ។" : "No internal notes yet."}
          </p>
        ) : (
          notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              currentMemberId={currentMemberId}
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
