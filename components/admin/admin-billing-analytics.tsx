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
  { value: "all", label: "All" },
];

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

function compactMoney(amount: number, currency: string) {
  if (currency === "USD") {
    if (Math.abs(amount) >= 1000) {
      return `$${Math.round(amount).toLocaleString("en-US")}`;
    }
    return `$${Math.round(amount)}`;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString("en-US")} ${currency}`;
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

function shortDateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Phnom_Penh",
    month: "short",
    day: "numeric",
  }).format(date);
}

function currencyAmount(values: MoneyValue[] | undefined, currency: string) {
  return values?.find((value) => value.currency === currency)?.amount ?? 0;
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

function sectionCard(children: ReactNode, className = "") {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

function rangeContext(range: RangeKey) {
  if (range === "30d") return "last 30 days";
  if (range === "90d") return "last 90 days";
  if (range === "12m") return "last 12 months";
  return "all time";
}

function parseTrendKey(key: string, range: RangeKey) {
  if (range === "30d") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (match) {
      return new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      );
    }
  }

  if (range === "90d") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (match) {
      return new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      );
    }
  }

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(key);
  if (monthMatch) {
    return new Date(
      Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1),
    );
  }

  return null;
}

function trendBucketLabel(row: TrendRow | null, range: RangeKey) {
  if (!row) return "—";
  const parsed = parseTrendKey(row.key, range);
  if (!parsed) return row.label;

  if (range === "12m" || range === "all") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      year: range === "all" ? "numeric" : undefined,
    }).format(parsed);
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function StepRevenueChart({
  trend,
  currency,
  range,
}: {
  trend: TrendRow[];
  currency: string;
  range: RangeKey;
}) {
  const width = 760;
  const height = 250;
  const left = 54;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  const cumulative = trend.reduce<Array<{
    key: string;
    label: string;
    amount: number;
  }>>((rows, item) => {
    const previous = rows.at(-1)?.amount ?? 0;
    rows.push({
      key: item.key,
      label: item.label,
      amount: previous + currencyAmount(item.revenue, currency),
    });
    return rows;
  }, []);

  const total = cumulative.at(-1)?.amount ?? 0;
  const maxValue = Math.max(1, total);
  const upper = Math.max(
    currency === "USD" ? 10 : 1000,
    Math.ceil(maxValue / (currency === "USD" ? 1000 : 100000)) *
      (currency === "USD" ? 1000 : 100000),
  );

  const xForIndex = (index: number) => {
    if (cumulative.length <= 1) return left + chartWidth;
    return left + (index / (cumulative.length - 1)) * chartWidth;
  };

  const yForValue = (value: number) =>
    top + chartHeight - (value / upper) * chartHeight;

  let linePath = `M ${left} ${top + chartHeight}`;
  let areaPath = `M ${left} ${top + chartHeight}`;

  cumulative.forEach((item, index) => {
    const x = xForIndex(index);
    const y = yForValue(item.amount);

    if (index === 0) {
      linePath += ` H ${x} V ${y}`;
      areaPath += ` H ${x} V ${y}`;
    } else {
      linePath += ` H ${x} V ${y}`;
      areaPath += ` H ${x} V ${y}`;
    }
  });

  areaPath += ` H ${left + chartWidth} V ${top + chartHeight} H ${left} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: upper * ratio,
    y: top + chartHeight - ratio * chartHeight,
  }));

  const labelIndexes = cumulative.length
    ? Array.from(
        new Set(
          [0, 0.2, 0.4, 0.6, 0.8, 1].map((ratio) =>
            Math.min(
              cumulative.length - 1,
              Math.round((cumulative.length - 1) * ratio),
            ),
          ),
        ),
      )
    : [];

  if (cumulative.length === 0 || total <= 0) {
    return (
      <div className="flex h-[250px] items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-400">
        No {currency} paid revenue in this period.
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${currency} cumulative paid revenue chart`}
        className="block h-auto w-full"
      >
        {yTicks.map((tick) => (
          <g key={tick.ratio}>
            <line
              x1={left}
              x2={left + chartWidth}
              y1={tick.y}
              y2={tick.y}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            <text
              x={left - 8}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="10"
              fill="#64748b"
            >
              {compactMoney(tick.value, currency)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="#7c2d12" opacity="0.06" />
        <path
          d={linePath}
          fill="none"
          stroke="#7c2d12"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {cumulative.map((item, index) => (
          <circle
            key={item.key}
            cx={xForIndex(index)}
            cy={yForValue(item.amount)}
            r="3.7"
            fill="#7c2d12"
            stroke="white"
            strokeWidth="2"
          >
            <title>
              {trendBucketLabel(trend[index] ?? null, range)} · {money(item.amount, currency)} cumulative
            </title>
          </circle>
        ))}

        {labelIndexes.map((index) => (
          <text
            key={`label-${index}`}
            x={xForIndex(index)}
            y={height - 8}
            textAnchor={index === 0 ? "start" : index === cumulative.length - 1 ? "end" : "middle"}
            fontSize="10"
            fill="#64748b"
          >
            {trendBucketLabel(trend[index] ?? null, range)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function StatusLegend({
  label,
  value,
  dotClass,
}: {
  label: string;
  value: number;
  dotClass: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${dotClass}`} />
      <span className="text-lg font-black text-slate-950">{value}</span>
      <span className="truncate text-sm text-slate-600">{label}</span>
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
  const primaryCurrency = currencies.includes("USD")
    ? "USD"
    : currencies[0] ?? "USD";
  const metrics = data?.metrics;
  const trend = data?.trend ?? [];
  const primaryRevenue = currencyAmount(data?.revenue?.totals, primaryCurrency);

  const bestBucket = useMemo(() => {
    let best: TrendRow | null = null;
    let bestAmount = -1;

    for (const item of trend) {
      const amount = currencyAmount(item.revenue, primaryCurrency);
      if (amount > bestAmount) {
        best = item;
        bestAmount = amount;
      }
    }

    return {
      row: best,
      amount: Math.max(0, bestAmount),
    };
  }, [primaryCurrency, trend]);

  const planRows = data?.breakdowns?.plans ?? [];
  const maxPlanInvoices = Math.max(1, ...planRows.map((row) => row.invoiceCount));
  const managed = metrics?.managed ?? 0;
  const statusPieces = [
    {
      key: "active",
      value: metrics?.activePaid ?? 0,
      className: "bg-emerald-500",
    },
    {
      key: "trial",
      value: metrics?.trialing ?? 0,
      className: "bg-blue-300",
    },
    {
      key: "expired",
      value: metrics?.expired ?? 0,
      className: "bg-stone-400",
    },
  ];

  const otherCurrencies = (data?.revenue?.totals ?? []).filter(
    (item) => item.currency !== primaryCurrency,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setRange(option.value)}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
              range === option.value
                ? "bg-slate-200 text-slate-950"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Loading billing analytics...
        </div>
      ) : data ? (
        <>
          {sectionCard(
            <div className="p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">
                    Paid revenue · {rangeContext(range)}
                  </p>
                  <p className="mt-0.5 text-3xl font-black tracking-tight text-slate-950">
                    {money(primaryRevenue, primaryCurrency)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {metrics?.paidInvoices ?? 0} invoice{(metrics?.paidInvoices ?? 0) === 1 ? "" : "s"} ·{" "}
                    {metrics?.paidWorkspaces ?? 0} paying workspace{(metrics?.paidWorkspaces ?? 0) === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="text-left text-xs text-slate-500 sm:text-right">
                  {primaryCurrency === "USD" ? (
                    <p>USD only. KHR tracked separately.</p>
                  ) : (
                    <p>{primaryCurrency} revenue view.</p>
                  )}
                  {otherCurrencies.map((item) => (
                    <p key={item.currency} className="mt-1 font-semibold text-slate-700">
                      {item.currency}: {money(item.amount, item.currency)}
                    </p>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <StepRevenueChart
                  trend={trend}
                  currency={primaryCurrency}
                  range={range}
                />
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-medium text-slate-500">New paid workspaces</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">
                    {metrics?.newPaidWorkspaces ?? 0}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">First invoice ever</p>
                </div>

                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-medium text-slate-500">Renewals</p>
                  <p className="mt-1 text-2xl font-black text-[#7c2d12]">
                    {metrics?.renewals ?? 0}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Came back from expired</p>
                </div>

                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-medium text-slate-500">Best day</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">
                    {bestBucket.row
                      ? money(bestBucket.amount, primaryCurrency)
                      : "—"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {trendBucketLabel(bestBucket.row, range)}
                  </p>
                </div>
              </div>
            </div>,
          )}

          {sectionCard(
            <div className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-base font-bold text-slate-950">Subscription health</h3>
                <p className="text-xs text-slate-500">{managed} managed workspaces</p>
              </div>

              <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                {statusPieces.map((item) => {
                  const width = managed > 0 ? (item.value / managed) * 100 : 0;
                  return width > 0 ? (
                    <div
                      key={item.key}
                      className={item.className}
                      style={{ width: `${width}%` }}
                    />
                  ) : null;
                })}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatusLegend
                  label="active paid"
                  value={metrics?.activePaid ?? 0}
                  dotClass="bg-emerald-500"
                />
                <StatusLegend
                  label="trialing"
                  value={metrics?.trialing ?? 0}
                  dotClass="bg-blue-300"
                />
                <StatusLegend
                  label="expired"
                  value={metrics?.expired ?? 0}
                  dotClass="bg-stone-400"
                />
              </div>

             
            </div>,
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {sectionCard(
              <div className="p-4 sm:p-5">
                <h3 className="text-base font-bold text-slate-950">Invoices by plan</h3>
                <div className="mt-4 space-y-3">
                  {planRows.length === 0 ? (
                    <p className="text-sm text-slate-500">No paid invoices in this period.</p>
                  ) : (
                    planRows.map((row) => (
                      <div key={row.key}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-slate-700">{row.label}</span>
                          <span className="font-bold text-slate-950">{row.invoiceCount}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-[#7c2d12]"
                            style={{
                              width: `${Math.max(4, (row.invoiceCount / maxPlanInvoices) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>,
            )}

            {sectionCard(
              <div className="p-4 sm:p-5">
                <h3 className="text-base font-bold text-slate-950">Upcoming expiries</h3>
                <p className="mt-0.5 text-xs text-slate-500">Active paid periods ending soon</p>

                <div className="mt-4 grid grid-cols-4 gap-2">
                  {[
                    ["24h", metrics?.upcomingExpiry.within24h ?? 0],
                    ["3d", metrics?.upcomingExpiry.within3d ?? 0],
                    ["7d", metrics?.upcomingExpiry.within7d ?? 0],
                    ["14d", metrics?.upcomingExpiry.within14d ?? 0],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-slate-50 px-2 py-3 text-center">
                      <p className="text-xl font-black text-slate-400">{String(value)}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{String(label)}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  {metrics?.upcomingExpiry.within14d
                    ? `${metrics.upcomingExpiry.within14d} active paid workspace${metrics.upcomingExpiry.within14d === 1 ? "" : "s"} end within 14 days.`
                    : "No active paid period ends within 14 days."}
                </div>
              </div>,
            )}
          </div>

          {sectionCard(
            <div className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-base font-bold text-slate-950">Recent payments</h3>
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/dashboard/admin?tab=billing";
                  }}
                  className="text-xs font-semibold text-[#7c2d12] hover:underline"
                >
                  View all {metrics?.paidInvoices ?? 0}
                </button>
              </div>

              {(data.recentPaidActivity ?? []).length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No paid receipt in this period.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                    <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">Workspace</th>
                        <th className="px-3 py-2 font-semibold">Plan</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="py-2 pl-3 text-right font-semibold">Paid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data.recentPaidActivity ?? []).slice(0, 8).map((item) => (
                        <tr key={item.invoiceId}>
                          <td className="py-3 pr-3">
                            <p className="font-semibold text-slate-900">{item.businessName}</p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-medium text-slate-700">
                              {item.planName} · {item.billingCycleLabel}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-400">
                              {item.provider === "payway" ? "ABA PayWay" : "Manual"}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-950">
                            {money(item.amount, item.currency)}
                          </td>
                          <td className="py-3 pl-3 text-right text-slate-500">
                            {shortDateLabel(item.paidAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>,
          )}

          
        </>
      ) : null}
    </div>
  );
}
