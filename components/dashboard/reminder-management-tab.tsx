"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  ReminderEditDialog,
  type EditableReminder,
} from "@/components/inbox/reminder-edit-dialog";

type ReminderView = "pending" | "sent" | "cancelled";

type ManagedReminder = EditableReminder & {
  business_id: string;
  conversation_id: string;
  contact_id: string;
  status: "open" | "completed" | "cancelled";
  assigned_to: string;
  created_at: string;
  updated_at: string | null;
  assigned_member?: {
    id: string;
    full_name: string;
    role: string;
    profile_picture_url: string | null;
  } | null;
};

type ReminderResponse = {
  success?: boolean;
  error?: string;
  counts?: {
    pending: number;
    sent: number;
    cancelled: number;
  };
  reminders?: ManagedReminder[];
};

type ReminderManagementTabProps = {
  onPendingCountChange?: (count: number) => void;
  onClosePanel?: () => void;
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

export function ReminderManagementTab({
  onPendingCountChange,
  onClosePanel,
}: ReminderManagementTabProps) {
  const router = useRouter();
  const [view, setView] = useState<ReminderView>("pending");
  const [reminders, setReminders] = useState<ManagedReminder[]>([]);
  const [counts, setCounts] = useState({ pending: 0, sent: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagedReminder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ManagedReminder | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/reminders/manage?view=${view}`, {
        cache: "no-store",
      });
      const result = await readJson<ReminderResponse>(response);

      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to load reminders.");
      }

      const nextCounts = result.counts ?? { pending: 0, sent: 0, cancelled: 0 };
      setCounts(nextCounts);
      setReminders(result.reminders ?? []);
      onPendingCountChange?.(nextCounts.pending);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load reminders.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [onPendingCountChange, view]);

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

  const tabs = useMemo(
    () => [
      ["pending", "Pending", counts.pending],
      ["sent", "Sent", counts.sent],
      ["cancelled", "Cancelled", counts.cancelled],
    ] as Array<[ReminderView, string, number]>,
    [counts],
  );

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

  function openConversation(reminder: ManagedReminder) {
    onClosePanel?.();
    router.push(`/dashboard/inbox?conversation=${encodeURIComponent(reminder.conversation_id)}`);
    router.refresh();
  }

  return (
    <div className="max-h-[520px] overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">Across all active workspaces</p>
          <button
            type="button"
            onClick={() => {
              onClosePanel?.();
              router.push("/dashboard/inbox");
            }}
            className="text-xs font-bold text-blue-600 hover:text-blue-700"
          >
            + New reminder
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          {tabs.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                view === value
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>{label}</span>
              {count > 0 ? (
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Loading reminders...</div>
      ) : reminders.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {view === "pending"
              ? "No pending reminders"
              : view === "sent"
                ? "No sent reminders"
                : "No cancelled reminders"}
          </p>
          {view === "pending" ? (
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Create a reminder from a customer conversation.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2 p-2">
          {reminders.map((reminder) => (
            <article key={reminder.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {reminder.contact?.full_name ?? "Customer"}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {reminder.workspace?.name ?? "Workspace"}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-medium text-slate-400">
                  {formatReminderDate(reminder.remind_at)}
                </span>
              </div>

              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                {reminder.note}
              </p>

              {reminder.assigned_member?.full_name ? (
                <p className="mt-2 text-[10px] text-slate-400">
                  Assigned to {reminder.assigned_member.full_name}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {view === "pending" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(reminder)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelTarget(reminder)}
                      className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
                    >
                      Cancel
                    </button>
                  </>
                ) : null}

                <button
                  type="button"
                  onClick={() => openConversation(reminder)}
                  className="ml-auto text-xs font-bold text-blue-600 hover:text-blue-700"
                >
                  Open conversation
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {view === "pending" ? (
        <div className="border-t border-slate-100 px-4 py-3 text-center text-[10px] leading-4 text-slate-400">
          Edit or cancel a reminder before its scheduled time. Create new reminders from the customer conversation.
        </div>
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
    </div>
  );
}
