"use client";

import { useEffect } from "react";
import { Trash2, X } from "lucide-react";

type DeleteConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  loadingLabel = "Deleting...",
  loading = false,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
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
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-description"
        className="w-full max-w-[560px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-slate-200 px-6 py-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <Trash2 className="h-5 w-5" strokeWidth={2.2} />
          </span>

          <h2
            id="delete-confirm-title"
            className="min-w-0 flex-1 text-xl font-extrabold tracking-tight text-slate-950"
          >
            {title}
          </h2>

          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close delete confirmation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-7">
          <p
            id="delete-confirm-description"
            className="text-base leading-7 text-slate-600"
          >
            {description}
          </p>
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
            className="inline-flex h-12 min-w-[92px] items-center justify-center rounded-xl bg-red-500 px-5 text-sm font-bold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
