"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

type PageItem = {
  id: string;
  name: string;
  ready: boolean;
};

type WorkspaceItem = {
  businessId: string;
  usage?: {
    channels?: number;
  };
  subscription?: {
    channel_limit?: number;
  } | null;
};

type WorkspaceResponse = {
  success?: boolean;
  currentBusinessId?: string | null;
  workspaces?: WorkspaceItem[];
};

type Props = {
  pages: PageItem[];
  unresolvedCount: number;
};

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "FB";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function PageAvatar({ page }: { page: PageItem }) {
  const [failed, setFailed] = useState(false);
  const src = `https://graph.facebook.com/${page.id}/picture?type=large`;

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-base font-bold text-white shadow-sm">
      <span>{initials(page.name)}</span>
      {!failed ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "blue" | "green" | "amber";
}) {
  const classes =
    tone === "blue"
      ? "bg-blue-50 text-blue-700"
      : tone === "green"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>
      <span className={`h-2 w-2 rounded-full ${tone === "blue" ? "bg-blue-600" : tone === "green" ? "bg-emerald-500" : "bg-amber-500"}`} />
      {children}
    </span>
  );
}

export function FacebookPageSelectUi({
  pages,
  unresolvedCount,
}: Props) {
  const isKhmer = useWorkspaceLanguageId() === "km";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "ready" | "needs_access">("all");
  const [channelUsage, setChannelUsage] = useState<{
    used: number;
    limit: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceUsage() {
      try {
        const response = await fetch("/api/workspaces", {
          method: "GET",
          cache: "no-store",
        });
        const result = (await response.json()) as WorkspaceResponse;
        if (!response.ok || !result.success || cancelled) return;

        const current = (result.workspaces ?? []).find(
          (item) => item.businessId === result.currentBusinessId,
        );
        const used = Number(current?.usage?.channels ?? 0);
        const limit = Number(current?.subscription?.channel_limit ?? 0);
        if (Number.isFinite(limit) && limit > 0) {
          setChannelUsage({ used, limit });
        }
      } catch {
        // This panel stays usable if the usage summary cannot be loaded.
      }
    }

    void loadWorkspaceUsage();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return pages.filter((page) => {
      if (term && !`${page.name} ${page.id}`.toLowerCase().includes(term)) {
        return false;
      }
      if (status === "ready" && !page.ready) return false;
      if (status === "needs_access" && page.ready) return false;
      return true;
    });
  }, [pages, search, status]);

  const selectedCount = selected.size;
  const usagePercent = channelUsage
    ? Math.min(100, Math.max(0, (channelUsage.used / channelUsage.limit) * 100))
    : 0;

  function toggle(pageId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  return (
    <form action="/api/facebook/oauth/select" method="post" className="mt-5">
      {unresolvedCount > 0 ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {isKhmer
            ? `Facebook បានអនុញ្ញាត Page បន្ថែម ${unresolvedCount} ប៉ុន្តែ Meta មិនអនុញ្ញាតឱ្យ TENH ទាញព័ត៌មាន Page ទាំងនេះបាននៅឡើយ។ សូមភ្ជាប់សិទ្ធិ Page ឡើងវិញ និងពិនិត្យសិទ្ធិ Facebook ដែលត្រូវការ។`
            : `Facebook authorized ${unresolvedCount} additional Page${unresolvedCount === 1 ? "" : "s"}, but Meta did not allow TENH to resolve the Page details yet. Reconnect Page access and verify the required Facebook permissions.`}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="min-w-0">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-xs font-medium text-slate-500 sm:text-sm">
              <span>{isKhmer ? `មាន ${pages.length} Page` : `${pages.length} pages available`}</span>
              <span className="mx-3 text-slate-300">•</span>
              <span>
                {isKhmer ? "បានជ្រើសរើស៖" : "Selected:"} <strong className="text-blue-600">{selectedCount}</strong>
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block sm:w-[285px]">
                <span className="sr-only">{isKhmer ? "ស្វែងរក Facebook Page" : "Search Facebook Pages"}</span>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={isKhmer ? "ស្វែងរក Page..." : "Search pages..."}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </label>

              <label className="relative block sm:w-[165px]">
                <span className="sr-only">{isKhmer ? "តម្រងស្ថានភាព Page" : "Filter Page status"}</span>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
                  className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-9 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                >
                  <option value="all">{isKhmer ? "ស្ថានភាពទាំងអស់" : "All status"}</option>
                  <option value="ready">{isKhmer ? "រួចរាល់" : "Ready"}</option>
                  <option value="needs_access">{isKhmer ? "ត្រូវការសិទ្ធិចូលប្រើ" : "Needs access"}</option>
                </select>
                <svg viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
                </svg>
              </label>
            </div>
          </div>

          <div className="mt-3 max-h-[42dvh] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {filtered.map((page) => {
              const checked = selected.has(page.id);
              return (
                <label
                  key={page.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3 transition ${checked ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-100" : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/20"}`}
                >
                  <input
                    type="checkbox"
                    name="pageId"
                    value={page.id}
                    checked={checked}
                    onChange={() => toggle(page.id)}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 accent-blue-600"
                  />

                  <PageAvatar page={page} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-bold tracking-[-0.01em] text-slate-950">
                      {page.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-blue-600 text-[10px] font-bold text-white">f</span>
                      <span>Facebook</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {isKhmer ? "លេខសម្គាល់ Page៖" : "Page ID:"} {page.id}
                    </p>
                  </div>

                  <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 lg:flex">
                    <Badge tone="blue">Messenger</Badge>
                    <Badge tone="green">{isKhmer ? "មតិយោបល់" : "Comments"}</Badge>
                    <Badge tone={page.ready ? "green" : "amber"}>
                      {page.ready ? (isKhmer ? "រួចរាល់" : "Ready") : (isKhmer ? "ត្រូវការសិទ្ធិចូលប្រើ" : "Needs access")}
                    </Badge>
                  </div>
                </label>
              );
            })}

            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                {isKhmer ? "មិនមាន Facebook Page ដែលត្រូវនឹងការស្វែងរក ឬតម្រងនេះទេ។" : "No Facebook Pages match this search/filter."}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="max-h-[58dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4">
          <div className="mx-auto flex h-24 max-w-[210px] items-center justify-center">
            <div className="relative h-24 w-44 scale-75">
              <div className="absolute left-7 top-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-4xl font-bold text-white shadow-lg">f</div>
              <div className="absolute right-2 top-12 w-28 rounded-2xl border border-blue-100 bg-white p-3 shadow-lg">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm text-white">↗</span>
                  <span className="h-2 w-10 rounded-full bg-slate-200" />
                </div>
              </div>
              <div className="absolute left-[93px] top-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-blue-600 shadow-sm">•••</div>
              <span className="absolute left-[76px] top-[60px] h-px w-9 border-t border-dashed border-blue-300" />
            </div>
          </div>

          <h2 className="text-base font-bold text-slate-950">{isKhmer ? "របៀបដំណើរការ" : "How it works"}</h2>
          <p className="mt-2 text-sm leading-5 text-slate-500">
            {isKhmer
              ? "Page ដែលបានជ្រើសរើសនឹងធ្វើសមកាលកម្មសន្ទនា Messenger និងមតិយោបល់ចូលទៅក្នុង TENH ដើម្បីឱ្យក្រុមរបស់អ្នកអាចឆ្លើយតប និងគ្រប់គ្រងអ្វីៗទាំងអស់នៅកន្លែងតែមួយ។"
              : "Selected Pages will sync Messenger conversations and comments into TENH so your team can engage and manage everything in one place."}
          </p>

          <div className="my-4 h-px bg-slate-200" />

          {channelUsage ? (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="6" y="10" width="12" height="10" rx="2" />
                  <path d="M9 10V7a3 3 0 0 1 6 0v3" />
                </svg>
                <span>{isKhmer ? `បានប្រើ ${channelUsage.used} ក្នុងចំណោម ${channelUsage.limit} កន្លែងឆានែល` : `${channelUsage.used} of ${channelUsage.limit} channel slots used`}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${usagePercent}%` }} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              {isKhmer ? "កម្រិតឆានែលត្រូវបានគ្រប់គ្រងដោយគម្រោង TENH បច្ចុប្បន្នរបស់អ្នក។" : "Channel limits are managed by your current TENH subscription."}
            </p>
          )}

          <Link href="/dashboard/subscription" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
            {isKhmer ? "ស្វែងយល់បន្ថែមអំពីឆានែល" : "Learn more about channels"}
            <span aria-hidden="true">↗</span>
          </Link>
        </aside>
      </div>

      <div className="sticky bottom-0 z-20 mt-4 border-t border-slate-200 bg-white/95 pt-3 pb-1 backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/api/facebook/oauth/connect" className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeLinecap="round" />
                <path d="M20 4v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {isKhmer ? "ភ្ជាប់សិទ្ធិ Page ឡើងវិញ" : "Reconnect Page access"}
            </Link>
            <p className="mt-1 text-xs text-slate-500">
              {isKhmer ? "ប្រសិនបើអ្នកមិនឃើញ Page របស់អ្នក សូមភ្ជាប់ឡើងវិញដើម្បីធ្វើបច្ចុប្បន្នភាពបញ្ជី។" : "If you don't see your Page, reconnect to refresh the list."}
            </p>
          </div>

          <div className="w-full lg:max-w-[430px]">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/dashboard/integrations" className="flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {isKhmer ? "បោះបង់" : "Cancel"}
              </Link>
              <button type="submit" className="flex h-11 flex-[1.5] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">
                {isKhmer ? "ភ្ជាប់ Page" : selectedCount === 1 ? "Connect Page" : "Connect Pages"}
                <span aria-hidden="true">→</span>
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-slate-500">
              {isKhmer ? "◈ អ្នកអាចបន្ថែម ឬដក Page ចេញបានគ្រប់ពេលនៅក្នុង Integrations។" : "◈ You can add or remove Pages anytime in Integrations."}
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}
