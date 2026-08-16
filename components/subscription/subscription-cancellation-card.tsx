"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type CancellationState = {
  managed: boolean;
  canManage: boolean;
  status: string | null;
  currentPlan: string | null;
  currentPeriodEnd: string | null;
  cancellationScheduled: boolean;
  cancellationRequestedAt: string | null;
  cancellationEffectiveAt: string | null;
  cancellationReason: string | null;
  canSchedule: boolean;
  canUndo: boolean;
  canReactivate: boolean;
};

type CancellationResponse = {
  success?: boolean;
  error?: string;
  state?: CancellationState;
};

type SubscriptionCancellationCardProps = {
  onStateChanged?: () => void | Promise<void>;
  onOpenPlans?: () => void;
};

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatPlan(value: string | null) {
  if (!value) return "TENH plan";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function readResponse(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `Cancellation API returned an empty response (HTTP ${response.status}).`,
    );
  }

  try {
    return JSON.parse(text) as CancellationResponse;
  } catch {
    throw new Error(
      `Cancellation API returned invalid JSON (HTTP ${response.status}).`,
    );
  }
}

export function SubscriptionCancellationCard({
  onStateChanged,
  onOpenPlans,
}: SubscriptionCancellationCardProps) {
  const [state, setState] =
    useState<CancellationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [notice, setNotice] =
    useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] =
    useState(false);
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/subscription/cancellation",
        { cache: "no-store" },
      );
      const result = await readResponse(response);

      if (!response.ok || !result.success || !result.state) {
        throw new Error(
          result.error ??
            "Unable to load subscription cancellation information.",
        );
      }

      setState(result.state);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load subscription cancellation information.",
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!cancelModalOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCancelModalOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelModalOpen]);

  async function mutate(
    action: "schedule" | "undo",
  ) {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/subscription/cancellation",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
            reason:
              action === "schedule"
                ? reason.trim()
                : undefined,
          }),
        },
      );
      const result = await readResponse(response);

      if (!response.ok || !result.success || !result.state) {
        throw new Error(
          result.error ??
            "Unable to update subscription cancellation.",
        );
      }

      setState(result.state);
      setCancelModalOpen(false);
      setReason("");
      setUnderstood(false);
      setNotice(
        action === "schedule"
          ? "Cancellation scheduled. Your current paid plan stays active until the end of the billing period."
          : "Cancellation undone. Your current subscription will continue normally.",
      );

      await onStateChanged?.();
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Unable to update subscription cancellation.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return null;
  }

  if (!state?.managed) {
    return null;
  }

  if (state.status === "cancelled") {
    return (
      <section className="mt-6 rounded-[24px] border border-red-200 bg-red-50 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">
              Subscription ended
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              Reactivate your TENH workspace
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Your previous paid period has ended. TENH keeps the workspace data stored, but a new approved payment is required before paid access is restored.
            </p>
          </div>

          {state.canReactivate ? (
            <button
              type="button"
              onClick={onOpenPlans}
              className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700"
            >
              Reactivate subscription
            </button>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  if (
    state.status !== "active" ||
    !["mini", "standard", "pro"].includes(
      state.currentPlan ?? "",
    )
  ) {
    return null;
  }

  if (state.cancellationScheduled) {
    return (
      <section className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">
              Cancellation scheduled
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              {formatPlan(state.currentPlan)} stays active until {formatDate(
                state.cancellationEffectiveAt ?? state.currentPeriodEnd,
              )}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              No access is removed early. Your current plan, channels, team seats, conversations, and workspace data remain available through the paid period. Plan changes and new subscription payments are blocked until the owner undoes this cancellation.
            </p>
            {state.cancellationReason ? (
              <p className="mt-2 text-xs text-slate-500">
                Reason: {state.cancellationReason}
              </p>
            ) : null}
          </div>

          {state.canUndo ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void mutate("undo")}
              className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-amber-300 bg-white px-5 py-3 text-sm font-bold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Restoring..." : "Undo cancellation"}
            </button>
          ) : (
            <span className="text-xs font-semibold text-amber-800">
              Workspace owner can undo this cancellation.
            </span>
          )}
        </div>

        {notice ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  if (!state.canSchedule) {
    return null;
  }

  return (
    <>
      <section className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Manage subscription
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Cancel subscription
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Cancel at the end of the current billing period. Your {formatPlan(
                state.currentPlan,
              )} plan stays active until {formatDate(
                state.currentPeriodEnd,
              )}; TENH does not delete your workspace data when paid access ends.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
              setCancelModalOpen(true);
            }}
            className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100"
          >
            Cancel at period end
          </button>
        </div>

        {notice ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>

      {cancelModalOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tenh-cancel-subscription-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setCancelModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">
                  Confirmation
                </p>
                <h2
                  id="tenh-cancel-subscription-title"
                  className="mt-1 text-2xl font-bold text-slate-950"
                >
                  Cancel your subscription?
                </h2>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() => setCancelModalOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 transition hover:bg-slate-200 disabled:opacity-50"
                aria-label="Close cancellation dialog"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Current plan
                </p>
                <p className="mt-1 font-bold text-slate-950">
                  {formatPlan(state.currentPlan)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Access remains until
                </p>
                <p className="mt-1 font-bold text-slate-950">
                  {formatDate(state.currentPeriodEnd)}
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-600">
              Cancellation is not immediate. Your current paid features stay available until the date above. After that date the workspace is locked for paid use, but TENH keeps its data so the owner can reactivate with a new approved subscription payment.
            </p>

            <label className="mt-5 block text-sm font-semibold text-slate-800">
              Reason <span className="font-normal text-slate-400">(optional)</span>
              <textarea
                value={reason}
                onChange={(event) =>
                  setReason(event.target.value.slice(0, 500))
                }
                rows={3}
                placeholder="Tell TENH why you are cancelling."
                className="mt-2 w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-50"
              />
              <span className="mt-1 block text-right text-xs font-normal text-slate-400">
                {reason.length}/500
              </span>
            </label>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4">
              <input
                type="checkbox"
                checked={understood}
                onChange={(event) =>
                  setUnderstood(event.target.checked)
                }
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm leading-6 text-slate-600">
                I understand that the subscription stays active until {formatDate(
                  state.currentPeriodEnd,
                )} and then paid workspace access ends unless I undo the cancellation or reactivate later.
              </span>
            </label>

            {error ? (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => setCancelModalOpen(false)}
                className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Keep subscription
              </button>
              <button
                type="button"
                disabled={!understood || saving}
                onClick={() => void mutate("schedule")}
                className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                {saving ? "Scheduling..." : "Schedule cancellation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
