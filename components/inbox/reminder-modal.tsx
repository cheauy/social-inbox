"use client";

import { useEffect, useMemo, useState } from "react";

type ReminderMember = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  profile_picture_url: string | null;
};

type ReminderModalProps = {
  conversationId: string;
  contactId: string;
  customerName: string;
  defaultAssignedTo: string | null;
  onClose: () => void;
  onCreated: () => void;
};

type Preset =
  | "later_today"
  | "tomorrow"
  | "next_week"
  | "custom";

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(
    date.getTime() - offset * 60_000,
  )
    .toISOString()
    .slice(0, 16);
}

function buildPresetDate(preset: Preset) {
  const now = new Date();

  if (preset === "later_today") {
    const later = new Date(
      now.getTime() + 3 * 60 * 60 * 1000,
    );
    return later;
  }

  if (preset === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    return tomorrow;
  }

  if (preset === "next_week") {
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(10, 0, 0, 0);
    return nextWeek;
  }

  return new Date(
    now.getTime() + 60 * 60 * 1000,
  );
}

async function readJson<T>(response: Response) {
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

export function ReminderModal({
  conversationId,
  contactId,
  customerName,
  defaultAssignedTo,
  onClose,
  onCreated,
}: ReminderModalProps) {
  const [members, setMembers] =
    useState<ReminderMember[]>([]);
  const [assignedTo, setAssignedTo] =
    useState("");
  const [note, setNote] = useState("");
  const [preset, setPreset] =
    useState<Preset>("tomorrow");
  const [remindAt, setRemindAt] =
    useState(() =>
      toLocalInputValue(
        buildPresetDate("tomorrow"),
      ),
    );
  const [loadingOptions, setLoadingOptions] =
    useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setLoadingOptions(true);
      setError(null);

      try {
        const response = await fetch(
          "/api/reminders/options",
          { cache: "no-store" },
        );

        const result = await readJson<{
          success?: boolean;
          error?: string;
          members?: ReminderMember[];
          currentMemberId?: string;
        }>(response);

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ??
              "Unable to load team members.",
          );
        }

        if (cancelled) {
          return;
        }

        const nextMembers =
          result.members ?? [];
        setMembers(nextMembers);

        const preferred =
          defaultAssignedTo &&
          nextMembers.some(
            (member) =>
              member.id === defaultAssignedTo,
          )
            ? defaultAssignedTo
            : result.currentMemberId ??
              nextMembers[0]?.id ??
              "";

        setAssignedTo(preferred);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load reminder options.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [defaultAssignedTo]);

  const canSave = useMemo(() => {
    if (
      saving ||
      loadingOptions ||
      !assignedTo ||
      !note.trim() ||
      !remindAt
    ) {
      return false;
    }

    const date = new Date(remindAt);
    return (
      Number.isFinite(date.getTime()) &&
      date.getTime() > Date.now()
    );
  }, [
    assignedTo,
    loadingOptions,
    note,
    remindAt,
    saving,
  ]);

  function choosePreset(nextPreset: Preset) {
    setPreset(nextPreset);

    if (nextPreset !== "custom") {
      setRemindAt(
        toLocalInputValue(
          buildPresetDate(nextPreset),
        ),
      );
    }
  }

  async function createReminder() {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const localDate = new Date(remindAt);

      const response = await fetch(
        "/api/reminders",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId,
            contactId,
            assignedTo,
            note: note.trim(),
            remindAt:
              localDate.toISOString(),
          }),
        },
      );

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
            "Unable to create reminder.",
        );
      }

      onCreated();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create reminder.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-4">
      <button
        type="button"
        aria-label="Close reminder dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Create reminder
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {customerName}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <label className="text-sm font-semibold text-slate-800">
              Reminder
            </label>
            <textarea
              value={note}
              onChange={(event) =>
                setNote(event.target.value)
              }
              rows={3}
              maxLength={2000}
              placeholder="Follow up about payment, preorder, delivery..."
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-800">
              When
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["later_today", "Later today"],
                ["tomorrow", "Tomorrow"],
                ["next_week", "Next week"],
                ["custom", "Custom"],
              ] as Array<[Preset, string]>).map(
                ([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      choosePreset(value)
                    }
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      preset === value
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>

            <input
              type="datetime-local"
              value={remindAt}
              min={toLocalInputValue(new Date())}
              onChange={(event) => {
                setPreset("custom");
                setRemindAt(event.target.value);
              }}
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-800">
              Assign to
            </label>

            <select
              value={assignedTo}
              onChange={(event) =>
                setAssignedTo(event.target.value)
              }
              disabled={loadingOptions}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            >
              {loadingOptions ? (
                <option>Loading team...</option>
              ) : null}

              {!loadingOptions &&
              members.length === 0 ? (
                <option value="">
                  No active team members
                </option>
              ) : null}

              {members.map((member) => (
                <option
                  key={member.id}
                  value={member.id}
                >
                  {member.full_name} · {member.role}
                </option>
              ))}
            </select>
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
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() =>
              void createReminder()
            }
            disabled={!canSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving
              ? "Creating..."
              : "Create reminder"}
          </button>
        </div>
      </div>
    </div>
  );
}
