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
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input type="search" placeholder={searchPlaceholder} aria-label={searchPlaceholder} value={search}
          onChange={event => onSearchChange(event.target.value)}
          className="h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-[13px] text-slate-700 outline-none transition placeholder:text-[12.5px] placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-200" />
      </div>
      <button type="button" onClick={onToggleFilter} aria-label={filterLabel} title={filterTitle}
        aria-expanded={filterOpen} aria-controls="inbox-status-filters"
        className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${filterOpen || filterApplied
          ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
        <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
        {filterApplied ? <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600" /> : null}
      </button>
    </div>
  </>;
}
