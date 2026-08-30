"use client";

import type { ReactNode } from "react";

type CustomerChannelSelectorProps = {
  value: string;
  label?: string;
  onClick?: () => void;
  rightAdornment?: ReactNode;
};

function LayersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="m12 4 8 4-8 4-8-4 8-4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m4 12 8 4 8-4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m4 16 8 4 8-4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="m6 9 6 6 6-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CustomerChannelSelector({
  value,
  label = "Customer channel",
  onClick,
  rightAdornment,
}: CustomerChannelSelectorProps) {
  const content = (
    <div className="flex min-h-[72px] w-full items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3 shadow-[0_6px_20px_rgba(15,23,42,0.05)]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-blue-50 text-blue-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
          <LayersIcon />
        </div>

        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {label}
          </p>
          <p className="mt-1 truncate text-[17px] font-semibold leading-tight text-slate-900">
            {value}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-slate-400">
        {rightAdornment ?? <ChevronDownIcon />}
      </div>
    </div>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left transition hover:opacity-95"
      aria-label={`${label}: ${value}`}
    >
      {content}
    </button>
  );
}

export default CustomerChannelSelector;
