"use client";

import { useMemo, useState } from "react";

export type EditableReminder = {
  id: string;
  note: string;
  remind_at: string;
  workspace?: {
    id: string;
    name: string;
  } | null;
  contact?: {
    id: string;
    full_name: string | null;
    profile_picture_url?: string | null;
  } | null;
};

type ReminderEditDialogProps = {
  reminder: EditableReminder | null;
  onClose: () => void;
  onSaved: () => void;
};

function toLocalInputValue(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

async function readJson<T>(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function ReminderEditDialog({
  reminder,
  onClose,
  onSaved,
}: ReminderEditDialogProps) {
  const [note, setNote] = useState(() => reminder?.note ?? "");
  const [remindAt, setRemindAt] = useState(() =>
    reminder ? toLocalInputValue(reminder.remind_at) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = useMemo(() => {
    if (!reminder || saving || !note.trim() || !remindAt) return false;
    const date = new Date(remindAt);
    return Number.isFinite(date.getTime()) && date.getTime() > Date.now();
  }, [note, remindAt, reminder, saving]);

  if (!reminder) return null;

  const activeReminder = reminder;

  async function save() {
    if (!canSave) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/reminders/manage/${activeReminder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim(),
          remindAt: new Date(remindAt).toISOString(),
        }),
      });
      const result = await readJson<{ success?: boolean; error?: string }>(response);

      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to update reminder.");
      }

      window.dispatchEvent(new CustomEvent("tenh-reminder-changed"));
      onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to update reminder.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/35 p-4">
      <button
        type="button"
        aria-label="Close edit reminder dialog"
        className="absolute inset-0 cursor-default"
        onClick={() => {
          if (!saving) onClose();
        }}
      />

      <section className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-950">Edit reminder</h2>
            <p className="mt-1 truncate text-sm text-slate-500">
              {reminder.contact?.full_name ?? "Customer"}
              {reminder.workspace?.name ? ` · ${reminder.workspace.name}` : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <label className="text-sm font-semibold text-slate-800">Reminder note</label>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              maxLength={2000}
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-800">Remind at</label>
            <input
              type="datetime-local"
              value={remindAt}
              min={toLocalInputValue(new Date())}
              onChange={(event) => setRemindAt(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </section>
    </div>
  );
}
