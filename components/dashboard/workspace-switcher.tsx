"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WorkspaceItem = {
  memberId: string;
  businessId: string;
  businessName: string;
  slug: string | null;
  role: string;
  subscription: {
    plan_code: string;
    status: string;
    member_limit: number;
    channel_limit: number;
    current_period_end: string | null;
  } | null;
};

type WorkspacesResponse = {
  success?: boolean;
  error?: string;
  currentBusinessId?: string | null;
  workspaces?: WorkspaceItem[];
};

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [data, setData] = useState<WorkspacesResponse | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      const result = (await response.json()) as WorkspacesResponse;
      if (response.ok && result.success) setData(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const current = useMemo(
    () => data?.workspaces?.find((item) => item.businessId === data.currentBusinessId) ?? data?.workspaces?.[0] ?? null,
    [data],
  );

  if (!current && !loading) return null;

  async function switchWorkspace(businessId: string) {
    if (businessId === current?.businessId || switchingId) {
      setOpen(false);
      return;
    }

    setSwitchingId(businessId);
    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) throw new Error(result.error ?? "Unable to switch subscription.");
      window.location.assign("/dashboard/inbox");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to switch subscription.");
      setSwitchingId(null);
    }
  }

  return (
    <div ref={rootRef} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mr-2 flex max-w-[210px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:bg-slate-50"
        title="Switch subscription / workspace"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-blue-700">
          {(current?.businessName ?? "T").charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-slate-800">
            {loading ? "Loading..." : current?.businessName}
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {current?.role ?? "member"}
          </span>
        </span>
        <span className="text-slate-400">⌄</span>
      </button>

      {open ? (
        <div className="absolute right-2 top-[48px] z-[90] w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Subscriptions</p>
            <p className="mt-1 text-xs text-slate-500">The same login can be Owner in one subscription and Agent in another.</p>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {(data?.workspaces ?? []).map((item) => {
              const selected = item.businessId === current?.businessId;
              return (
                <button
                  key={item.memberId}
                  type="button"
                  disabled={Boolean(switchingId)}
                  onClick={() => void switchWorkspace(item.businessId)}
                  className={`mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition ${
                    selected ? "bg-blue-50 ring-1 ring-blue-100" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{item.businessName}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {item.subscription?.plan_code ? `${item.subscription.plan_code} · ${item.subscription.status}` : "Unmanaged"}
                    </span>
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${item.role === "owner" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {item.role}
                  </span>
                </button>
              );
            })}
          </div>
          <a
            href="/dashboard/subscription#custom-subscription"
            className="block border-t border-slate-100 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            + Create my own subscription
          </a>
        </div>
      ) : null}
    </div>
  );
}
