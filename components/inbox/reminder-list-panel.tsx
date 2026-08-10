"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Reminder = {
  id: string;
  conversation_id: string;
  contact_id: string;
  note: string;
  remind_at: string;
  status: "open" | "completed" | "cancelled";
  assigned_to: string;
  created_by: string;
  created_at: string;
  contact: {
    id: string;
    full_name: string | null;
    profile_picture_url: string | null;
  } | null;
  assigned_member: {
    id: string;
    full_name: string;
    role: string;
    profile_picture_url: string | null;
  } | null;
};

type ReminderListPanelProps = {
  refreshKey: number;
  onChanged: () => void;
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

function getDayEnd(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function formatReminderTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const todayEnd = getDayEnd(now);
  const tomorrowEnd = new Date(todayEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  if (date.getTime() < now.getTime()) {
    const minutes = Math.max(
      1,
      Math.round(
        (now.getTime() - date.getTime()) /
          60_000,
      ),
    );

    if (minutes < 60) {
      return `${minutes}m overdue`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours}h overdue`;
    }

    return `${Math.round(hours / 24)}d overdue`;
  }

  if (date.getTime() <= todayEnd.getTime()) {
    return new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  if (date.getTime() <= tomorrowEnd.getTime()) {
    return `Tomorrow ${new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date)}`;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getInitial(value: string) {
  return (
    value.trim().charAt(0).toUpperCase() || "C"
  );
}

export function ReminderListPanel({
  refreshKey,
  onChanged,
}: ReminderListPanelProps) {
  const [reminders, setReminders] =
    useState<Reminder[]>([]);
  const [loading, setLoading] =
    useState(true);
  const [busyId, setBusyId] =
    useState<string | null>(null);
  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReminders() {
      setError(null);

      if (reminders.length === 0) {
        setLoading(true);
      }

      try {
        const response = await fetch(
          "/api/reminders",
          { cache: "no-store" },
        );

        const result = await readJson<{
          success?: boolean;
          error?: string;
          reminders?: Reminder[];
        }>(response);

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ??
              "Unable to load reminders.",
          );
        }

        if (!cancelled) {
          setReminders(
            result.reminders ?? [],
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load reminders.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadReminders();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const groups = useMemo(() => {
    const now = new Date();
    const todayEnd = getDayEnd(now);

    const overdue: Reminder[] = [];
    const today: Reminder[] = [];
    const upcoming: Reminder[] = [];

    for (const reminder of reminders) {
      const date = new Date(reminder.remind_at);

      if (date.getTime() < now.getTime()) {
        overdue.push(reminder);
      } else if (
        date.getTime() <= todayEnd.getTime()
      ) {
        today.push(reminder);
      } else {
        upcoming.push(reminder);
      }
    }

    return { overdue, today, upcoming };
  }, [reminders]);

  async function mutateReminder(
    reminderId: string,
    action: "complete" | "snooze" | "delete",
  ) {
    setBusyId(reminderId);
    setError(null);

    try {
      let response: Response;

      if (action === "delete") {
        const confirmed = window.confirm(
          "Delete this reminder?",
        );

        if (!confirmed) {
          return;
        }

        response = await fetch(
          `/api/reminders/${reminderId}`,
          { method: "DELETE" },
        );
      } else {
        response = await fetch(
          `/api/reminders/${reminderId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(
              action === "complete"
                ? { action: "complete" }
                : {
                    action: "snooze",
                    remindAt: new Date(
                      Date.now() +
                        60 * 60 * 1000,
                    ).toISOString(),
                  },
            ),
          },
        );
      }

      const result = await readJson<{
        success?: boolean;
        error?: string;
      }>(response);

      if (
        !response.ok ||
        !result?.success
      ) {
        throw new Error(
          result?.error ??
            "Unable to update reminder.",
        );
      }

      onChanged();
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Unable to update reminder.",
      );
    } finally {
      setBusyId(null);
    }
  }

  function renderSection(
    title: string,
    items: Reminder[],
    tone: "red" | "amber" | "blue",
  ) {
    if (items.length === 0) {
      return null;
    }

    const headingClass =
      tone === "red"
        ? "text-red-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-blue-600";

    return (
      <section className="mb-5">
        <div className="flex items-center justify-between px-3 pb-2">
          <p
            className={`text-[11px] font-bold uppercase tracking-wider ${headingClass}`}
          >
            {title}
          </p>
          <span className="text-xs text-slate-400">
            {items.length}
          </span>
        </div>

        <div className="space-y-2 px-2">
          {items.map((reminder) => {
            const customerName =
              reminder.contact?.full_name ??
              "Facebook customer";
            const isBusy =
              busyId === reminder.id;

            return (
              <article
                key={reminder.id}
                className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <Link
                  href={`/dashboard/inbox?conversation=${encodeURIComponent(
                    reminder.conversation_id,
                  )}`}
                  className="flex items-start gap-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                    {getInitial(customerName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {customerName}
                      </p>
                      <span
                        className={`shrink-0 text-[11px] font-medium ${
                          tone === "red"
                            ? "text-red-600"
                            : tone === "amber"
                              ? "text-amber-600"
                              : "text-slate-500"
                        }`}
                      >
                        {formatReminderTime(
                          reminder.remind_at,
                        )}
                      </span>
                    </div>

                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                      {reminder.note}
                    </p>

                    <p className="mt-1 text-[11px] text-slate-400">
                      {reminder.assigned_member
                        ?.full_name ??
                        "Team member"}
                    </p>
                  </div>
                </Link>

                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void mutateReminder(
                        reminder.id,
                        "complete",
                      )
                    }
                    className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    Complete
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void mutateReminder(
                        reminder.id,
                        "snooze",
                      )
                    }
                    className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  >
                    Snooze 1h
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void mutateReminder(
                        reminder.id,
                        "delete",
                      )
                    }
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/60">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-950">
              Reminders
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Customer follow-ups assigned to you.
            </p>
          </div>

          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
            {reminders.length}
          </span>
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        {loading && reminders.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Loading reminders...
          </div>
        ) : reminders.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-xl">
              ⏰
            </div>
            <p className="mt-3 font-medium text-slate-800">
              No active reminders
            </p>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              Create one from a customer profile.
            </p>
          </div>
        ) : (
          <>
            {renderSection(
              "Overdue",
              groups.overdue,
              "red",
            )}
            {renderSection(
              "Today",
              groups.today,
              "amber",
            )}
            {renderSection(
              "Upcoming",
              groups.upcoming,
              "blue",
            )}
          </>
        )}
      </div>
    </div>
  );
}
