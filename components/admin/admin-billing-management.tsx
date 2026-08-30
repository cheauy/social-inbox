"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

const PLAN_LABELS: Record<string, string> = {
  trial: "Free Trial",
  mini: "Mini",
  standard: "Standard",
  pro: "Pro",
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: "Monthly",
  "3-months": "3 Months",
  "6-months": "6 Months",
  "12-months": "1 Year",
};

const PAGE_SIZE = 10;

type WorkspaceRow = {
  businessId: string;
  businessName: string;
  slug: string | null;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  managed: boolean;
  planCode: string | null;
  status: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  memberLimit: number | null;
  channelLimit: number | null;
  paymentProvider: string | null;
  activeMembers: number;
  activeChannels: number;
  pendingManual: number;
  invoiceCount: number;
  lastPaidAt: string | null;
  lastInvoiceNumber: string | null;
};

type WorkspaceDetail = {
  business: {
    id: string;
    name: string;
    slug: string | null;
    createdAt: string;
    ownerName: string | null;
    ownerEmail: string | null;
  };
  subscription: Record<string, any> | null;
  usage: {
    activeMembers: number;
    activeChannels: number;
  };
  members: Array<{
    id: string;
    fullName: string | null;
    email: string | null;
    role: string;
    active: boolean;
    createdAt: string;
  }>;
  channels: Array<{
    id: string;
    platform: string;
    accountName: string | null;
    platformAccountId: string | null;
    active: boolean;
    createdAt: string;
  }>;
  payWayTransactions: Array<{
    id: string;
    transactionId: string;
    planCode: string;
    billingCycle: string;
    amount: number;
    currency: string;
    status: string;
    providerStatusCode: string | null;
    providerStatus: string | null;
    approvalCode: string | null;
    verifiedAt: string | null;
    createdAt: string;
  }>;
  manualPayments: Array<{
    id: string;
    requestedByMemberId: string | null;
    planCode: string;
    billingCycle: string;
    amount: number;
    currency: string;
    status: string;
    customerNote: string | null;
    reviewedByEmail: string | null;
    reviewedAt: string | null;
    reviewNote: string | null;
    approvedAt: string | null;
    createdAt: string;
  }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    sourceType: string;
    sourcePaymentId: string;
    transactionId: string;
    workspaceName: string;
    customerName: string | null;
    billingEmail: string | null;
    planCode: string;
    planName: string;
    billingCycle: string;
    billingCycleLabel: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    provider: string;
    approvalCode: string | null;
    status: string;
    paidAt: string;
    periodStart: string;
    periodEnd: string;
    issuedAt: string;
  }>;
  lifecycleEvents: Array<{
    id: string;
    event_type: string;
    plan_code: string | null;
    previous_status: string | null;
    new_status: string | null;
    effective_at: string | null;
    actor_member_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
  adminAudit: Array<{
    id: string;
    admin_email: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
};

type BillingSummary = {
  workspaces: number;
  managed: number;
  legacy: number;
  active: number;
  trialing: number;
  expired: number;
  suspended: number;
  pastDue: number;
  pendingManual: number;
  paidInvoices: number;
};

type ListResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  summary?: BillingSummary;
  workspaces?: WorkspaceRow[];
};

type DetailResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  detail?: WorkspaceDetail;
};


function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "KHR" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function planLabel(value: string | null | undefined) {
  if (!value) return "Unmanaged";
  return PLAN_LABELS[value] ?? value;
}

function cycleLabel(value: string | null | undefined) {
  if (!value) return "—";
  return CYCLE_LABELS[value] ?? value;
}

function statusClasses(status: string | null, managed = true) {
  if (!managed) return "bg-slate-100 text-slate-600";

  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700";
    case "trialing":
      return "bg-blue-100 text-blue-700";
    case "expired":
      return "bg-amber-100 text-amber-700";
    case "past_due":
      return "bg-orange-100 text-orange-700";
    case "suspended":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function statusLabel(status: string | null, managed = true) {
  if (!managed) return "Legacy / unmanaged";
  if (!status) return "Unknown";
  return status.replaceAll("_", " ");
}

function compactStatusClasses(status: string | null, managed = true) {
  if (!managed) return "bg-slate-100 text-slate-600";

  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700";
    case "trialing":
      return "bg-blue-100 text-blue-700";
    case "expired":
      return "bg-slate-100 text-slate-600";
    case "past_due":
      return "bg-orange-100 text-orange-700";
    case "suspended":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function compactPlanLabel(value: string | null | undefined, managed = true) {
  if (!managed) return "Legacy";
  const label = planLabel(value);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatCreatedCompact(value: string | null | undefined) {
  if (!value) return "created —";

  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "created —";

  const diffMs = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `created ${Math.max(1, minutes)}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `created ${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `created ${days}d ago`;

  return `created ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date)}`;
}

function Section({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div>
        <h3 className="text-lg font-bold text-slate-950">{title}</h3>
        {helper ? (
          <p className="mt-1 text-sm text-slate-500">{helper}</p>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function KeyValue({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
        {label}
      </p>
      <div className="mt-1 break-words text-sm font-semibold text-slate-800">
        {value}
      </div>
    </div>
  );
}

export function AdminBillingManagement() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailPaymentFilter, setDetailPaymentFilter] = useState<
    "all" | "review" | "payway"
  >("all");

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (status !== "all" && status !== "needs_review") {
        params.set("status", status);
      }

      const response = await fetch(
        `/api/tenh-admin/billing${params.size ? `?${params.toString()}` : ""}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as ListResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.details
            ? `${result.error ?? "Unable to load billing."} ${result.details}`
            : result.error ?? "Unable to load TENH billing management.",
        );
      }

      setSummary(result.summary ?? null);
      setWorkspaces(result.workspaces ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load TENH billing management.",
      );
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  const loadDetail = useCallback(async (businessId: string) => {
    setSelectedBusinessId(businessId);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    setDetailPaymentFilter("all");

    try {
      const response = await fetch(
        `/api/tenh-admin/billing?businessId=${encodeURIComponent(businessId)}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as DetailResponse;

      if (!response.ok || !result.success || !result.detail) {
        throw new Error(
          result.details
            ? `${result.error ?? "Unable to load workspace billing."} ${result.details}`
            : result.error ?? "Unable to load workspace billing.",
        );
      }

      setDetail(result.detail);
    } catch (loadError) {
      setDetail(null);
      setDetailError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workspace billing.",
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const selectedRow = useMemo(
    () =>
      selectedBusinessId
        ? workspaces.find(
            (workspace) => workspace.businessId === selectedBusinessId,
          ) ?? null
        : null,
    [selectedBusinessId, workspaces],
  );

  const visibleWorkspaces = useMemo(() => {
    if (status === "needs_review") {
      return workspaces.filter((workspace) => workspace.pendingManual > 0);
    }
    return workspaces;
  }, [status, workspaces]);

  const pageCount = Math.max(
    1,
    Math.ceil(visibleWorkspaces.length / PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);

  const paginatedWorkspaces = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return visibleWorkspaces.slice(start, start + PAGE_SIZE);
  }, [currentPage, visibleWorkspaces]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  useEffect(() => {
    if (!selectedBusinessId) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedBusinessId(null);
        setDetail(null);
        setDetailError(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedBusinessId]);

  function closeDetail() {
    setSelectedBusinessId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
    setSelectedBusinessId(null);
    setDetail(null);
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setStatus("all");
    setPage(1);
    setSelectedBusinessId(null);
    setDetail(null);
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Admin
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">
                Billing management
              </h2>
            </div>

            <button
              type="button"
              onClick={() => void loadList()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <span aria-hidden="true">↻</span>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <form onSubmit={submitSearch} className="mt-4">
            <div className="relative">
              <span
                className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-slate-400"
                aria-hidden="true"
              >
                ⌕
              </span>
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Workspace, email, invoice or transaction ID"
                maxLength={120}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              />
              {searchInput || search ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute inset-y-0 right-2 flex items-center px-2 text-sm font-semibold text-slate-400 transition hover:text-slate-700"
                  aria-label="Clear billing search"
                >
                  ×
                </button>
              ) : (
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                    /
                  </kbd>
                </span>
              )}
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {[
              ["all", "All", summary?.workspaces ?? workspaces.length],
              ["active", "Active", summary?.active ?? 0],
              ["trialing", "Trialing", summary?.trialing ?? 0],
              ["expired", "Expired", summary?.expired ?? 0],
              ["needs_review", "Needs review", summary?.pendingManual ?? 0],
            ].map(([value, label, count]) => {
              const active = status === value;
              const needsReview = value === "needs_review";
              return (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => {
                    setStatus(String(value));
                    setPage(1);
                    setSelectedBusinessId(null);
                    setDetail(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? needsReview
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-200 text-slate-900"
                      : needsReview
                        ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                        : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {needsReview ? <span aria-hidden="true">⚠</span> : null}
                  <span>{String(label)}</span>
                  <span className="font-bold">{Number(count)}</span>
                </button>
              );
            })}

            <select
              value={
                ["past_due", "suspended", "legacy"].includes(status)
                  ? status
                  : ""
              }
              onChange={(event) => {
                if (!event.target.value) return;
                setStatus(event.target.value);
                setPage(1);
                setSelectedBusinessId(null);
                setDetail(null);
              }}
              className="ml-auto rounded-lg border border-transparent bg-white px-2 py-1.5 text-xs font-medium text-slate-500 outline-none transition hover:bg-slate-50 focus:border-slate-200"
              aria-label="More billing status filters"
            >
              <option value="">More</option>
              <option value="past_due">Past due {summary?.pastDue ?? 0}</option>
              <option value="suspended">Suspended {summary?.suspended ?? 0}</option>
              <option value="legacy">Legacy {summary?.legacy ?? 0}</option>
            </select>
          </div>
        </div>

        {error ? (
          <div className="mx-5 mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
            {error}
          </div>
        ) : null}

        <div className="border-t border-slate-100 px-5 pb-5 pt-3 sm:px-6">
          <div className="mb-2 flex items-center justify-between gap-4 px-1 text-xs text-slate-500">
            <span className="font-medium">
              {status === "needs_review"
                ? `${visibleWorkspaces.length} workspace${visibleWorkspaces.length === 1 ? "" : "s"} needing review`
                : search
                  ? `${visibleWorkspaces.length} matching workspace${visibleWorkspaces.length === 1 ? "" : "s"}`
                  : `${summary?.workspaces ?? visibleWorkspaces.length} workspaces`}
            </span>
            <span className="font-medium">Newest first⌄</span>
          </div>

          {loading ? (
            <EmptyState>Loading billing workspaces...</EmptyState>
          ) : visibleWorkspaces.length === 0 ? (
            <EmptyState>No workspace matches this billing view.</EmptyState>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {paginatedWorkspaces.map((workspace, index) => {
                  const selected = selectedBusinessId === workspace.businessId;
                  const owner =
                    workspace.ownerEmail ??
                    workspace.ownerName ??
                    "No active owner found";

                  return (
                    <button
                      key={workspace.businessId}
                      type="button"
                      onClick={() => void loadDetail(workspace.businessId)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_86px_86px_24px] items-center gap-3 px-3 py-3 text-left transition sm:grid-cols-[minmax(0,1fr)_120px_110px_28px] sm:px-4 ${
                        index > 0 ? "border-t border-slate-100" : ""
                      } ${
                        selected
                          ? "bg-blue-50/50"
                          : "bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-bold text-slate-950">
                            {workspace.businessName}
                          </span>
                          {workspace.pendingManual > 0 ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              <span aria-hidden="true">⚠</span>
                              {workspace.pendingManual} review waiting
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 sm:text-xs">
                          {owner} · {formatCreatedCompact(workspace.createdAt)}
                        </p>
                      </div>

                      <div className="truncate text-xs font-medium text-slate-600 sm:text-sm">
                        {compactPlanLabel(workspace.planCode, workspace.managed)}
                      </div>

                      <div>
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold capitalize sm:text-xs ${compactStatusClasses(
                            workspace.status,
                            workspace.managed,
                          )}`}
                        >
                          {statusLabel(workspace.status, workspace.managed)}
                        </span>
                      </div>

                      <span
                        className="text-right text-xl leading-none text-slate-400"
                        aria-hidden="true"
                      >
                        {selected && detailLoading ? "…" : "›"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center justify-between px-1 text-xs text-slate-500">
                <span>
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(
                    currentPage * PAGE_SIZE,
                    visibleWorkspaces.length,
                  )} of {
                    status === "all" && !search
                      ? summary?.workspaces ?? visibleWorkspaces.length
                      : visibleWorkspaces.length
                  }
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPage((value) => Math.max(1, value - 1))
                    }
                    disabled={currentPage === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-base text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="Previous billing page"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPage((value) => Math.min(pageCount, value + 1))
                    }
                    disabled={currentPage === pageCount}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-base text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="Next billing page"
                  >
                    ›
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {selectedBusinessId ? (
        <div
          className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="TENH workspace billing details"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDetail();
            }
          }}
        >
          <div
            id="tenh-admin-billing-detail"
            className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-2xl"
          >
            {detailLoading ? (
              <div className="p-5 sm:p-6">
                <EmptyState>Loading workspace billing details...</EmptyState>
              </div>
            ) : detailError ? (
              <div className="p-5 sm:p-6">
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {detailError}
                </div>
              </div>
            ) : detail ? (
              (() => {
                const subscription = detail.subscription;
                const periodStart = subscription?.current_period_start ?? null;
                const periodEnd = subscription
                  ? subscription.status === "trialing"
                    ? subscription.trial_ends_at
                    : subscription.current_period_end
                  : null;

                const startMs = periodStart ? new Date(periodStart).getTime() : NaN;
                const endMs = periodEnd ? new Date(periodEnd).getTime() : NaN;
                const nowMs = Date.now();
                const periodProgress =
                  Number.isFinite(startMs) &&
                  Number.isFinite(endMs) &&
                  endMs > startMs
                    ? Math.max(
                        0,
                        Math.min(
                          100,
                          ((nowMs - startMs) / (endMs - startMs)) * 100,
                        ),
                      )
                    : 0;
                const daysLeft = Number.isFinite(endMs)
                  ? Math.max(0, Math.ceil((endMs - nowMs) / 86_400_000))
                  : null;
                const periodHeadline =
                  daysLeft === null
                    ? "No managed billing period"
                    : daysLeft <= 0
                      ? "Period ended"
                      : daysLeft >= 60
                        ? `Renews in ${Math.max(1, Math.ceil(daysLeft / 30))} months`
                        : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;

                const memberLimit = Number(subscription?.member_limit ?? 0);
                const channelLimit = Number(subscription?.channel_limit ?? 0);
                const memberProgress = memberLimit > 0
                  ? Math.min(100, (detail.usage.activeMembers / memberLimit) * 100)
                  : 0;
                const channelProgress = channelLimit > 0
                  ? Math.min(100, (detail.usage.activeChannels / channelLimit) * 100)
                  : 0;

                const submittedManual = detail.manualPayments.filter(
                  (payment) => payment.status === "submitted",
                );
                const pendingManualAmount = submittedManual.reduce(
                  (sum, payment) => sum + Number(payment.amount || 0),
                  0,
                );
                const pendingCurrency = submittedManual[0]?.currency ?? "USD";

                const payments = [
                  ...detail.manualPayments.map((payment) => ({
                    key: `manual-${payment.id}`,
                    kind: "manual" as const,
                    id: payment.id,
                    amount: payment.amount,
                    currency: payment.currency,
                    planCode: payment.planCode,
                    billingCycle: payment.billingCycle,
                    status: payment.status,
                    providerStatus: null as string | null,
                    transactionId: `MAN-${payment.id.slice(0, 8).toUpperCase()}`,
                    date:
                      payment.approvedAt ??
                      payment.reviewedAt ??
                      payment.createdAt,
                  })),
                  ...detail.payWayTransactions.map((payment) => ({
                    key: `payway-${payment.id}`,
                    kind: "payway" as const,
                    id: payment.id,
                    amount: payment.amount,
                    currency: payment.currency,
                    planCode: payment.planCode,
                    billingCycle: payment.billingCycle,
                    status: payment.status,
                    providerStatus: payment.providerStatus,
                    transactionId: payment.transactionId,
                    date: payment.verifiedAt ?? payment.createdAt,
                  })),
                ].sort(
                  (a, b) =>
                    new Date(b.date).getTime() - new Date(a.date).getTime(),
                );

                const filteredPayments = payments.filter((payment) => {
                  if (detailPaymentFilter === "review") {
                    return payment.kind === "manual" && payment.status === "submitted";
                  }
                  if (detailPaymentFilter === "payway") {
                    return payment.kind === "payway";
                  }
                  return true;
                });

                const activity = [
                  ...detail.lifecycleEvents.map((event) => ({
                    key: `life-${event.id}`,
                    title:
                      event.event_type === "reactivated"
                        ? `Renewed to ${planLabel(event.plan_code)}`
                        : event.event_type.replaceAll("_", " "),
                    subtitle: `${event.previous_status ?? "—"} → ${event.new_status ?? "—"}${
                      event.plan_code ? ` · ${planLabel(event.plan_code)}` : ""
                    }`,
                    createdAt: event.created_at,
                    tone: "normal" as const,
                  })),
                  ...detail.adminAudit.map((event) => ({
                    key: `audit-${event.id}`,
                    title: event.action.replaceAll("_", " "),
                    subtitle: `${event.admin_email} · ${event.resource_type}`,
                    createdAt: event.created_at,
                    tone: "admin" as const,
                  })),
                ].sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
                );

                return (
                  <>
                    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                          Workspace
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-xl font-bold text-slate-950">
                            {detail.business.name}
                          </h2>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusClasses(
                              subscription?.status ?? null,
                              Boolean(subscription),
                            )}`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                            {subscription
                              ? `${planLabel(subscription.plan_code)} · ${statusLabel(
                                  subscription.status,
                                )}`
                              : "Legacy / unmanaged"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-600">
                          {detail.business.ownerEmail ??
                            detail.business.ownerName ??
                            "No active owner found"}
                          <span className="text-slate-300"> · </span>
                          <span className="font-mono text-xs text-slate-500">
                            {detail.business.id.slice(0, 8)}…{detail.business.id.slice(-4)}
                          </span>
                        </p>
                      </div>

                      <div className="flex shrink-0 items-start gap-2">
                        
                        <button
                          type="button"
                          onClick={closeDetail}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                          aria-label="Close workspace details"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {submittedManual.length > 0 ? (
                        <div className="flex flex-col gap-3 border-b border-amber-300 bg-amber-100 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                          <div className="flex items-center gap-3 text-amber-950">
                            <span className="text-lg" aria-hidden="true">⚠</span>
                            <p className="text-sm font-semibold">
                              {submittedManual.length} manual payment
                              {submittedManual.length === 1 ? "" : "s"} waiting for review · {formatMoney(
                                pendingManualAmount,
                                pendingCurrency,
                              )}
                            </p>
                          </div>
                          <a
                            href="/dashboard/admin?tab=manual-payments"
                            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-semibold text-amber-950 transition hover:bg-amber-200"
                          >
                            Review payment →
                          </a>
                        </div>
                      ) : null}

                      <div className="space-y-0 px-5 py-4 sm:px-6">
                        <section className="border-b border-slate-200 pb-5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="font-medium text-slate-700">Billing period</span>
                            <span className="font-semibold text-slate-950">
                              {periodHeadline}
                              {periodEnd ? (
                                <span className="font-normal text-slate-500"> · {formatDate(periodEnd)}</span>
                              ) : null}
                            </span>
                          </div>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-slate-950 transition-all"
                              style={{ width: `${periodProgress}%` }}
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                            <span>{formatDate(periodStart)}</span>
                            <span>{daysLeft === null ? "—" : `${daysLeft} days left`}</span>
                          </div>

                          <div className="mt-5 grid gap-5 sm:grid-cols-2">
                            <div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">Members</span>
                                <span className="font-semibold text-slate-950">
                                  {detail.usage.activeMembers} / {memberLimit || "—"}
                                </span>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className="h-full rounded-full bg-slate-950"
                                  style={{ width: `${memberProgress}%` }}
                                />
                              </div>
                            </div>

                            <div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">Channels</span>
                                <span className="font-semibold text-slate-950">
                                  {detail.usage.activeChannels} / {channelLimit || "—"}
                                </span>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className="h-full rounded-full bg-slate-950"
                                  style={{ width: `${channelProgress}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </section>

                        <section className="border-b border-slate-200 py-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <h3 className="text-base font-bold text-slate-950">Payments</h3>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              {([
                                ["all", `All ${payments.length}`],
                                ["review", `Needs review ${submittedManual.length}`],
                                ["payway", `PayWay ${detail.payWayTransactions.length}`],
                              ] as const).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => setDetailPaymentFilter(value)}
                                  className={`rounded-full px-3 py-1.5 font-medium transition ${
                                    detailPaymentFilter === value
                                      ? "bg-slate-950 text-white"
                                      : "text-slate-600 hover:bg-slate-100"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                            {filteredPayments.length === 0 ? (
                              <div className="px-4 py-7 text-center text-sm text-slate-500">
                                No payment record in this view.
                              </div>
                            ) : (
                              filteredPayments.map((payment, index) => {
                                const invoice = detail.invoices.find(
                                  (item) =>
                                    item.sourcePaymentId === payment.id ||
                                    item.transactionId === payment.transactionId,
                                );
                                const isPaid =
                                  payment.status === "approved" ||
                                  payment.providerStatus === "APPROVED";
                                const isSubmitted =
                                  payment.kind === "manual" &&
                                  payment.status === "submitted";

                                return (
                                  <div
                                    key={payment.key}
                                    className={`grid gap-2 px-4 py-3 sm:grid-cols-[110px_1fr_auto_auto] sm:items-center ${
                                      index > 0 ? "border-t border-slate-200" : ""
                                    }`}
                                  >
                                    <p className="font-bold text-slate-950">
                                      {formatMoney(payment.amount, payment.currency)}
                                    </p>
                                    <div className="min-w-0">
                                      <p className="truncate text-sm text-slate-700">
                                        {planLabel(payment.planCode)} · {cycleLabel(payment.billingCycle)} · {payment.kind === "payway" ? "ABA PayWay" : "manual KHQR"}
                                      </p>
                                      <p className="truncate font-mono text-[11px] text-slate-400">
                                        {invoice?.invoiceNumber
                                          ? `${invoice.invoiceNumber} · `
                                          : ""}
                                        {payment.transactionId}
                                      </p>
                                    </div>
                                    <span
                                      className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
                                        isPaid
                                          ? "bg-emerald-100 text-emerald-700"
                                          : isSubmitted
                                            ? "bg-amber-100 text-amber-700"
                                            : "bg-slate-100 text-slate-600"
                                      }`}
                                    >
                                      {isPaid ? "Paid" : isSubmitted ? "Submitted" : payment.status}
                                    </span>
                                    <span className="text-xs text-slate-500 sm:text-right">
                                      {formatDate(payment.date)}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          <p className="mt-2 text-xs text-slate-500">
                            Receipts can’t be edited. PayWay approval still comes only from verified PayWay status, and manual payments still use the protected review flow.
                          </p>
                        </section>

                        <section className="border-b border-slate-200 py-5">
                          <h3 className="text-base font-bold text-slate-950">Activity</h3>
                          {activity.length === 0 ? (
                            <p className="mt-3 text-sm text-slate-500">
                              No billing or admin activity recorded yet.
                            </p>
                          ) : (
                            <div className="mt-3 space-y-4">
                              {activity.slice(0, 8).map((event) => (
                                <div
                                  key={event.key}
                                  className="grid grid-cols-[10px_1fr_auto] items-start gap-3"
                                >
                                  <span className={`mt-2 h-2 w-2 rounded-full ${event.tone === "admin" ? "bg-blue-500" : "bg-slate-950"}`} />
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold capitalize text-slate-950">
                                      {event.title}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                      {event.subtitle}
                                    </p>
                                  </div>
                                  <span className="text-xs text-slate-500">
                                    {formatDate(event.createdAt)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>

                        <details className="group py-5">
                          <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50">
                            <span>
                              <span className="font-semibold text-slate-950">Capacity detail</span>
                              <span className="text-slate-500"> — {detail.usage.activeMembers} member{detail.usage.activeMembers === 1 ? "" : "s"}, {detail.usage.activeChannels === 0 ? "no" : detail.usage.activeChannels} channel{detail.usage.activeChannels === 1 ? "" : "s"} connected</span>
                            </span>
                            <span className="text-lg text-slate-400 transition group-open:rotate-180">⌄</span>
                          </summary>

                          <div className="mt-4 space-y-5 rounded-xl bg-slate-50 p-4">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <KeyValue label="Workspace ID" value={<span className="font-mono text-xs">{detail.business.id}</span>} />
                              <KeyValue label="Workspace created" value={formatDate(detail.business.createdAt)} />
                              <KeyValue label="Payment provider" value={subscription?.payment_provider ?? "—"} />
                              <KeyValue label="Paid receipts" value={`${detail.invoices.length}`} />
                            </div>

                            <div className="grid gap-5 lg:grid-cols-2">
                              <div>
                                <p className="mb-2 text-sm font-bold text-slate-800">Team members</p>
                                <div className="space-y-2">
                                  {detail.members.map((member) => (
                                    <div key={member.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5 text-sm">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800">{member.fullName ?? member.email ?? "Team member"}</p>
                                        <p className="truncate text-xs text-slate-400">{member.email ?? "No email"} · {member.role}</p>
                                      </div>
                                      <span className={member.active ? "text-emerald-600" : "text-slate-400"}>{member.active ? "Active" : "Inactive"}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <p className="mb-2 text-sm font-bold text-slate-800">Social connections</p>
                                {detail.channels.length === 0 ? (
                                  <div className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500">No social connection saved.</div>
                                ) : (
                                  <div className="space-y-2">
                                    {detail.channels.map((channel) => {
                                      const platformLabel =
                                        channel.platform === "facebook"
                                          ? "Facebook"
                                          : channel.platform === "telegram"
                                            ? "Telegram"
                                            : channel.platform.charAt(0).toUpperCase() + channel.platform.slice(1);
                                      const fallbackName =
                                        channel.platform === "facebook"
                                          ? "Facebook Page"
                                          : channel.platform === "telegram"
                                            ? "Telegram Bot"
                                            : "Customer channel";
                                      const channelName = channel.accountName?.trim() || fallbackName;

                                      return (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5 text-sm">
                                          <div className="min-w-0">
                                            <p className="truncate font-semibold text-slate-800">{channelName}</p>
                                            <p className="truncate text-xs text-slate-400">
                                              {platformLabel} · <span className="font-mono text-[10px]">{channel.platformAccountId ?? channel.id}</span>
                                            </p>
                                          </div>
                                          <span className={channel.active ? "text-emerald-600" : "text-slate-400"}>{channel.active ? "Active" : "Inactive"}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>

                            {detail.invoices.length > 0 ? (
                              <div>
                                <p className="mb-2 text-sm font-bold text-slate-800">Receipt records</p>
                                <div className="space-y-2">
                                  {detail.invoices.map((invoice) => (
                                    <div key={invoice.id} className="flex flex-col gap-1 rounded-xl bg-white px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                                      <div>
                                        <p className="font-semibold text-slate-800">{invoice.invoiceNumber} · {invoice.planName}</p>
                                        <p className="text-xs text-slate-400">{invoice.paymentMethod} · {invoice.transactionId}</p>
                                      </div>
                                      <div className="text-left sm:text-right">
                                        <p className="font-semibold text-slate-800">{formatMoney(invoice.amount, invoice.currency)}</p>
                                        <p className="text-xs text-slate-400">{formatDate(invoice.paidAt)}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    </div>
                  </>
                );
              })()
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
