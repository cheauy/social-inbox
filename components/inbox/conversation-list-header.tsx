"use client";

import { Search, SlidersHorizontal } from "lucide-react";

export function ConversationListHeader({ search, onSearchChange, filterOpen, filterApplied, onToggleFilter,
  searchPlaceholder = "Search conversations, customers...", filterLabel = "Filter conversation status", filterTitle = "Conversation status",
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filterOpen: boolean;
  filterApplied: boolean;
  onToggleFilter: () => void;
  searchPlaceholder?: string;
  filterLabel?: string;
  filterTitle?: string;
}) {
  return <>
    <div className="mb-4 min-w-0">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">Conversations</h2>
      <p className="mt-1 text-[13px] leading-5 text-slate-500">All customer messages in one place</p>
    </div>
    <div className="flex w-full min-w-0 items-center gap-2">
      {/* Soft floating pill: faint border, low diffuse shadow, and a thin divider after the icon. */}
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <span className="pointer-events-none absolute left-[42px] top-1/2 h-5 w-px -translate-y-1/2 bg-slate-200" aria-hidden="true" />
        <input type="search" placeholder={searchPlaceholder} aria-label={searchPlaceholder} value={search}
          onChange={event => onSearchChange(event.target.value)}
          className="h-12 w-full min-w-0 rounded-2xl border border-slate-100 bg-white pl-[54px] pr-4 text-[13px] text-slate-700 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.12),0_2px_6px_-2px_rgba(15,23,42,0.06)] outline-none transition placeholder:text-[13px] placeholder:text-slate-400 focus:border-blue-200 focus:shadow-[0_6px_20px_-6px_rgba(37,99,235,0.22)]" />
      </div>
      <button type="button" onClick={onToggleFilter} aria-label={filterLabel} title={filterTitle}
        aria-expanded={filterOpen} aria-controls="inbox-status-filters"
        className={`relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-[0_6px_18px_-6px_rgba(15,23,42,0.12),0_2px_6px_-2px_rgba(15,23,42,0.06)] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${filterOpen || filterApplied
          ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}>
        <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
        {filterApplied ? <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600" /> : null}
      </button>
    </div>
  </>;
}
