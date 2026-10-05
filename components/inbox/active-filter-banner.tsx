"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

/*
 * One look for "the list is narrowed": status filters, Unread, Pinned,
 * Facebook comments and every Smart View. Before this each had its own strip
 * (a grey "Showing:" pill for status, a violet line for views), so the same
 * idea read as two different features depending on which one was active.
 */

type ClearAction =
  | { href: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void }
  | { onClick: () => void; href?: undefined };

export function ActiveFilterBanner({
  icon,
  label,
  count,
  clearLabel,
  clear,
  actions,
  footer,
}: {
  icon: ReactNode;
  label: string;
  count: ReactNode;
  clearLabel: string;
  clear: ClearAction;
  /* Optional controls beside Clear, such as Mark all as read. */
  actions?: ReactNode;
  /* Optional status line under the card, such as a bulk-read result. */
  footer?: ReactNode;
}) {
  const clearClassName =
    "inline-flex shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 transition hover:bg-blue-100/70 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

  const clearContent = (
    <>
      {clearLabel}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-3 w-3" aria-hidden="true">
        <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );

  return (
    <div className="shrink-0 px-3 pb-1 pt-2">
      <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 via-sky-50/80 to-blue-50/60 px-2 py-[7px] shadow-[0_1px_2px_rgba(30,64,175,0.04)]">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600" aria-hidden="true">
          {icon}
        </span>

        {/* The name may shorten; the count never does -- it is the point. */}
        <p className="flex min-w-0 flex-1 items-center text-[12.5px] font-bold text-[#1d4e89]">
          <span className="min-w-0 truncate">{label}</span>
          <span className="mx-1.5 shrink-0 font-semibold text-slate-400" aria-hidden="true">·</span>
          <span className="shrink-0 text-blue-600">{count}</span>
        </p>

        {actions}

        <span className="h-4 w-px shrink-0 bg-blue-200/70" aria-hidden="true" />

        {clear.href !== undefined ? (
          <Link href={clear.href} onClick={clear.onClick} className={clearClassName}>
            {clearContent}
          </Link>
        ) : (
          <button type="button" onClick={clear.onClick} className={clearClassName}>
            {clearContent}
          </button>
        )}
      </div>

      {footer}
    </div>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  className: "h-3.5 w-3.5",
  "aria-hidden": true,
} as const;

/* Icons for each kind of narrowing, drawn to match the double tick in Unread. */
export const filterBannerIcons: Record<string, ReactNode> = {
  unread: (
    <svg {...iconProps}>
      <path d="m3 12 4 4 9-9M12 16l9-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  my: (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  ),
  unassigned: (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.5" strokeDasharray="2.5 2" />
      <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" strokeDasharray="2.5 2" />
    </svg>
  ),
  comment: (
    <svg {...iconProps}>
      <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M8 9.5h8M8 12.5h5" strokeLinecap="round" />
    </svg>
  ),
  open: (
    <svg {...iconProps}>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-1-2V7Z" strokeLinejoin="round" />
    </svg>
  ),
  pinned: (
    <svg {...iconProps}>
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" strokeLinejoin="round" />
      <path d="M12 14v6" strokeLinecap="round" />
    </svg>
  ),
  smart: (
    <svg {...iconProps}>
      <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" strokeLinejoin="round" />
    </svg>
  ),
};

/* Status gets its own colour, the same one the rows and the status menu use. */
const statusDot: Record<string, string> = {
  open: "bg-[#10B981]",
  pending: "bg-[#F59E0B]",
  resolved: "bg-[#0089CC]",
  closed: "bg-[#94A3B8]",
  spam: "bg-[#EF4444]",
};

export function statusBannerIcon(status: string) {
  return <span className={`h-2.5 w-2.5 rounded-full ring-4 ring-white/70 ${statusDot[status] ?? "bg-slate-400"}`} />;
}
