"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { createClient } from "@/lib/supabase/client";
import { setActiveWorkspaceUiId } from "@/lib/display/workspace-storage";

type WorkspaceItem = {
  memberId: string;
  businessId: string;
  businessName: string;
  slug: string | null;
  role: string;
  subscriptionOperational?: boolean;
  subscription: {
    id?: string;
    plan_code: string;
    status: string;
    member_limit: number;
    channel_limit: number;
    current_period_end: string | null;
    trial_ends_at?: string | null;
  } | null;
};

type WorkspacesResponse = {
  success?: boolean;
  error?: string;
  currentBusinessId?: string | null;
  workspaces?: WorkspaceItem[];
};

function initials(value: string | null | undefined) {
  const words = (value ?? "TENH Workspace")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "TW";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

function planLabel(value: string | null | undefined) {
  const plan = value?.trim();
  if (!plan) return "TENH Workspace";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function roleLabel(value: string | null | undefined) {
  const role = value?.trim();
  if (!role) return "Member";
  if (role === "owner") return "Owner";
  if (role === "agent") return "Agent";
  if (role === "admin") return "Admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function WorkspaceSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const isKhmer = useWorkspaceLanguageId() === "km";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [data, setData] = useState<WorkspacesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const currentOperationalRef = useRef<boolean | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces", {
        cache: "no-store",
      });
      const result = (await response.json()) as WorkspacesResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to load workspaces.");
      }

      const nextWorkspaces = result.workspaces ?? [];
      const nextCurrent =
        nextWorkspaces.find(
          (item) => item.businessId === result.currentBusinessId,
        ) ?? null;
      const nextOperational = Boolean(
        nextCurrent &&
          (nextCurrent.subscription === null ||
            nextCurrent.subscriptionOperational === true),
      );

      setData(result);
      setActiveWorkspaceUiId(result.currentBusinessId ?? null);

      if (initializedRef.current) {
        const operationalChanged =
          currentOperationalRef.current !== nextOperational;

        if (operationalChanged) {
          // Re-render the server access gate immediately when the selected
          // workspace expires/reactivates. Never silently switch workspaces.
          router.refresh();
        }
      } else {
        initializedRef.current = true;
      }

      currentOperationalRef.current = nextOperational;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workspaces.",
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refreshQuietly = () => void load(true);
    const supabase = createClient();
    let timer: number | null = null;

    const scheduleRefresh = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(refreshQuietly, 120);
    };

    const channel = supabase
      .channel("tenh-header-workspace-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "business_subscriptions" },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_members" },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "businesses" },
        scheduleRefresh,
      )
      .subscribe();

    const poll = window.setInterval(refreshQuietly, 20_000);
    const handleFocus = () => refreshQuietly();
    const handleWorkspaceChanged = () => refreshQuietly();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("tenh:workspace-data-changed", handleWorkspaceChanged);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(poll);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("tenh:workspace-data-changed", handleWorkspaceChanged);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const workspaces = data?.workspaces ?? [];
  const current = useMemo(
    () =>
      workspaces.find(
        (item) => item.businessId === data?.currentBusinessId,
      ) ?? null,
    [data?.currentBusinessId, workspaces],
  );

  /*
   * The header switcher is operational workspace navigation. Expired,
   * past-due, suspended, and cancelled subscriptions stay preserved on the
   * Subscription page, but they must never be offered as switch targets.
   * Legacy workspaces without a managed subscription remain usable.
   */
  const activeWorkspaces = useMemo(
    () =>
      workspaces.filter(
        (item) =>
          item.subscription === null ||
          item.subscriptionOperational === true,
      ),
    [workspaces],
  );

  const currentIsOperational = Boolean(
    current &&
      (current.subscription === null ||
        current.subscriptionOperational === true),
  );

  async function switchWorkspace(businessId: string) {
    if (!businessId || switchingId) return;

    if (businessId === current?.businessId && currentIsOperational) {
      setOpen(false);
      return;
    }

    const target = activeWorkspaces.find(
      (item) => item.businessId === businessId,
    );
    if (!target) return;

    setSwitchingId(businessId);
    setError(null);

    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to switch workspace.");
      }

      setOpen(false);
      setActiveWorkspaceUiId(businessId);
      window.dispatchEvent(new Event("tenh:workspace-data-changed"));

      /*
       * Inbox is intentionally the exception: All Channels combines every
       * active subscription the user can access. After an explicit header
       * switch, clear any old workspace/channel/thread filter so Inbox opens
       * as the combined view instead of carrying a filter from Workspace A.
       * Other product areas reload in-place and become fully scoped to the
       * newly-selected workspace cookie.
       */
      if (pathname === "/dashboard/inbox" || pathname.startsWith("/dashboard/inbox/")) {
        window.location.assign("/dashboard/inbox");
        return;
      }

      window.location.reload();
    } catch (switchError) {
      setError(
        switchError instanceof Error
          ? switchError.message
          : "Unable to switch workspace.",
      );
      setSwitchingId(null);
    }
  }

  if (!current && !loading && activeWorkspaces.length === 0) {
    return null;
  }

  const buttonName =
    current?.businessName?.trim() ||
    (isKhmer ? "កន្លែងធ្វើការ" : "Workspace");

  return (
    <div ref={rootRef} className="relative block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex h-10 max-w-[176px] items-center gap-2 rounded-xl border px-2.5 text-left shadow-sm transition sm:max-w-[205px] ${
          currentIsOperational
            ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
            : "border-amber-300 bg-amber-50 hover:bg-amber-100/70"
        }`}
        title={isKhmer ? "ប្តូរកន្លែងធ្វើការ" : "Switch workspace"}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
            currentIsOperational
              ? "bg-blue-50 text-blue-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {loading ? "…" : initials(buttonName)}
        </span>

        <span className="hidden min-w-0 flex-1 xl:block">
          <span className="block truncate text-xs font-semibold text-slate-900">
            {loading
              ? isKhmer
                ? "កំពុងផ្ទុក..."
                : "Loading..."
              : buttonName}
          </span>
          <span
            className={`block truncate text-[10px] font-medium ${
              currentIsOperational ? "text-slate-400" : "text-amber-700"
            }`}
          >
            {currentIsOperational
              ? isKhmer
                ? "ប្តូរកន្លែងធ្វើការ"
                : "Switch workspace"
              : isKhmer
                ? "ការជាវផុតកំណត់"
                : "Subscription expired"}
          </span>
        </span>

        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          className={`hidden h-4 w-4 shrink-0 text-slate-400 transition xl:block ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        >
          <path
            d="m7 9 5 5 5-5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 top-[46px] z-[140] w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-100 px-4 py-3.5">
            <p className="text-sm font-bold text-slate-950">
              {isKhmer ? "ប្តូរកន្លែងធ្វើការ" : "Switch workspace"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {isKhmer
                ? "Group Chat, Analytics, Integrations និង Settings នឹងប្រើកន្លែងធ្វើការដែលអ្នកជ្រើសរើស។ Inbox នៅតែបង្ហាញឆានែលសកម្មទាំងអស់។"
                : "Group Chat, Analytics, Integrations, and Settings use the selected workspace. Inbox keeps all active customer channels together."}
            </p>
          </div>

          {!currentIsOperational && current ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-bold text-amber-900">
                {isKhmer
                  ? "ការជាវនេះបានផុតកំណត់។"
                  : "This subscription is expired."}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                {isKhmer
                  ? "សូមប្តូរទៅកន្លែងធ្វើការដែលកំពុងប្រើ ឬទិញការជាវថ្មី។"
                  : "Please switch to an active workspace or buy a new subscription."}
              </p>
            </div>
          ) : null}

          <div
            role="listbox"
            aria-label={isKhmer ? "កន្លែងធ្វើការសកម្ម" : "Active workspaces"}
            className="max-h-80 overflow-y-auto p-2"
          >
            {activeWorkspaces.length > 0 ? (
              activeWorkspaces.map((item) => {
                const selected =
                  currentIsOperational &&
                  item.businessId === current?.businessId;
                const switching = switchingId === item.businessId;

                return (
                  <button
                    key={item.memberId}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={Boolean(switchingId)}
                    onClick={() => void switchWorkspace(item.businessId)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:cursor-wait disabled:opacity-60 ${
                      selected
                        ? "bg-blue-50 ring-1 ring-blue-100"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[11px] font-bold text-blue-700">
                      {initials(item.businessName)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {item.businessName || "TENH Workspace"}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {planLabel(item.subscription?.plan_code)} · {roleLabel(item.role)}
                      </span>
                    </span>

                    {switching ? (
                      <span className="text-[11px] font-semibold text-blue-600">
                        {isKhmer ? "កំពុងប្តូរ..." : "Switching..."}
                      </span>
                    ) : selected ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      >
                        <path
                          d="m5 12.5 4 4L19 6.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs leading-5 text-slate-500">
                {isKhmer
                  ? "មិនមានកន្លែងធ្វើការសកម្មសម្រាប់ប្តូរទេ។"
                  : "No active workspace is available to switch to."}
              </div>
            )}
          </div>

          {error ? (
            <p className="border-t border-red-100 bg-red-50 px-4 py-2.5 text-xs leading-5 text-red-700">
              {error}
            </p>
          ) : null}

          <div className="border-t border-slate-100 p-2">
            <Link
              href="/dashboard/subscription"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
            >
              <span>
                {currentIsOperational
                  ? isKhmer
                    ? "គ្រប់គ្រងការជាវ"
                    : "Manage subscriptions"
                  : isKhmer
                    ? "ទិញការជាវថ្មី"
                    : "Buy new subscription"}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
