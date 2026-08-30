import { NextResponse, type NextRequest } from "next/server";

import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

const RANGE_KEYS = ["30d", "90d", "12m", "all"] as const;
type RangeKey = (typeof RANGE_KEYS)[number];

const PAID_PLAN_CODES = new Set(["mini", "standard", "pro"]);
const PAGE_SIZE = 1000;
const CAMBODIA_OFFSET_MS = 7 * 60 * 60 * 1000;

function json(
  body: Record<string, unknown>,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: NO_STORE_HEADERS,
  });
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRange(value: string | null): RangeKey {
  const normalized = (value ?? "30d").trim().toLowerCase();
  return (RANGE_KEYS as readonly string[]).includes(normalized)
    ? (normalized as RangeKey)
    : "30d";
}

function rangeBounds(range: RangeKey) {
  const end = new Date();

  if (range === "all") {
    return {
      start: null as Date | null,
      end,
      previousStart: null as Date | null,
      previousEnd: null as Date | null,
    };
  }

  const durationMs =
    range === "30d"
      ? 30 * 24 * 60 * 60 * 1000
      : range === "90d"
        ? 90 * 24 * 60 * 60 * 1000
        : 365 * 24 * 60 * 60 * 1000;

  const start = new Date(end.getTime() - durationMs);
  const previousEnd = new Date(start);
  const previousStart = new Date(start.getTime() - durationMs);

  return {
    start,
    end,
    previousStart,
    previousEnd,
  };
}

type InvoiceRow = {
  id: string;
  business_id: string;
  invoice_number: string;
  plan_code: string;
  plan_name: string;
  billing_cycle: string;
  billing_cycle_label: string;
  amount: number | string;
  currency: string;
  payment_method: string;
  provider: string;
  paid_at: string;
  period_start: string;
  period_end: string;
};

type FirstInvoiceRow = {
  business_id: string;
  paid_at: string;
};

type SubscriptionRow = {
  business_id: string;
  plan_code: string;
  status: string;
  current_period_end: string | null;
};

type RenewalRow = {
  business_id: string;
  plan_code: string | null;
  effective_at: string | null;
  created_at: string;
};

async function fetchPagedInvoices(minPaidAt: Date | null) {
  const rows: InvoiceRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabaseAdmin
      .from("tenh_billing_invoices")
      .select(
        [
          "id",
          "business_id",
          "invoice_number",
          "plan_code",
          "plan_name",
          "billing_cycle",
          "billing_cycle_label",
          "amount",
          "currency",
          "payment_method",
          "provider",
          "paid_at",
          "period_start",
          "period_end",
        ].join(","),
      )
      .eq("status", "paid")
      .order("paid_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (minPaidAt) {
      query = query.gte("paid_at", minPaidAt.toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const page = (data ?? []) as unknown as InvoiceRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchFirstInvoiceRows() {
  const rows: FirstInvoiceRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("tenh_billing_invoices")
      .select("business_id,paid_at")
      .eq("status", "paid")
      .order("paid_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as unknown as FirstInvoiceRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchSubscriptions() {
  const rows: SubscriptionRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("business_subscriptions")
      .select(
        "business_id,plan_code,status,current_period_end",
      )
      .order("updated_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as unknown as SubscriptionRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchRenewals(minEffectiveAt: Date | null) {
  const rows: RenewalRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabaseAdmin
      .from("tenh_subscription_lifecycle_events")
      .select("business_id,plan_code,effective_at,created_at")
      .eq("event_type", "renewed")
      .order("effective_at", { ascending: true, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);

    if (minEffectiveAt) {
      query = query.gte("effective_at", minEffectiveAt.toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const page = (data ?? []) as unknown as RenewalRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

function sumCurrency(rows: InvoiceRow[]) {
  const totals: Record<string, number> = {};

  for (const row of rows) {
    const currency = (row.currency || "USD").toUpperCase();
    totals[currency] =
      (totals[currency] ?? 0) + normalizeNumber(row.amount);
  }

  return Object.entries(totals)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function splitByDate(
  rows: InvoiceRow[],
  start: Date | null,
  end: Date,
) {
  return rows.filter((row) => {
    const paidAt = new Date(row.paid_at).getTime();
    if (!Number.isFinite(paidAt)) return false;
    if (paidAt > end.getTime()) return false;
    if (start && paidAt < start.getTime()) return false;
    return true;
  });
}

function buildBreakdown(
  rows: InvoiceRow[],
  keyOf: (row: InvoiceRow) => string,
  labelOf?: (row: InvoiceRow) => string,
) {
  const map = new Map<
    string,
    {
      key: string;
      label: string;
      invoiceCount: number;
      workspaces: Set<string>;
      revenue: Record<string, number>;
    }
  >();

  for (const row of rows) {
    const key = keyOf(row) || "unknown";
    const current = map.get(key) ?? {
      key,
      label: labelOf?.(row) || key,
      invoiceCount: 0,
      workspaces: new Set<string>(),
      revenue: {},
    };

    current.invoiceCount += 1;
    current.workspaces.add(row.business_id);

    const currency = (row.currency || "USD").toUpperCase();
    current.revenue[currency] =
      (current.revenue[currency] ?? 0) + normalizeNumber(row.amount);

    map.set(key, current);
  }

  return Array.from(map.values())
    .map((item) => ({
      key: item.key,
      label: item.label,
      invoiceCount: item.invoiceCount,
      workspaceCount: item.workspaces.size,
      revenue: Object.entries(item.revenue)
        .map(([currency, amount]) => ({ currency, amount }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    }))
    .sort((a, b) => b.invoiceCount - a.invoiceCount);
}

function shiftedDateParts(date: Date) {
  const shifted = new Date(date.getTime() + CAMBODIA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function buildTrend(rows: InvoiceRow[], range: RangeKey) {
  const bucket = new Map<
    string,
    {
      key: string;
      label: string;
      revenue: Record<string, number>;
      invoices: number;
    }
  >();

  for (const row of rows) {
    const paidAt = new Date(row.paid_at);
    if (!Number.isFinite(paidAt.getTime())) continue;

    const parts = shiftedDateParts(paidAt);
    let key: string;
    let label: string;

    if (range === "30d") {
      key = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
      label = `${pad(parts.month)}/${pad(parts.day)}`;
    } else if (range === "90d") {
      const shifted = new Date(paidAt.getTime() + CAMBODIA_OFFSET_MS);
      const weekday = shifted.getUTCDay();
      const daysFromMonday = (weekday + 6) % 7;
      shifted.setUTCDate(shifted.getUTCDate() - daysFromMonday);
      const week = {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
      };
      key = `${week.year}-${pad(week.month)}-${pad(week.day)}`;
      label = `${pad(week.month)}/${pad(week.day)}`;
    } else {
      key = `${parts.year}-${pad(parts.month)}`;
      label = `${parts.year}-${pad(parts.month)}`;
    }

    const current = bucket.get(key) ?? {
      key,
      label,
      revenue: {},
      invoices: 0,
    };

    current.invoices += 1;
    const currency = (row.currency || "USD").toUpperCase();
    current.revenue[currency] =
      (current.revenue[currency] ?? 0) + normalizeNumber(row.amount);
    bucket.set(key, current);
  }

  return Array.from(bucket.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((item) => ({
      ...item,
      revenue: Object.entries(item.revenue)
        .map(([currency, amount]) => ({ currency, amount }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    }));
}

function currentSubscriptionSummary(rows: SubscriptionRow[]) {
  const activePaid = rows.filter(
    (row) => row.status === "active" && PAID_PLAN_CODES.has(row.plan_code),
  );

  const planDistribution = ["mini", "standard", "pro"].map((planCode) => ({
    planCode,
    count: activePaid.filter((row) => row.plan_code === planCode).length,
  }));

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  function expiringWithin(duration: number) {
    return activePaid.filter((row) => {
      if (!row.current_period_end) return false;
      const end = new Date(row.current_period_end).getTime();
      return Number.isFinite(end) && end > now && end <= now + duration;
    }).length;
  }

  return {
    managed: rows.length,
    activePaid: activePaid.length,
    trialing: rows.filter((row) => row.status === "trialing").length,
    expired: rows.filter((row) => row.status === "expired").length,
    pastDue: rows.filter((row) => row.status === "past_due").length,
    suspended: rows.filter((row) => row.status === "suspended").length,
    planDistribution,
    upcomingExpiry: {
      within24h: expiringWithin(day),
      within3d: expiringWithin(3 * day),
      within7d: expiringWithin(7 * day),
      within14d: expiringWithin(14 * day),
    },
  };
}

function percentageDelta(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function revenueComparison(
  currentRows: InvoiceRow[],
  previousRows: InvoiceRow[],
) {
  const current = Object.fromEntries(
    sumCurrency(currentRows).map((item) => [item.currency, item.amount]),
  );
  const previous = Object.fromEntries(
    sumCurrency(previousRows).map((item) => [item.currency, item.amount]),
  );

  const currencies = Array.from(
    new Set([...Object.keys(current), ...Object.keys(previous)]),
  ).sort();

  return currencies.map((currency) => ({
    currency,
    current: current[currency] ?? 0,
    previous: previous[currency] ?? 0,
    deltaPercent: percentageDelta(
      current[currency] ?? 0,
      previous[currency] ?? 0,
    ),
  }));
}

async function loadBusinessNames(ids: string[]) {
  const unique = Array.from(new Set(ids)).slice(0, 100);
  if (unique.length === 0) return new Map<string, string>();

  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id,name")
    .in("id", unique);

  if (error) throw new Error(error.message);

  return new Map(
    (data ?? []).map((row: { id: string; name: string | null }) => [
      row.id,
      row.name ?? "TENH workspace",
    ]),
  );
}

export async function GET(request: NextRequest) {
  const admin = await getTenhAdminUser();

  if (!admin.success) {
    return json(
      {
        success: false,
        error: admin.error,
      },
      { status: admin.status },
    );
  }

  const range = parseRange(request.nextUrl.searchParams.get("range"));
  const bounds = rangeBounds(range);
  const invoiceMinDate = bounds.previousStart ?? null;

  try {
    const [invoiceRows, firstInvoiceRows, subscriptions, renewalRows] =
      await Promise.all([
        fetchPagedInvoices(invoiceMinDate),
        fetchFirstInvoiceRows(),
        fetchSubscriptions(),
        fetchRenewals(invoiceMinDate),
      ]);

    const currentInvoices = splitByDate(
      invoiceRows,
      bounds.start,
      bounds.end,
    );

    const previousInvoices = bounds.previousStart && bounds.previousEnd
      ? splitByDate(
          invoiceRows,
          bounds.previousStart,
          bounds.previousEnd,
        )
      : [];

    const firstPaidAtByBusiness = new Map<string, number>();
    for (const row of firstInvoiceRows) {
      if (firstPaidAtByBusiness.has(row.business_id)) continue;
      const paidAt = new Date(row.paid_at).getTime();
      if (Number.isFinite(paidAt)) {
        firstPaidAtByBusiness.set(row.business_id, paidAt);
      }
    }

    const newPaidWorkspaceIds = new Set<string>();
    for (const invoice of currentInvoices) {
      const firstPaidAt = firstPaidAtByBusiness.get(invoice.business_id);
      const paidAt = new Date(invoice.paid_at).getTime();
      if (
        firstPaidAt !== undefined &&
        Number.isFinite(paidAt) &&
        paidAt === firstPaidAt
      ) {
        newPaidWorkspaceIds.add(invoice.business_id);
      }
    }

    const currentRenewals = renewalRows.filter((row) => {
      const value = row.effective_at ?? row.created_at;
      const at = new Date(value).getTime();
      if (!Number.isFinite(at)) return false;
      if (bounds.start && at < bounds.start.getTime()) return false;
      return at <= bounds.end.getTime();
    });

    const recentInvoices = [...currentInvoices]
      .sort(
        (a, b) =>
          new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime(),
      )
      .slice(0, 12);

    const businessNames = await loadBusinessNames(
      recentInvoices.map((row) => row.business_id),
    );

    const uniquePaidWorkspaces = new Set(
      currentInvoices.map((row) => row.business_id),
    );

    const currentSubscriptions = currentSubscriptionSummary(subscriptions);

    return json({
      success: true,
      range,
      generatedAt: new Date().toISOString(),
      period: {
        start: bounds.start?.toISOString() ?? null,
        end: bounds.end.toISOString(),
        previousStart: bounds.previousStart?.toISOString() ?? null,
        previousEnd: bounds.previousEnd?.toISOString() ?? null,
      },
      revenue: {
        totals: sumCurrency(currentInvoices),
        comparison: revenueComparison(currentInvoices, previousInvoices),
      },
      metrics: {
        paidInvoices: currentInvoices.length,
        paidWorkspaces: uniquePaidWorkspaces.size,
        newPaidWorkspaces: newPaidWorkspaceIds.size,
        renewals: currentRenewals.length,
        ...currentSubscriptions,
      },
      breakdowns: {
        plans: buildBreakdown(
          currentInvoices,
          (row) => row.plan_code,
          (row) => row.plan_name,
        ),
        billingCycles: buildBreakdown(
          currentInvoices,
          (row) => row.billing_cycle,
          (row) => row.billing_cycle_label,
        ),
        providers: buildBreakdown(
          currentInvoices,
          (row) => row.provider,
          (row) =>
            row.provider === "payway"
              ? "ABA PayWay"
              : row.provider === "manual"
                ? "Manual bank transfer"
                : row.provider,
        ),
      },
      trend: buildTrend(currentInvoices, range),
      recentPaidActivity: recentInvoices.map((row) => ({
        invoiceId: row.id,
        invoiceNumber: row.invoice_number,
        businessId: row.business_id,
        businessName:
          businessNames.get(row.business_id) ?? "TENH workspace",
        planCode: row.plan_code,
        planName: row.plan_name,
        billingCycle: row.billing_cycle,
        billingCycleLabel: row.billing_cycle_label,
        amount: normalizeNumber(row.amount),
        currency: row.currency,
        provider: row.provider,
        paymentMethod: row.payment_method,
        paidAt: row.paid_at,
        periodStart: row.period_start,
        periodEnd: row.period_end,
      })),
    });
  } catch (error) {
    console.error(
      "[TENH V3.10.8 Billing Analytics] Unable to load analytics:",
      error,
    );

    return json(
      {
        success: false,
        error: "Unable to load TENH billing analytics.",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
