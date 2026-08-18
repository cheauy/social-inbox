"use client";

import { useEffect, useMemo, useState } from "react";

type ReminderMember = {
  id: string;
  full_name: string;
  email?: string | null;
  role?: string;
};

type ReminderRow = {
  id: string;
  conversation_id: string;
  contact_id: string;
  assigned_to: string;
  note: string;
  remind_at: string;
  status: string;
  assigned_member?: ReminderMember | ReminderMember[] | null;
};

type ConversationFollowUpPanelProps = {
  conversationId: string;
  contactId: string;
  customerName: string;
  defaultAssignedTo: string | null;
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

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function tomorrowAtTen() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date;
}

function formatReminderDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function assigneeName(reminder: ReminderRow) {
  const raw = Array.isArray(reminder.assigned_member)
    ? reminder.assigned_member[0]
    : reminder.assigned_member;
  return raw?.full_name?.trim() || "Assigned member";
}

export function ConversationFollowUpPanel({
  conversationId,
  contactId,
  customerName,
  defaultAssignedTo,
  onClose,
}: ConversationFollowUpPanelProps) {
  const [members, setMembers] = useState<ReminderMember[]>([]);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [note, setNote] = useState("");
  const [remindAt, setRemindAt] = useState(() => toLocalInputValue(tomorrowAtTen()));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = useMemo(() => {
    if (creating || !assignedTo || !note.trim() || !remindAt) return false;
    const date = new Date(remindAt);
    return Number.isFinite(date.getTime()) && date.getTime() > Date.now();
  }, [assignedTo, creating, note, remindAt]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [optionsResponse, remindersResponse] = await Promise.all([
        fetch("/api/reminders/options", { cache: "no-store" }),
        fetch("/api/reminders", { cache: "no-store" }),
      ]);

      const options = await readJson<{
        success?: boolean;
        error?: string;
        members?: ReminderMember[];
        currentMemberId?: string;
      }>(optionsResponse);

      const reminderResult = await readJson<{
        success?: boolean;
        error?: string;
        reminders?: ReminderRow[];
      }>(remindersResponse);

      if (!optionsResponse.ok || !options?.success) {
        throw new Error(options?.error ?? "Unable to load reminder options.");
      }
      if (!remindersResponse.ok || !reminderResult?.success) {
        throw new Error(reminderResult?.error ?? "Unable to load reminders.");
      }

      const nextMembers = options.members ?? [];
      setMembers(nextMembers);
      const preferred =
        defaultAssignedTo && nextMembers.some((member) => member.id === defaultAssignedTo)
          ? defaultAssignedTo
          : options.currentMemberId ?? nextMembers[0]?.id ?? "";
      setAssignedTo(preferred);
      setReminders(
        (reminderResult.reminders ?? []).filter(
          (reminder) => reminder.conversation_id === conversationId && reminder.status === "open",
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load follow-ups.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  function fireChanged() {
    window.dispatchEvent(new CustomEvent("tenh-reminder-changed"));
  }

  async function createReminder() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const date = new Date(remindAt);
      const response = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          contactId,
          assignedTo,
          note: note.trim(),
          remindAt: date.toISOString(),
        }),
      });
      const result = await readJson<{ success?: boolean; error?: string }>(response);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to create reminder.");
      }
      setNote("");
      setRemindAt(toLocalInputValue(tomorrowAtTen()));
      fireChanged();
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Unable to create reminder.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function reminderAction(
    reminderId: string,
    action: "complete" | "snooze" | "delete",
  ) {
    setBusyId(reminderId);
    setError(null);
    try {
      let response: Response;
      if (action === "delete") {
        response = await fetch(`/api/reminders/${reminderId}`, { method: "DELETE" });
      } else if (action === "snooze") {
        const next = tomorrowAtTen();
        response = await fetch(`/api/reminders/${reminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "snooze", remindAt: next.toISOString() }),
        });
      } else {
        response = await fetch(`/api/reminders/${reminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete" }),
        });
      }

      const result = await readJson<{ success?: boolean; error?: string }>(response);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to update reminder.");
      }
      fireChanged();
      setReminders((current) => current.filter((item) => item.id !== reminderId));
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Unable to update reminder.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/35 p-4">
      <button
        type="button"
        aria-label="Close follow-up panel"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <section className="relative z-10 flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-600">Follow-up</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">Reminder workflow</h2>
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

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
            <h3 className="text-sm font-bold text-slate-900">Create follow-up</h3>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Follow up about payment, preorder, delivery…"
              className="mt-3 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Remind at
                <input
                  type="datetime-local"
                  value={remindAt}
                  onChange={(event) => setRemindAt(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-violet-500"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Assign to
                <select
                  value={assignedTo}
                  onChange={(event) => setAssignedTo(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-violet-500"
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const date = new Date(Date.now() + 3 * 60 * 60 * 1000);
                  setRemindAt(toLocalInputValue(date));
                }}
                className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700"
              >
                +3 hours
              </button>
              <button
                type="button"
                onClick={() => setRemindAt(toLocalInputValue(tomorrowAtTen()))}
                className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700"
              >
                Tomorrow 10:00
              </button>
              <button
                type="button"
                onClick={() => void createReminder()}
                disabled={!canCreate}
                className="ml-auto rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create reminder"}
              </button>
            </div>
          </section>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <section className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">Open follow-ups</h3>
              <button
                type="button"
                onClick={() => void load()}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="mt-3 space-y-3">
                {[0, 1].map((item) => (
                  <div key={item} className="animate-pulse rounded-xl border border-slate-200 p-4">
                    <div className="h-3 w-2/3 rounded bg-slate-200" />
                    <div className="mt-3 h-3 w-40 rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : reminders.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-slate-700">No open follow-up for this conversation</p>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {reminders.map((reminder) => (
                  <article key={reminder.id} className="rounded-xl border border-slate-200 p-4 shadow-sm">
                    <p className="whitespace-pre-wrap text-sm font-medium text-slate-800">{reminder.note}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{formatReminderDate(reminder.remind_at)}</span>
                      <span>•</span>
                      <span>{assigneeName(reminder)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === reminder.id}
                        onClick={() => void reminderAction(reminder.id, "complete")}
                        className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        disabled={busyId === reminder.id}
                        onClick={() => void reminderAction(reminder.id, "snooze")}
                        className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:opacity-50"
                      >
                        Snooze to tomorrow
                      </button>
                      <button
                        type="button"
                        disabled={busyId === reminder.id}
                        onClick={() => void reminderAction(reminder.id, "delete")}
                        className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
