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
  pendingPlanCode: string | null;
  pendingBillingCycle: string | null;
  pendingEffectiveAt: string | null;
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

type ListResponse = {
  success?: boolean;
  error?: string;
  details?: string;
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
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (status !== "all") params.set("status", status);

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
    setDetailLoading(true);
    setDetailError(null);

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

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setSelectedBusinessId(null);
    setDetail(null);
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setStatus("all");
    setSelectedBusinessId(null);
    setDetail(null);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-950">
              Billing management
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Search TENH workspaces and inspect current subscription state,
              capacity, payments, paid receipts, lifecycle events, and admin
              billing history. This screen is read-only; payment approval stays
              in Manual payment review.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadList()}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh billing"}
          </button>
        </div>

        <form
          onSubmit={submitSearch}
          className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto]"
        >
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Workspace, owner email, invoice, transaction ID, UUID..."
            maxLength={120}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />

          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setSelectedBusinessId(null);
              setDetail(null);
            }}
            className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          >
            <option value="all">All states</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="expired">Expired</option>
            <option value="past_due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="legacy">Legacy / unmanaged</option>
          </select>

          <button
            type="submit"
            className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            Search
          </button>

          <button
            type="button"
            onClick={clearSearch}
            className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Clear
          </button>
        </form>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Section
        title="Workspaces"
        helper={
          search
            ? `Showing matches for “${search}”.`
            : "Newest TENH workspaces. Search to locate an older workspace or payment."
        }
      >
        {loading ? (
          <EmptyState>Loading billing workspaces...</EmptyState>
        ) : workspaces.length === 0 ? (
          <EmptyState>No workspace matches this billing search.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-[1120px] w-full border-collapse text-left">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Usage</th>
                  <th className="px-4 py-3">Period end</th>
                  <th className="px-4 py-3">Billing</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {workspaces.map((workspace) => {
                  const selected = selectedBusinessId === workspace.businessId;

                  return (
                    <tr
                      key={workspace.businessId}
                      className={selected ? "bg-blue-50/60" : "hover:bg-slate-50/70"}
                    >
                      <td className="px-4 py-4 align-top">
                        <p className="font-bold text-slate-900">
                          {workspace.businessName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {workspace.ownerEmail ?? workspace.ownerName ?? "No active owner found"}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-slate-400">
                          {workspace.businessId}
                        </p>
                      </td>
                      <td className="px-4 py-4 align-top text-sm font-semibold text-slate-800">
                        {planLabel(workspace.planCode)}
                        {workspace.pendingPlanCode ? (
                          <p className="mt-1 text-xs font-medium text-violet-700">
                            Next: {planLabel(workspace.pendingPlanCode)} · {cycleLabel(workspace.pendingBillingCycle)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusClasses(
                            workspace.status,
                            workspace.managed,
                          )}`}
                        >
                          {statusLabel(workspace.status, workspace.managed)}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top text-sm text-slate-700">
                        <p>
                          {workspace.activeMembers}
                          {workspace.memberLimit !== null
                            ? ` / ${workspace.memberLimit}`
                            : ""}{" "}
                          members
                        </p>
                        <p className="mt-1">
                          {workspace.activeChannels}
                          {workspace.channelLimit !== null
                            ? ` / ${workspace.channelLimit}`
                            : ""}{" "}
                          channels
                        </p>
                      </td>
                      <td className="px-4 py-4 align-top text-sm text-slate-600">
                        {workspace.managed
                          ? formatDate(
                              workspace.status === "trialing"
                                ? workspace.trialEndsAt
                                : workspace.currentPeriodEnd,
                            )
                          : "No managed period"}
                      </td>
                      <td className="px-4 py-4 align-top text-sm text-slate-700">
                        <p>{workspace.invoiceCount} paid receipt{workspace.invoiceCount === 1 ? "" : "s"}</p>
                        {workspace.pendingManual > 0 ? (
                          <p className="mt-1 font-semibold text-amber-700">
                            {workspace.pendingManual} manual review waiting
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-slate-400">
                            Last paid: {formatDate(workspace.lastPaidAt)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right align-top">
                        <button
                          type="button"
                          onClick={() => void loadDetail(workspace.businessId)}
                          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                        >
                          {selected && detailLoading ? "Loading..." : "View billing"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {selectedBusinessId ? (
        <div className="space-y-5" id="tenh-admin-billing-detail">
          {detailLoading ? (
            <Section title="Workspace billing">
              <EmptyState>Loading workspace billing details...</EmptyState>
            </Section>
          ) : detailError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {detailError}
            </div>
          ) : detail ? (
            <>
              <Section
                title={detail.business.name}
                helper="Global billing state visible only to the protected TENH administrator session."
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <KeyValue label="Workspace ID" value={<span className="font-mono text-xs">{detail.business.id}</span>} />
                  <KeyValue
                    label="Owner"
                    value={
                      detail.business.ownerEmail ??
                      detail.business.ownerName ??
                      "No active owner found"
                    }
                  />
                  <KeyValue
                    label="Subscription"
                    value={
                      detail.subscription ? (
                        <span className="capitalize">
                          {planLabel(detail.subscription.plan_code)} · {String(detail.subscription.status).replaceAll("_", " ")}
                        </span>
                      ) : (
                        "Legacy / unmanaged"
                      )
                    }
                  />
                  <KeyValue
                    label="Usage"
                    value={`${detail.usage.activeMembers}${
                      detail.subscription
                        ? ` / ${detail.subscription.member_limit}`
                        : ""
                    } members · ${detail.usage.activeChannels}${
                      detail.subscription
                        ? ` / ${detail.subscription.channel_limit}`
                        : ""
                    } channels`}
                  />
                  <KeyValue
                    label="Current period"
                    value={
                      detail.subscription
                        ? `${formatDate(
                            detail.subscription.current_period_start,
                          )} → ${formatDate(
                            detail.subscription.status === "trialing"
                              ? detail.subscription.trial_ends_at
                              : detail.subscription.current_period_end,
                          )}`
                        : "No managed billing period"
                    }
                  />
                  <KeyValue
                    label="Payment provider"
                    value={detail.subscription?.payment_provider ?? "—"}
                  />
                  <KeyValue
                    label="Scheduled next plan"
                    value={
                      detail.subscription?.pending_plan_code
                        ? `${planLabel(
                            detail.subscription.pending_plan_code,
                          )} · ${cycleLabel(
                            detail.subscription.pending_billing_cycle,
                          )} · effective ${formatDate(
                            detail.subscription.pending_plan_effective_at,
                          )}`
                        : "None"
                    }
                  />
                  <KeyValue
                    label="Workspace created"
                    value={formatDate(detail.business.createdAt)}
                  />
                </div>

                {selectedRow?.pendingManual ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-bold text-amber-950">
                        Manual payment waiting for review
                      </p>
                      <p className="mt-1 text-sm text-amber-800/75">
                        Approve or reject it only through the existing protected manual payment review flow.
                      </p>
                    </div>
                    <a
                      href="/dashboard/admin?tab=manual-payments"
                      className="rounded-xl bg-amber-900 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-amber-800"
                    >
                      Open manual payment review
                    </a>
                  </div>
                ) : null}
              </Section>

              <Section
                title="Paid invoices / receipts"
                helper="Immutable V3.10.4 snapshots. This admin page does not rewrite historical receipts."
              >
                {detail.invoices.length === 0 ? (
                  <EmptyState>No paid TENH receipt has been issued for this workspace.</EmptyState>
                ) : (
                  <div className="space-y-3">
                    {detail.invoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        className="rounded-2xl border border-slate-200 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold text-slate-950">
                                {invoice.invoiceNumber}
                              </p>
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-700">
                                Paid
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-slate-600">
                              {invoice.planName} · {invoice.billingCycleLabel} · {invoice.paymentMethod}
                            </p>
                            <p className="mt-1 font-mono text-[11px] text-slate-400">
                              {invoice.transactionId}
                            </p>
                          </div>
                          <p className="text-lg font-black text-slate-950">
                            {formatMoney(invoice.amount, invoice.currency)}
                          </p>
                        </div>

                        <div className="mt-4 grid gap-2 md:grid-cols-3">
                          <KeyValue label="Paid at" value={formatDate(invoice.paidAt)} />
                          <KeyValue
                            label="Coverage"
                            value={`${formatDate(invoice.periodStart)} → ${formatDate(invoice.periodEnd)}`}
                          />
                          <KeyValue
                            label="Billing email"
                            value={invoice.billingEmail ?? "—"}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <div className="grid gap-5 xl:grid-cols-2">
                <Section
                  title="PayWay transactions"
                  helper="Provider state is informational here. Admin cannot manually mark PayWay as approved from this screen."
                >
                  {detail.payWayTransactions.length === 0 ? (
                    <EmptyState>No PayWay transaction for this workspace.</EmptyState>
                  ) : (
                    <div className="space-y-3">
                      {detail.payWayTransactions.map((payment) => (
                        <div
                          key={payment.id}
                          className="rounded-2xl border border-slate-200 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-900">
                                {planLabel(payment.planCode)} · {cycleLabel(payment.billingCycle)}
                              </p>
                              <p className="mt-1 font-mono text-[11px] text-slate-400">
                                {payment.transactionId}
                              </p>
                            </div>
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold uppercase text-slate-600">
                              {payment.status}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="font-bold text-slate-900">
                              {formatMoney(payment.amount, payment.currency)}
                            </span>
                            <span className="text-slate-500">
                              {payment.providerStatus ?? "No provider status"} · {formatDate(payment.verifiedAt ?? payment.createdAt)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section
                  title="Manual payments"
                  helper="Submitted payments must still be reviewed from Manual payment review."
                >
                  {detail.manualPayments.length === 0 ? (
                    <EmptyState>No manual payment request for this workspace.</EmptyState>
                  ) : (
                    <div className="space-y-3">
                      {detail.manualPayments.map((payment) => (
                        <div
                          key={payment.id}
                          className="rounded-2xl border border-slate-200 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-900">
                                {planLabel(payment.planCode)} · {cycleLabel(payment.billingCycle)}
                              </p>
                              <p className="mt-1 font-mono text-[11px] text-slate-400">
                                MAN-{payment.id.slice(0, 8).toUpperCase()}
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${
                                payment.status === "approved"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : payment.status === "submitted"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {payment.status}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="font-bold text-slate-900">
                              {formatMoney(payment.amount, payment.currency)}
                            </span>
                            <span className="text-slate-500">
                              {formatDate(payment.approvedAt ?? payment.reviewedAt ?? payment.createdAt)}
                            </span>
                          </div>
                          {payment.reviewNote ? (
                            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                              Review note: {payment.reviewNote}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <Section
                  title="Subscription lifecycle"
                  helper="Prepaid expiry / renewal history. Historical cancellation experiment events can still appear if they were recorded before V3.10.3 was replaced."
                >
                  {detail.lifecycleEvents.length === 0 ? (
                    <EmptyState>No subscription lifecycle event has been recorded yet.</EmptyState>
                  ) : (
                    <div className="space-y-3">
                      {detail.lifecycleEvents.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold capitalize text-slate-900">
                              {event.event_type.replaceAll("_", " ")}
                            </p>
                            <p className="text-xs text-slate-400">
                              {formatDate(event.created_at)}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {event.previous_status ?? "—"} → {event.new_status ?? "—"}
                            {event.plan_code ? ` · ${planLabel(event.plan_code)}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section
                  title="Admin billing audit"
                  helper="Sensitive TENH admin actions associated with this workspace."
                >
                  {detail.adminAudit.length === 0 ? (
                    <EmptyState>No matching admin billing action has been logged for this workspace.</EmptyState>
                  ) : (
                    <div className="space-y-3">
                      {detail.adminAudit.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-slate-900">
                              {event.action.replaceAll("_", " ")}
                            </p>
                            <p className="text-xs text-slate-400">
                              {formatDate(event.created_at)}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {event.admin_email} · {event.resource_type}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>

              <Section
                title="Workspace capacity context"
                helper="Read-only context for understanding downgrade/payment blocks. Deactivate members or disconnect channels through normal workspace management, not from billing admin."
              >
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <p className="mb-3 text-sm font-bold text-slate-800">
                      Team members
                    </p>
                    <div className="space-y-2">
                      {detail.members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">
                              {member.fullName ?? member.email ?? "Team member"}
                            </p>
                            <p className="truncate text-xs text-slate-400">
                              {member.email ?? "No email"} · {member.role}
                            </p>
                          </div>
                          <span className={member.active ? "text-emerald-600" : "text-slate-400"}>
                            {member.active ? "Active" : "Inactive"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 text-sm font-bold text-slate-800">
                      Social connections
                    </p>
                    {detail.channels.length === 0 ? (
                      <EmptyState>No social connection saved.</EmptyState>
                    ) : (
                      <div className="space-y-2">
                        {detail.channels.map((channel) => (
                          <div
                            key={channel.id}
                            className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold capitalize text-slate-800">
                                {channel.platform}
                              </p>
                              <p className="truncate font-mono text-[10px] text-slate-400">
                                {channel.platformAccountId ?? channel.id}
                              </p>
                            </div>
                            <span className={channel.active ? "text-emerald-600" : "text-slate-400"}>
                              {channel.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Section>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
