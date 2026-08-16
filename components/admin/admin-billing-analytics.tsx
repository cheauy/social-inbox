"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type RangeKey = "30d" | "90d" | "12m" | "all";

type MoneyValue = {
  currency: string;
  amount: number;
};

type BreakdownRow = {
  key: string;
  label: string;
  invoiceCount: number;
  workspaceCount: number;
  revenue: MoneyValue[];
};

type TrendRow = {
  key: string;
  label: string;
  invoices: number;
  revenue: MoneyValue[];
};

type AnalyticsResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  range?: RangeKey;
  generatedAt?: string;
  period?: {
    start: string | null;
    end: string;
    previousStart: string | null;
    previousEnd: string | null;
  };
  revenue?: {
    totals: MoneyValue[];
    comparison: Array<{
      currency: string;
      current: number;
      previous: number;
      deltaPercent: number | null;
    }>;
  };
  metrics?: {
    paidInvoices: number;
    paidWorkspaces: number;
    newPaidWorkspaces: number;
    renewals: number;
    managed: number;
    activePaid: number;
    trialing: number;
    expired: number;
    pastDue: number;
    suspended: number;
    scheduledDowngrades: number;
    planDistribution: Array<{
      planCode: string;
      count: number;
    }>;
    upcomingExpiry: {
      within24h: number;
      within3d: number;
      within7d: number;
      within14d: number;
    };
  };
  breakdowns?: {
    plans: BreakdownRow[];
    billingCycles: BreakdownRow[];
    providers: BreakdownRow[];
  };
  trend?: TrendRow[];
  recentPaidActivity?: Array<{
    invoiceId: string;
    invoiceNumber: string;
    businessId: string;
    businessName: string;
    planCode: string;
    planName: string;
    billingCycle: string;
    billingCycleLabel: string;
    amount: number;
    currency: string;
    provider: string;
    paymentMethod: string;
    paidAt: string;
    periodStart: string;
    periodEnd: string;
  }>;
};

const RANGE_OPTIONS: Array<{
  value: RangeKey;
  label: string;
}> = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
  { value: "all", label: "All time" },
];

const PLAN_LABELS: Record<string, string> = {
  mini: "Mini",
  standard: "Standard",
  pro: "Pro",
};

function money(amount: number, currency: string) {
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

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function currencyAmount(values: MoneyValue[], currency: string) {
  return values.find((value) => value.currency === currency)?.amount ?? 0;
}

function allCurrencies(data: AnalyticsResponse | null) {
  return Array.from(
    new Set(
      [
        ...(data?.revenue?.totals ?? []).map((item) => item.currency),
        ...(data?.trend ?? []).flatMap((item) =>
          item.revenue.map((value) => value.currency),
        ),
      ].filter(Boolean),
    ),
  ).sort();
}

function Card({
  label,
  value,
  helper,
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <div className="mt-2 text-2xl font-black tracking-tight text-slate-950">
        {value}
      </div>
      {helper ? (
        <div className="mt-1 text-xs leading-5 text-slate-500">{helper}</div>
      ) : null}
    </div>
  );
}

function Panel({
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
          <p className="mt-1 text-sm leading-6 text-slate-500">{helper}</p>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function RevenueText({ values }: { values: MoneyValue[] }) {
  if (values.length === 0) return <span>—</span>;

  return (
    <div className="space-y-1">
      {values.map((value) => (
        <p key={value.currency}>{money(value.amount, value.currency)}</p>
      ))}
    </div>
  );
}

function deltaText(
  comparison:
    | {
        currency: string;
        current: number;
        previous: number;
        deltaPercent: number | null;
      }
    | undefined,
) {
  if (!comparison) return null;
  if (comparison.deltaPercent === null) {
    return comparison.current > 0 ? "New revenue vs previous period" : null;
  }

  const prefix = comparison.deltaPercent > 0 ? "+" : "";
  return `${prefix}${comparison.deltaPercent.toFixed(1)}% vs previous period`;
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
        No paid billing activity in this period.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full min-w-[580px] border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
          <tr>
            <th className="px-4 py-3">Segment</th>
            <th className="px-4 py-3">Invoices</th>
            <th className="px-4 py-3">Workspaces</th>
            <th className="px-4 py-3 text-right">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-4 py-3 font-semibold text-slate-900">
                {row.label}
              </td>
              <td className="px-4 py-3 text-slate-600">{row.invoiceCount}</td>
              <td className="px-4 py-3 text-slate-600">{row.workspaceCount}</td>
              <td className="px-4 py-3 text-right font-bold text-slate-900">
                <RevenueText values={row.revenue} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevenueTrend({
  trend,
  currency,
}: {
  trend: TrendRow[];
  currency: string;
}) {
  const values = trend.map((item) => currencyAmount(item.revenue, currency));
  const max = Math.max(0, ...values);

  if (trend.length === 0 || max <= 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
        No {currency} revenue trend for this period.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-800">{currency} revenue</p>
        <p className="text-xs text-slate-400">Cambodia time buckets</p>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          {trend.map((item) => {
            const amount = currencyAmount(item.revenue, currency);
            const height = amount > 0 ? Math.max(8, (amount / max) * 140) : 3;

            return (
              <div
                key={`${currency}-${item.key}`}
                className="flex w-12 shrink-0 flex-col items-center justify-end gap-2"
                title={`${item.label}: ${money(amount, currency)} · ${item.invoices} invoice(s)`}
              >
                <div className="flex h-36 w-full items-end justify-center">
                  <div
                    className="w-7 rounded-t-md bg-blue-600"
                    style={{ height: `${height}px` }}
                  />
                </div>
                <span className="w-12 truncate text-center text-[10px] font-medium text-slate-500">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AdminBillingAnalytics() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/tenh-admin/billing/analytics?range=${encodeURIComponent(range)}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as AnalyticsResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.details
            ? `${result.error ?? "Unable to load analytics."} ${result.details}`
            : result.error ?? "Unable to load TENH billing analytics.",
        );
      }

      setData(result);
    } catch (loadError) {
      setData(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load TENH billing analytics.",
      );
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const currencies = useMemo(() => allCurrencies(data), [data]);
  const metrics = data?.metrics;
  const comparison = data?.revenue?.comparison ?? [];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950 p-5 text-white shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">
              V3.10.9 · Admin overview
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
              Revenue & subscription health
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Revenue uses immutable paid TENH invoices while subscription health uses
              the current managed subscription table. This overview is read-only; use
              the dedicated admin tabs for billing review and operational actions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                  range === option.value
                    ? "bg-white text-slate-950"
                    : "bg-white/10 text-slate-200 hover:bg-white/15"
                }`}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-5 text-xs text-slate-400">
          {data?.period?.start
            ? `${dateLabel(data.period.start)} → ${dateLabel(data.period.end)}`
            : "All paid invoice history"}
          {data?.generatedAt ? ` · Updated ${dateTimeLabel(data.generatedAt)}` : ""}
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Loading billing analytics...
        </div>
      ) : data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(data.revenue?.totals ?? []).length > 0 ? (
              data.revenue?.totals.map((item) => {
                const comparisonItem = comparison.find(
                  (row) => row.currency === item.currency,
                );

                return (
                  <Card
                    key={item.currency}
                    label={`${item.currency} paid revenue`}
                    value={money(item.amount, item.currency)}
                    helper={
                      range === "all"
                        ? "All immutable paid receipts"
                        : deltaText(comparisonItem) ?? "No prior-period comparison"
                    }
                  />
                );
              })
            ) : (
              <Card
                label="Paid revenue"
                value="—"
                helper="No paid receipt in this period"
              />
            )}

            <Card
              label="Paid invoices"
              value={metrics?.paidInvoices ?? 0}
              helper={`${metrics?.paidWorkspaces ?? 0} paying workspace${
                (metrics?.paidWorkspaces ?? 0) === 1 ? "" : "s"
              }`}
            />
            <Card
              label="New paid workspaces"
              value={metrics?.newPaidWorkspaces ?? 0}
              helper="First-ever paid TENH invoice landed in this period"
            />
            <Card
              label="Renewals"
              value={metrics?.renewals ?? 0}
              helper="Expired / past-due subscription renewed through approved payment"
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Card
              label="Active paid"
              value={metrics?.activePaid ?? 0}
              helper="Mini / Standard / Pro currently active"
            />
            <Card
              label="Trials"
              value={metrics?.trialing ?? 0}
              helper="Managed workspaces still trialing"
            />
            <Card
              label="Expired"
              value={metrics?.expired ?? 0}
              helper="Prepaid period or trial ended"
            />
            <Card
              label="Past due"
              value={metrics?.pastDue ?? 0}
              helper="Managed subscriptions needing attention"
            />
            <Card
              label="Suspended"
              value={metrics?.suspended ?? 0}
              helper="Billing access intentionally suspended"
            />
            <Card
              label="Scheduled downgrades"
              value={metrics?.scheduledDowngrades ?? 0}
              helper="Saved next-plan preferences; payment still required"
            />
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
            <Panel
              title="Revenue trend"
              helper="Paid receipt revenue only. USD and KHR are never mixed into one total."
            >
              <div className="space-y-6">
                {currencies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    No paid revenue in this period.
                  </div>
                ) : (
                  currencies.map((currency) => (
                    <RevenueTrend
                      key={currency}
                      trend={data.trend ?? []}
                      currency={currency}
                    />
                  ))
                )}
              </div>
            </Panel>

            <Panel
              title="Upcoming paid expiries"
              helper="Cumulative active-paid workspaces whose current period ends within each window."
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl bg-red-50 p-4">
                  <p className="text-xs font-bold uppercase text-red-500">Within 24 hours</p>
                  <p className="mt-2 text-3xl font-black text-red-900">
                    {metrics?.upcomingExpiry.within24h ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4">
                  <p className="text-xs font-bold uppercase text-amber-600">Within 3 days</p>
                  <p className="mt-2 text-3xl font-black text-amber-900">
                    {metrics?.upcomingExpiry.within3d ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl bg-blue-50 p-4">
                  <p className="text-xs font-bold uppercase text-blue-600">Within 7 days</p>
                  <p className="mt-2 text-3xl font-black text-blue-900">
                    {metrics?.upcomingExpiry.within7d ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-bold uppercase text-slate-500">Within 14 days</p>
                  <p className="mt-2 text-3xl font-black text-slate-900">
                    {metrics?.upcomingExpiry.within14d ?? 0}
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t border-slate-100 pt-5">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-slate-400">
                  Current active plan mix
                </p>
                <div className="mt-3 space-y-2">
                  {(metrics?.planDistribution ?? []).map((item) => (
                    <div
                      key={item.planCode}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm"
                    >
                      <span className="font-semibold text-slate-700">
                        {PLAN_LABELS[item.planCode] ?? item.planCode}
                      </span>
                      <span className="font-black text-slate-950">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Panel title="Revenue by plan">
              <BreakdownTable rows={data.breakdowns?.plans ?? []} />
            </Panel>
            <Panel title="Revenue by billing cycle">
              <BreakdownTable rows={data.breakdowns?.billingCycles ?? []} />
            </Panel>
            <Panel title="Revenue by payment provider">
              <BreakdownTable rows={data.breakdowns?.providers ?? []} />
            </Panel>
          </div>

          <Panel
            title="Recent paid billing activity"
            helper="Newest immutable paid receipts inside the selected analytics period."
          >
            {(data.recentPaidActivity ?? []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                No paid receipt in this period.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Workspace</th>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {data.recentPaidActivity?.map((item) => (
                      <tr key={item.invoiceId}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{item.businessName}</p>
                          <p className="mt-1 font-mono text-[10px] text-slate-400">
                            {item.businessId}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {item.invoiceNumber}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {item.planName} · {item.billingCycleLabel}
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-600">
                          {item.provider === "payway" ? "ABA PayWay" : item.provider}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">
                          {money(item.amount, item.currency)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {dateTimeLabel(item.paidAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
