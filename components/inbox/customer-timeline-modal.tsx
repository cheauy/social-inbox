"use client";

import {
  useEffect,
} from "react";

import {
  CustomerTimeline,
} from "@/components/inbox/customer-timeline";

type CustomerTimelineModalProps = {
  contactId: string;
  customerName: string;
  onClose: () => void;
};

function HistoryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M3 12a9 9 0 1 0 3-6.7"
        strokeLinecap="round"
      />
      <path
        d="M3 4v6h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 7v5l3 2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CustomerTimelineModal({
  contactId,
  customerName,
  onClose,
}: CustomerTimelineModalProps) {
  useEffect(() => {
    function handleKeyDown(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close customer timeline"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Customer timeline for ${customerName}`}
        className="relative z-10 flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <HistoryIcon />
            </span>

            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-950">
                Customer Timeline
              </h2>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {customerName} · customer and team activity only
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-xl text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            aria-label="Close customer timeline"
            title="Close"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <CustomerTimeline
            contactId={contactId}
            showHeader={false}
          />
        </div>
      </section>
    </div>
  );
}
