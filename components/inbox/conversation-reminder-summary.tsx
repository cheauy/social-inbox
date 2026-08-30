"use client";

import { useCallback, useEffect, useState } from "react";

import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  ReminderEditDialog,
  type EditableReminder,
} from "@/components/inbox/reminder-edit-dialog";

type ConversationReminder = EditableReminder & {
  business_id: string;
  conversation_id: string;
  status: "open" | "completed" | "cancelled";
};

type ConversationReminderSummaryProps = {
  conversationId: string;
  onCreate: () => void;
};

async function readJson<T>(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function formatReminderDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ConversationReminderSummary({
  conversationId,
  onCreate,
}: ConversationReminderSummaryProps) {
  const [reminders, setReminders] = useState<ConversationReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ConversationReminder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ConversationReminder | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/reminders/manage?view=pending&conversationId=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );
      const result = await readJson<{
        success?: boolean;
        error?: string;
        reminders?: ConversationReminder[];
      }>(response);

      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to load reminders.");
      }

      setReminders(result.reminders ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load reminders.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onReminderChanged() {
      void load(true);
    }

    window.addEventListener("tenh-reminder-changed", onReminderChanged);
    return () => window.removeEventListener("tenh-reminder-changed", onReminderChanged);
  }, [load]);

  async function cancelReminder() {
    if (!cancelTarget || cancelling) return;

    setCancelling(true);
    setError(null);

    try {
      const response = await fetch(`/api/reminders/manage/${cancelTarget.id}`, {
        method: "DELETE",
      });
      const result = await readJson<{ success?: boolean; error?: string }>(response);

      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to cancel reminder.");
      }

      setCancelTarget(null);
      window.dispatchEvent(new CustomEvent("tenh-reminder-changed"));
      await load(true);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "Unable to cancel reminder.",
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section className="border-t border-slate-200 pt-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Reminder
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          + New reminder
        </button>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-slate-400">Loading reminder...</p>
      ) : reminders.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No pending reminder.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {reminders.slice(0, 3).map((reminder) => (
            <article key={reminder.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm font-medium leading-5 text-slate-800">
                  {reminder.note}
                </p>
                <span className="shrink-0 text-[10px] font-semibold text-amber-700">
                  {formatReminderDate(reminder.remind_at)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(reminder)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setCancelTarget(reminder)}
                  className="text-xs font-semibold text-red-600 hover:text-red-700"
                >
                  Cancel
                </button>
              </div>
            </article>
          ))}

          {reminders.length > 3 ? (
            <p className="text-[11px] text-slate-400">+{reminders.length - 3} more pending reminders</p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      ) : null}

      <ReminderEditDialog
        key={editing?.id ?? "none"}
        reminder={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load(true);
        }}
      />

      <DeleteConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel reminder?"
        description="This reminder will be cancelled and no reminder notification will be sent at its scheduled time."
        confirmLabel="Cancel reminder"
        loadingLabel="Cancelling..."
        loading={cancelling}
        onCancel={() => {
          if (!cancelling) setCancelTarget(null);
        }}
        onConfirm={() => void cancelReminder()}
      />
    </section>
  );
}
