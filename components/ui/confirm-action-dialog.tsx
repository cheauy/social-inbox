"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, PlugZap, Trash2, X } from "lucide-react";

export type ConfirmActionTone = "danger" | "warning" | "primary";
export type ConfirmActionIcon = "trash" | "unplug" | "warning";

type ConfirmActionDialogProps = {
  open: boolean;
  title: string;
  subtitle?: string;
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
  children?: ReactNode;
  confirmDisabled?: boolean;
  closeLabel?: string;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
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
  subtitle,
  description,
  note,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loadingLabel = "Working...",
  loading = false,
  tone = "danger",
  icon = "warning",
  error = null,
  children,
  confirmDisabled = false,
  closeLabel = "Close confirmation",
  returnFocusRef,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const subtitleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const fallback = returnFocusRef?.current;
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    const viewport = window.visualViewport;
    const fitKeyboard = () => {
      if (!dialog || !viewport) return;
      dialog.style.maxHeight = `calc(${Math.max(0, viewport.height)}px - 2 * max(1rem, env(safe-area-inset-top), env(safe-area-inset-bottom)))`;
      dialog.style.top = `${viewport.offsetTop}px`;
      dialog.style.bottom = `${Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)}px`;
      dialog.querySelector<HTMLInputElement>("input:focus")?.scrollIntoView({ block: "nearest" });
    };
    fitKeyboard();
    viewport?.addEventListener("resize", fitKeyboard);
    viewport?.addEventListener("scroll", fitKeyboard);
    return () => {
      viewport?.removeEventListener("resize", fitKeyboard);
      viewport?.removeEventListener("scroll", fitKeyboard);
      dialog?.close();
      const target = previous instanceof HTMLElement && previous.isConnected && previous !== document.body ? previous : fallback;
      target?.focus({ preventScroll: true });
    };
  }, [open, returnFocusRef]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const Icon = ICONS[icon];

  const badgeClasses =
    tone === "danger"
      ? "bg-rose-50 text-rose-500"
      : tone === "primary" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600";

  const confirmClasses =
    tone === "danger"
      ? "bg-red-500 hover:bg-red-600"
      : tone === "primary" ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-500 hover:bg-amber-600";

  return createPortal(
      <dialog
        ref={dialogRef}
        role={tone === "primary" ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? `${subtitleId} ${descriptionId}` : descriptionId}
        aria-busy={loading}
        onClick={(event) => {
          if (loading || event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onCancel();
        }}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            if (!loading) onCancel();
            return;
          }
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
          const first = controls[0], last = controls[controls.length - 1];
          if (!first) { event.preventDefault(); event.currentTarget.focus(); }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
        }}
        onCancel={(event) => { event.preventDefault(); if (!loading) onCancel(); }}
        className="fixed m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2*max(1rem,env(safe-area-inset-left),env(safe-area-inset-right)))] max-w-[560px] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl open:flex backdrop:bg-slate-950/35 backdrop:backdrop-blur-[1px]"
      >
        <div className="flex shrink-0 items-center gap-4 border-b border-slate-200 px-5 py-4">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${badgeClasses}`}
          >
            <Icon className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-extrabold tracking-tight text-slate-950">{title}</h2>
            {subtitle ? <p id={subtitleId} className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5">
          <p
            id={descriptionId}
            className="text-base leading-7 text-slate-600"
          >
            {description}
          </p>

          {note ? (
            <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              {note}
            </p>
          ) : null}

          {children}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium leading-6 text-red-700"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-4">
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
            disabled={loading || confirmDisabled}
            className={`inline-flex h-12 min-w-[92px] items-center justify-center rounded-xl px-5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmClasses}`}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </dialog>,
      document.body,
  );
}
