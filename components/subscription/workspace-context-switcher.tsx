"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

type WorkspaceItem = {
  businessId: string;
  businessName: string;
  ownerName: string;
  role: string;
  usage?: {
    members?: number;
    channels?: number;
  };
  subscription: {
    id: string;
    plan_code: string;
    status: string;
    member_limit: number;
    channel_limit: number;
  } | null;
};

type WorkspaceResponse = {
  success?: boolean;
  error?: string;
  currentBusinessId?: string | null;
  workspaces?: WorkspaceItem[];
};

type WorkspaceContextSwitcherProps = {
  compact?: boolean;
  simple?: boolean;
  className?: string;
};

const WORKSPACE_LOAD_TIMEOUT_MS = 8000;

function shortSubscriptionId(value: string | null | undefined) {
  const id = value?.trim();
  return id ? `#${id.slice(0, 8).toUpperCase()}` : "No subscription ID";
}

function planLabel(value: string | null | undefined) {
  const plan = value?.trim();
  if (!plan) return "No plan";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function statusLabel(value: string | null | undefined) {
  const status = value?.trim();
  if (!status) return "Unknown";
  return status
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function workspaceInitials(value: string | null | undefined) {
  const words = (value ?? "TENH Workspace")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "TW";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

function workspaceAvatarClasses(value: string | null | undefined) {
  const palettes = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-violet-100 text-violet-700",
    "bg-amber-100 text-amber-700",
  ];

  const source = value ?? "TENH Workspace";
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash + source.charCodeAt(index)) % palettes.length;
  }

  return palettes[hash] ?? palettes[0];
}

function statusClasses(status: string | null | undefined) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "trialing":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "past_due":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "suspended":
      return "border-red-200 bg-red-50 text-red-700";
    case "expired":
    case "cancelled":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function WorkspaceContextSwitcher({
  compact = false,
  simple = false,
  className = "",
}: WorkspaceContextSwitcherProps) {
  const workspaceLanguageId = useWorkspaceLanguageId();
  const isKhmer = workspaceLanguageId === "km";
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simpleMenuOpen, setSimpleMenuOpen] = useState(false);
  const simpleMenuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, WORKSPACE_LOAD_TIMEOUT_MS);

    try {
      const response = await fetch("/api/workspaces", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      const result = (await response.json()) as WorkspaceResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to load your subscriptions.");
      }

      setData(result);
    } catch (loadError) {
      const timedOut =
        loadError instanceof DOMException &&
        loadError.name === "AbortError";

      setError(
        timedOut
          ? "Workspace is taking longer than expected. Try again."
          : loadError instanceof Error
            ? loadError.message
            : "Unable to load your subscriptions.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!simpleMenuOpen) return;

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        simpleMenuRef.current &&
        !simpleMenuRef.current.contains(target)
      ) {
        setSimpleMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSimpleMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [simpleMenuOpen]);

  const workspaces = data?.workspaces ?? [];
  const currentBusinessId = data?.currentBusinessId ?? "";
  const current = useMemo(
    () => workspaces.find((item) => item.businessId === currentBusinessId) ?? null,
    [currentBusinessId, workspaces],
  );
  const usableWorkspaces = useMemo(
    () =>
      workspaces.filter((item) => {
        const status = item.subscription?.status;
        return status === "active" || status === "trialing";
      }),
    [workspaces],
  );
  const currentIsUsable = Boolean(
    current &&
      (current.subscription?.status === "active" ||
        current.subscription?.status === "trialing"),
  );

  const displayPlanLabel = (value: string | null | undefined) => {
    const label = planLabel(value);
    if (!isKhmer) return label;
    if (value === "custom") return "ផ្ទាល់ខ្លួន";
    if (!value) return "គ្មានគម្រោង";
    return label;
  };
  const displayStatusLabel = (value: string | null | undefined) => {
    if (!isKhmer) return statusLabel(value);
    switch (value) {
      case "active": return "កំពុងប្រើ";
      case "trialing": return "សាកល្បង";
      case "past_due": return "ហួសកាលកំណត់";
      case "suspended": return "បានផ្អាក";
      case "expired": return "ផុតកំណត់";
      case "cancelled": return "បានលុបចោល";
      default: return "មិនស្គាល់";
    }
  };
  const displayRoleLabel = (value: string | null | undefined) => {
    if (!isKhmer) return value ?? "";
    if (value === "owner") return "ម្ចាស់";
    if (value === "admin") return "អ្នកគ្រប់គ្រង";
    if (value === "agent") return "សមាជិកក្រុម";
    return value ?? "";
  };

  async function switchWorkspace(nextBusinessId: string) {
    if (!nextBusinessId || nextBusinessId === currentBusinessId || switching) {
      return;
    }

    const target = usableWorkspaces.find(
      (item) => item.businessId === nextBusinessId,
    );
    if (!target) return;

    const targetId = shortSubscriptionId(target.subscription?.id);
    const confirmed = window.confirm(
      `Switch TENH to subscription ${targetId}? Integrations, Inbox, settings, users, and channel usage will then show only that subscription.`,
    );

    if (!confirmed) return;

    setSwitching(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: nextBusinessId }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to switch subscription.");
      }

      // This is an explicit user-requested switch. Reload so every server and
      // client component uses the exact same workspace cookie and cannot mix data.
      window.location.reload();
    } catch (switchError) {
      setError(
        switchError instanceof Error
          ? switchError.message
          : "Unable to switch subscription.",
      );
      setSwitching(false);
    }
  }

  if (loading) {
    return (
      <div className={className} aria-busy="true" aria-live="polite">
        {simple ? (
          <p className="mb-2 text-[12px] font-semibold text-slate-500">
            {isKhmer ? "កន្លែងធ្វើការ" : "Workspace"}
          </p>
        ) : null}

        <div
          className={`flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm ${
            simple ? "min-h-[58px]" : "min-h-[54px]"
          }`}
        >
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-slate-100" />

          <span className="min-w-0 flex-1">
            <span className="block h-3.5 w-44 max-w-[65%] animate-pulse rounded bg-slate-100" />
            <span className="mt-2 block h-2.5 w-24 max-w-[40%] animate-pulse rounded bg-slate-100" />
          </span>

          <span className="h-4 w-4 shrink-0 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={className}>
        {simple ? (
          <p className="mb-2 text-[12px] font-semibold text-slate-500">
            {isKhmer ? "កន្លែងធ្វើការ" : "Workspace"}
          </p>
        ) : null}

        <div className="flex min-h-[58px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-500">
            WS
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-800">
              {isKhmer ? "មិនអាចផ្ទុកកន្លែងធ្វើការបាន" : "Unable to load workspace"}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-slate-500">
              {error}
            </span>
          </span>

          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-50"
          >
            {isKhmer ? "ព្យាយាមម្តងទៀត" : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  if (!current || !currentIsUsable) {
    return (
      <div className={className}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-bold text-amber-900">
            {isKhmer ? "ជ្រើសរើសការជាវដែលកំពុងប្រើ" : "Select an active subscription"}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-amber-800">
            {isKhmer
              ? "ការជាវដែលផុតកំណត់ ហួសកាលកំណត់ បានផ្អាក ឬបានលុបចោល ត្រូវបានរក្សាទុកនៅទំព័រការជាវ ប៉ុន្តែមិនអាចប្រើបានក្នុងការកំណត់ ការតភ្ជាប់ ឬប្រអប់សារទេ។"
              : "Expired, past-due, suspended, or cancelled subscriptions are kept on the Subscription page but are not available in Settings, Integrations, or Inbox."}
          </p>

          {usableWorkspaces.length > 0 ? (
            <label className="mt-3 block">
              <span className="sr-only">Select active TENH subscription</span>
              <select
                value=""
                disabled={switching}
                onChange={(event) => void switchWorkspace(event.target.value)}
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                aria-label={isKhmer ? "ជ្រើសរើសការជាវ TENH ដែលកំពុងប្រើ" : "Select active TENH subscription"}
              >
                <option value="" disabled>
                  {isKhmer ? "ជ្រើសរើសការជាវដែលកំពុងប្រើ…" : "Choose active subscription…"}
                </option>
                {usableWorkspaces.map((item) => {
                  const itemSubscription = item.subscription;
                  const itemUsage = item.usage;
                  const usageText = itemUsage
                    ? ` · ${itemUsage.channels ?? 0}/${itemSubscription?.channel_limit ?? "-"} ${isKhmer ? "ឆានែល" : "channels"}`
                    : "";

                  return (
                    <option key={item.businessId} value={item.businessId}>
                      {shortSubscriptionId(itemSubscription?.id)} · {displayPlanLabel(itemSubscription?.plan_code)} · {displayStatusLabel(itemSubscription?.status)}{usageText}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : (
            <p className="mt-3 text-[11px] font-semibold text-amber-900">
              {isKhmer
                ? "មិនមានការជាវដែលកំពុងប្រើ ឬការជាវសាកល្បងទេ។ បើកទំព័រការជាវ ដើម្បីដំណើរការឡើងវិញ ឬទិញគម្រោង។"
                : "No active or trial subscription is available. Open Subscription to reactivate or buy a plan."}
            </p>
          )}
        </div>
        {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
      </div>
    );
  }

  const subscription = current.subscription;

  if (simple) {
    return (
      <div className={className}>
        <p className="mb-2 text-[12px] font-semibold text-slate-500">
          {isKhmer ? "កន្លែងធ្វើការ" : "Workspace"}
        </p>

        <div ref={simpleMenuRef} className="relative">
          <button
            type="button"
            disabled={switching}
            onClick={() => setSimpleMenuOpen((open) => !open)}
            className={`flex min-h-[58px] w-full items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-left shadow-sm transition disabled:cursor-wait disabled:opacity-70 ${
              simpleMenuOpen
                ? "border-blue-500 ring-1 ring-blue-100"
                : "border-slate-200 hover:border-slate-300"
            }`}
            aria-expanded={simpleMenuOpen}
            aria-haspopup="listbox"
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${workspaceAvatarClasses(
                current.businessName,
              )}`}
            >
              {workspaceInitials(current.businessName)}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-slate-950">
                {current.businessName || "TENH Workspace"}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-slate-500">
                {displayPlanLabel(subscription?.plan_code)} · {displayRoleLabel(current.role)}
              </span>
            </span>

            <svg
              viewBox="0 0 24 24"
              fill="none"
              className={`h-4 w-4 shrink-0 text-slate-400 transition ${
                simpleMenuOpen ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            >
              <path
                d="m8 10 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {simpleMenuOpen ? (
            <div
              role="listbox"
              aria-label={isKhmer ? "ជ្រើសរើសកន្លែងធ្វើការ TENH" : "Choose TENH workspace"}
              className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"
            >
              {usableWorkspaces.map((item) => {
                const selected = item.businessId === current.businessId;

                return (
                  <button
                    key={item.businessId}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={switching}
                    onClick={() => {
                      setSimpleMenuOpen(false);
                      void switchWorkspace(item.businessId);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:opacity-60 ${
                      selected
                        ? "bg-white"
                        : "hover:bg-blue-50/80"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${workspaceAvatarClasses(
                        item.businessName,
                      )}`}
                    >
                      {workspaceInitials(item.businessName)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-slate-900">
                        {item.businessName || "TENH Workspace"}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {displayPlanLabel(item.subscription?.plan_code)} · {displayRoleLabel(item.role)}
                      </span>
                    </span>

                    {selected ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        className="h-4 w-4 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      >
                        <path
                          d="m5 12.5 4 4L19 6.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-1.5 text-[11px] text-red-600">{error}</p>
        ) : null}
      </div>
    );
  }

  const subscriptionId = shortSubscriptionId(subscription?.id);
  const label = `${subscriptionId} · ${displayPlanLabel(subscription?.plan_code)}`;

  return (
    <div className={className}>
      <div
        className={`rounded-2xl border border-blue-100 bg-blue-50/70 ${
          compact ? "p-3" : "p-4"
        }`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
              {isKhmer ? "ការជាវបច្ចុប្បន្ន" : "Current subscription"}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClasses(
                subscription?.status,
              )}`}
            >
              {displayStatusLabel(subscription?.status)}
            </span>
          </div>

          <div>
            <p className={`${compact ? "text-sm" : "text-base"} font-bold text-slate-950`}>
              {label}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {current.businessName || "TENH Workspace"} · {displayRoleLabel(current.role)}
            </p>
          </div>

          {usableWorkspaces.length > 1 ? (
            <label className="block">
              <span className="sr-only">Switch subscription</span>
              <select
                value={current.businessId}
                disabled={switching}
                onChange={(event) => void switchWorkspace(event.target.value)}
                className="mt-1 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                aria-label={isKhmer ? "ប្តូរការជាវ TENH" : "Switch TENH subscription"}
              >
                {usableWorkspaces.map((item) => {
                  const itemSubscription = item.subscription;
                  const itemUsage = item.usage;
                  const usageText = itemUsage
                    ? ` · ${itemUsage.channels ?? 0}/${itemSubscription?.channel_limit ?? "-"} ${isKhmer ? "ឆានែល" : "channels"}`
                    : "";

                  return (
                    <option key={item.businessId} value={item.businessId}>
                      {shortSubscriptionId(itemSubscription?.id)} · {displayPlanLabel(itemSubscription?.plan_code)} · {displayStatusLabel(itemSubscription?.status)}{usageText}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}

          <p className="text-[11px] leading-4 text-slate-500">
            {isKhmer
              ? "TENH បង្ហាញ និងអនុញ្ញាតឲ្យផ្លាស់ប្តូរ អ្នកប្រើប្រាស់ ឆានែល ទិន្នន័យប្រអប់សារ និងការតភ្ជាប់ សម្រាប់ការជាវនេះប៉ុណ្ណោះ។ ការប្តូរមិនត្រូវបានធ្វើដោយស្វ័យប្រវត្តិនៅទីនេះទេ។"
              : "TENH only shows and changes users, channels, Inbox data, and integrations for this subscription. Switching is never automatic here."}
          </p>
        </div>
      </div>

      {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
