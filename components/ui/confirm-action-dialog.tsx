"use client";

import { useEffect } from "react";
import { AlertTriangle, PlugZap, Trash2, X } from "lucide-react";

export type ConfirmActionTone = "danger" | "warning";
export type ConfirmActionIcon = "trash" | "unplug" | "warning";

type ConfirmActionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  /** Optional extra line shown under the description, e.g. what is preserved. */
  note?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  loading?: boolean;
  tone?: ConfirmActionTone;
  icon?: ConfirmActionIcon;
  /** Shown inside the dialog when the action fails, so the modal stays open. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const ICONS = {
  trash: Trash2,
  unplug: PlugZap,
  warning: AlertTriangle,
} as const;

/**
 * Shared confirmation modal for destructive or disruptive actions.
 *
 * Replaces window.confirm(), which cannot be styled, is blocked by some
 * browsers, renders untranslated OS chrome, and gives the customer no way to
 * see progress or an error without a second native popup.
 */
export function ConfirmActionDialog({
  open,
  title,
  description,
  note,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loadingLabel = "Working...",
  loading = false,
  tone = "danger",
  icon = "warning",
  error = null,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onCancel, open]);

  if (!open) {
    return null;
  }

  const Icon = ICONS[icon];

  const badgeClasses =
    tone === "danger"
      ? "bg-rose-50 text-rose-500"
      : "bg-amber-50 text-amber-600";

  const confirmClasses =
    tone === "danger"
      ? "bg-red-500 hover:bg-red-600"
      : "bg-amber-500 hover:bg-amber-600";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onCancel();
        }
      }}
      role="presentation"
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-action-title"
        aria-describedby="confirm-action-description"
        className="w-full max-w-[560px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-slate-200 px-6 py-5">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${badgeClasses}`}
          >
            <Icon className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <h2
            id="confirm-action-title"
            className="min-w-0 flex-1 text-xl font-extrabold tracking-tight text-slate-950"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close confirmation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-7">
          <p
            id="confirm-action-description"
            className="text-base leading-7 text-slate-600"
          >
            {description}
          </p>

          {note ? (
            <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              {note}
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium leading-6 text-red-700"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex h-12 min-w-[92px] items-center justify-center rounded-xl px-5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmClasses}`}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
