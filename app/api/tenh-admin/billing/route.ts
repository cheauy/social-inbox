import { NextResponse, type NextRequest } from "next/server";

import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_STATUS_FILTERS = new Set([
  "all",
  "trialing",
  "active",
  "past_due",
  "expired",
  "suspended",
  "legacy",
]);

function json(
  body: Record<string, unknown>,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: NO_STORE_HEADERS,
  });
}

function cleanQuery(value: string | null) {
  return (value ?? "").trim().slice(0, 120);
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  );
}

type CountTable =
  | "businesses"
  | "business_subscriptions"
  | "manual_payment_requests"
  | "tenh_billing_invoices";

type WorkspaceListSubscriptionRow = {
  business_id: string;
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  member_limit: number | string | null;
  channel_limit: number | string | null;
  payment_provider: string | null;
  pending_plan_code: string | null;
  pending_billing_cycle: string | null;
  pending_plan_effective_at: string | null;
};

type WorkspaceDetailSubscriptionRow = {
  id: string;
  business_id: string;
  plan_code: string | null;
  status: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  member_limit: number | string | null;
  channel_limit: number | string | null;
  storage_limit_bytes: number | string | null;
  monthly_message_limit: number | string | null;
  payment_provider: string | null;
  pending_plan_code: string | null;
  pending_billing_cycle: string | null;
  pending_plan_change_type: string | null;
  pending_plan_requested_at: string | null;
  pending_plan_effective_at: string | null;
  pending_plan_requested_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

async function safeCount(
  table: CountTable,
  apply?: (query: any) => any,
) {
  let query = supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true });

  if (apply) query = apply(query);

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadGlobalSummary() {
  const [
    workspaceCount,
    managedCount,
    activeCount,
    trialingCount,
    expiredCount,
    suspendedCount,
    pastDueCount,
    pendingManualCount,
    paidInvoiceCount,
  ] = await Promise.all([
    safeCount("businesses"),
    safeCount("business_subscriptions"),
    safeCount("business_subscriptions", (query) =>
      query.eq("status", "active"),
    ),
    safeCount("business_subscriptions", (query) =>
      query.eq("status", "trialing"),
    ),
    safeCount("business_subscriptions", (query) =>
      query.eq("status", "expired"),
    ),
    safeCount("business_subscriptions", (query) =>
      query.eq("status", "suspended"),
    ),
    safeCount("business_subscriptions", (query) =>
      query.eq("status", "past_due"),
    ),
    safeCount("manual_payment_requests", (query) =>
      query.eq("status", "submitted"),
    ),
    safeCount("tenh_billing_invoices", (query) =>
      query.eq("status", "paid"),
    ),
  ]);

  return {
    workspaces: workspaceCount,
    managed: managedCount,
    legacy: Math.max(0, workspaceCount - managedCount),
    active: activeCount,
    trialing: trialingCount,
    expired: expiredCount,
    suspended: suspendedCount,
    pastDue: pastDueCount,
    pendingManual: pendingManualCount,
    paidInvoices: paidInvoiceCount,
  };
}

async function findBusinessIds(search: string) {
  if (!search) return [] as string[];

  const ids = new Set<string>();
  const addRows = (
    rows: Array<{ business_id?: string; id?: string }> | null,
    useId = false,
  ) => {
    for (const row of rows ?? []) {
      const id = useId ? row.id : row.business_id;
      if (id) ids.add(id);
    }
  };

  if (UUID_PATTERN.test(search)) {
    ids.add(search);
  }

  const [
    businessesByName,
    businessesBySlug,
    membersByEmail,
    membersByName,
    invoicesByNumber,
    invoicesByTransaction,
    payWayByTransaction,
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id")
      .ilike("name", `%${search}%`)
      .limit(40),
    supabaseAdmin
      .from("businesses")
      .select("id")
      .ilike("slug", `%${search}%`)
      .limit(40),
    supabaseAdmin
      .from("team_members")
      .select("business_id")
      .ilike("email", `%${search}%`)
      .limit(40),
    supabaseAdmin
      .from("team_members")
      .select("business_id")
      .ilike("full_name", `%${search}%`)
      .limit(40),
    supabaseAdmin
      .from("tenh_billing_invoices")
      .select("business_id")
      .ilike("invoice_number", `%${search}%`)
      .limit(40),
    supabaseAdmin
      .from("tenh_billing_invoices")
      .select("business_id")
      .ilike("source_transaction_id", `%${search}%`)
      .limit(40),
    supabaseAdmin
      .from("billing_transactions")
      .select("business_id")
      .ilike("provider_transaction_id", `%${search}%`)
      .limit(40),
  ]);

  const results = [
    businessesByName,
    businessesBySlug,
    membersByEmail,
    membersByName,
    invoicesByNumber,
    invoicesByTransaction,
    payWayByTransaction,
  ];

  const failure = results.find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);

  addRows(businessesByName.data as any, true);
  addRows(businessesBySlug.data as any, true);
  addRows(membersByEmail.data as any);
  addRows(membersByName.data as any);
  addRows(invoicesByNumber.data as any);
  addRows(invoicesByTransaction.data as any);
  addRows(payWayByTransaction.data as any);

  return Array.from(ids).slice(0, 80);
}

async function loadWorkspaceList(
  search: string,
  statusFilter: string,
) {
  let businessRows: any[] = [];

  if (search) {
    const businessIds = await findBusinessIds(search);

    if (businessIds.length === 0) {
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("id,name,slug,created_at")
      .in("id", businessIds)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) throw new Error(error.message);
    businessRows = data ?? [];
  } else if (
    statusFilter !== "all" &&
    statusFilter !== "legacy"
  ) {
    const { data: matchingSubscriptions, error: subscriptionFilterError } =
      await supabaseAdmin
        .from("business_subscriptions")
        .select("business_id")
        .eq("status", statusFilter)
        .order("updated_at", { ascending: false })
        .limit(80);

    if (subscriptionFilterError) {
      throw new Error(subscriptionFilterError.message);
    }

    const businessIds = uniqueStrings(
      (matchingSubscriptions ?? []).map((row) => row.business_id),
    );

    if (businessIds.length === 0) return [];

    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("id,name,slug,created_at")
      .in("id", businessIds)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) throw new Error(error.message);
    businessRows = data ?? [];
  } else {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("id,name,slug,created_at")
      .order("created_at", { ascending: false })
      .limit(statusFilter === "legacy" ? 120 : 60);

    if (error) throw new Error(error.message);
    businessRows = data ?? [];
  }

  const businessIds = businessRows.map((row) => row.id);
  if (businessIds.length === 0) return [];

  const [subscriptionsResult, membersResult, channelsResult, manualResult, invoiceResult] =
    await Promise.all([
      supabaseAdmin
        .from("business_subscriptions")
        .select(
          [
            "business_id",
            "plan_code",
            "status",
            "trial_ends_at",
            "current_period_start",
            "current_period_end",
            "member_limit",
            "channel_limit",
            "payment_provider",
            "pending_plan_code",
            "pending_billing_cycle",
            "pending_plan_effective_at",
          ].join(","),
        )
        .in("business_id", businessIds),
      supabaseAdmin
        .from("team_members")
        .select("id,business_id,full_name,email,role,is_active")
        .in("business_id", businessIds),
      supabaseAdmin
        .from("social_accounts")
        .select("id,business_id,is_active")
        .in("business_id", businessIds),
      supabaseAdmin
        .from("manual_payment_requests")
        .select("id,business_id,status,created_at")
        .in("business_id", businessIds)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("tenh_billing_invoices")
        .select("id,business_id,paid_at,amount,currency,invoice_number")
        .in("business_id", businessIds)
        .order("paid_at", { ascending: false }),
    ]);

  const results = [
    subscriptionsResult,
    membersResult,
    channelsResult,
    manualResult,
    invoiceResult,
  ];
  const failure = results.find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);

  const subscriptionRows =
    (subscriptionsResult.data ?? []) as unknown as
      WorkspaceListSubscriptionRow[];

  const subscriptionMap =
    new Map<string, WorkspaceListSubscriptionRow>();

  for (const row of subscriptionRows) {
    subscriptionMap.set(row.business_id, row);
  }

  const membersByBusiness = new Map<string, any[]>();
  for (const member of membersResult.data ?? []) {
    const current = membersByBusiness.get(member.business_id) ?? [];
    current.push(member);
    membersByBusiness.set(member.business_id, current);
  }

  const activeChannelsByBusiness = new Map<string, number>();
  for (const channel of channelsResult.data ?? []) {
    if (!channel.is_active) continue;
    activeChannelsByBusiness.set(
      channel.business_id,
      (activeChannelsByBusiness.get(channel.business_id) ?? 0) + 1,
    );
  }

  const manualByBusiness = new Map<string, any[]>();
  for (const payment of manualResult.data ?? []) {
    const current = manualByBusiness.get(payment.business_id) ?? [];
    current.push(payment);
    manualByBusiness.set(payment.business_id, current);
  }

  const invoicesByBusiness = new Map<string, any[]>();
  for (const invoice of invoiceResult.data ?? []) {
    const current = invoicesByBusiness.get(invoice.business_id) ?? [];
    current.push(invoice);
    invoicesByBusiness.set(invoice.business_id, current);
  }

  const list = businessRows.map((business) => {
    const subscription = subscriptionMap.get(business.id) ?? null;
    const members = membersByBusiness.get(business.id) ?? [];
    const owners = members.filter(
      (member) => member.role === "owner" && member.is_active,
    );
    const activeMembers = members.filter((member) => member.is_active).length;
    const manualPayments = manualByBusiness.get(business.id) ?? [];
    const invoices = invoicesByBusiness.get(business.id) ?? [];
    const lastInvoice = invoices[0] ?? null;

    return {
      businessId: business.id,
      businessName: business.name ?? "TENH workspace",
      slug: business.slug ?? null,
      createdAt: business.created_at,
      ownerName:
        owners[0]?.full_name?.trim() ||
        owners[0]?.email?.trim() ||
        null,
      ownerEmail: owners[0]?.email ?? null,
      managed: Boolean(subscription),
      planCode: subscription?.plan_code ?? null,
      status: subscription?.status ?? null,
      trialEndsAt: subscription?.trial_ends_at ?? null,
      currentPeriodStart: subscription?.current_period_start ?? null,
      currentPeriodEnd: subscription?.current_period_end ?? null,
      memberLimit: subscription?.member_limit ?? null,
      channelLimit: subscription?.channel_limit ?? null,
      paymentProvider: subscription?.payment_provider ?? null,
      pendingPlanCode: subscription?.pending_plan_code ?? null,
      pendingBillingCycle: subscription?.pending_billing_cycle ?? null,
      pendingEffectiveAt: subscription?.pending_plan_effective_at ?? null,
      activeMembers,
      activeChannels: activeChannelsByBusiness.get(business.id) ?? 0,
      pendingManual: manualPayments.filter(
        (payment) => payment.status === "submitted",
      ).length,
      invoiceCount: invoices.length,
      lastPaidAt: lastInvoice?.paid_at ?? null,
      lastInvoiceNumber: lastInvoice?.invoice_number ?? null,
    };
  });

  if (statusFilter === "legacy") {
    return list.filter((item) => !item.managed);
  }

  if (statusFilter !== "all") {
    return list.filter((item) => item.status === statusFilter);
  }

  return list;
}

async function loadWorkspaceDetail(businessId: string) {
  const businessResult = await supabaseAdmin
    .from("businesses")
    .select("id,name,slug,created_at")
    .eq("id", businessId)
    .maybeSingle();

  if (businessResult.error) {
    throw new Error(businessResult.error.message);
  }

  if (!businessResult.data) return null;

  const [
    subscriptionResult,
    membersResult,
    channelsResult,
    payWayResult,
    manualResult,
    invoicesResult,
    lifecycleResult,
    auditByResourceResult,
    auditByMetadataResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("business_subscriptions")
      .select(
        [
          "id",
          "business_id",
          "plan_code",
          "status",
          "trial_started_at",
          "trial_ends_at",
          "current_period_start",
          "current_period_end",
          "member_limit",
          "channel_limit",
          "storage_limit_bytes",
          "monthly_message_limit",
          "payment_provider",
          "pending_plan_code",
          "pending_billing_cycle",
          "pending_plan_change_type",
          "pending_plan_requested_at",
          "pending_plan_effective_at",
          "pending_plan_requested_by_member_id",
          "created_at",
          "updated_at",
        ].join(","),
      )
      .eq("business_id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("team_members")
      .select("id,full_name,email,role,is_active,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("social_accounts")
      .select("id,platform,platform_account_id,is_active,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("billing_transactions")
      .select(
        [
          "id",
          "provider_transaction_id",
          "plan_code",
          "billing_cycle",
          "amount",
          "currency",
          "status",
          "provider_status_code",
          "provider_status",
          "provider_approval_code",
          "verified_at",
          "created_at",
        ].join(","),
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("manual_payment_requests")
      .select(
        [
          "id",
          "requested_by_member_id",
          "plan_code",
          "billing_cycle",
          "amount",
          "currency",
          "status",
          "customer_note",
          "reviewed_by_email",
          "reviewed_at",
          "review_note",
          "approved_at",
          "created_at",
        ].join(","),
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("tenh_billing_invoices")
      .select(
        [
          "id",
          "invoice_number",
          "source_type",
          "source_payment_id",
          "source_transaction_id",
          "workspace_name",
          "customer_name",
          "billing_email",
          "plan_code",
          "plan_name",
          "billing_cycle",
          "billing_cycle_label",
          "amount",
          "currency",
          "payment_method",
          "provider",
          "provider_approval_code",
          "status",
          "paid_at",
          "period_start",
          "period_end",
          "issued_at",
        ].join(","),
      )
      .eq("business_id", businessId)
      .order("issued_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("tenh_subscription_lifecycle_events")
      .select(
        "id,event_type,plan_code,previous_status,new_status,effective_at,actor_member_id,metadata,created_at",
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("tenh_admin_audit_logs")
      .select(
        "id,admin_email,action,resource_type,resource_id,created_at",
      )
      .eq("resource_id", businessId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabaseAdmin
      .from("tenh_admin_audit_logs")
      .select(
        "id,admin_email,action,resource_type,resource_id,created_at",
      )
      .contains("metadata", { businessId })
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const requiredResults = [
    subscriptionResult,
    membersResult,
    channelsResult,
    payWayResult,
    manualResult,
    invoicesResult,
    lifecycleResult,
  ];
  const failure = requiredResults.find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);

  // Admin audit history is supplementary. If the audit table is temporarily
  // unavailable, do not hide the customer's billing state from the real TENH admin.
  const auditRows = [
    ...(auditByResourceResult.data ?? []),
    ...(auditByMetadataResult.data ?? []),
  ];
  const auditMap = new Map<string, any>();
  for (const row of auditRows) auditMap.set(row.id, row);

  const members = membersResult.data ?? [];
  const channels = channelsResult.data ?? [];

  const subscriptionData =
    subscriptionResult.data as unknown as
      | WorkspaceDetailSubscriptionRow
      | null;

  const owners = members.filter(
    (member) => member.role === "owner" && member.is_active,
  );

  return {
    business: {
      id: businessResult.data.id,
      name: businessResult.data.name ?? "TENH workspace",
      slug: businessResult.data.slug ?? null,
      createdAt: businessResult.data.created_at,
      ownerName:
        owners[0]?.full_name?.trim() || owners[0]?.email?.trim() || null,
      ownerEmail: owners[0]?.email ?? null,
    },
    subscription: subscriptionData
      ? {
          ...subscriptionData,
          member_limit: normalizeNumber(
            subscriptionData.member_limit,
          ),
          channel_limit: normalizeNumber(
            subscriptionData.channel_limit,
          ),
        }
      : null,
    usage: {
      activeMembers: members.filter((member) => member.is_active).length,
      activeChannels: channels.filter((channel) => channel.is_active).length,
    },
    members: members.map((member) => ({
      id: member.id,
      fullName: member.full_name,
      email: member.email,
      role: member.role,
      active: member.is_active,
      createdAt: member.created_at,
    })),
    channels: channels.map((channel) => ({
      id: channel.id,
      platform: channel.platform,
      platformAccountId: channel.platform_account_id,
      active: channel.is_active,
      createdAt: channel.created_at,
    })),
    payWayTransactions: (payWayResult.data ?? []).map((row: any) => ({
      id: row.id,
      transactionId: row.provider_transaction_id,
      planCode: row.plan_code,
      billingCycle: row.billing_cycle,
      amount: normalizeNumber(row.amount),
      currency: row.currency,
      status: row.status,
      providerStatusCode: row.provider_status_code,
      providerStatus: row.provider_status,
      approvalCode: row.provider_approval_code,
      verifiedAt: row.verified_at,
      createdAt: row.created_at,
    })),
    manualPayments: (manualResult.data ?? []).map((row: any) => ({
      id: row.id,
      requestedByMemberId: row.requested_by_member_id,
      planCode: row.plan_code,
      billingCycle: row.billing_cycle,
      amount: normalizeNumber(row.amount),
      currency: row.currency,
      status: row.status,
      customerNote: row.customer_note,
      reviewedByEmail: row.reviewed_by_email,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
    })),
    invoices: (invoicesResult.data ?? []).map((row: any) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      sourceType: row.source_type,
      sourcePaymentId: row.source_payment_id,
      transactionId: row.source_transaction_id,
      workspaceName: row.workspace_name,
      customerName: row.customer_name,
      billingEmail: row.billing_email,
      planCode: row.plan_code,
      planName: row.plan_name,
      billingCycle: row.billing_cycle,
      billingCycleLabel: row.billing_cycle_label,
      amount: normalizeNumber(row.amount),
      currency: row.currency,
      paymentMethod: row.payment_method,
      provider: row.provider,
      approvalCode: row.provider_approval_code,
      status: row.status,
      paidAt: row.paid_at,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      issuedAt: row.issued_at,
    })),
    lifecycleEvents: lifecycleResult.data ?? [],
    adminAudit: Array.from(auditMap.values())
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime(),
      )
      .slice(0, 50),
  };
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

  const businessId = cleanQuery(
    request.nextUrl.searchParams.get("businessId"),
  );

  try {
    if (businessId) {
      if (!UUID_PATTERN.test(businessId)) {
        return json(
          {
            success: false,
            error: "Invalid workspace ID.",
          },
          { status: 400 },
        );
      }

      const detail = await loadWorkspaceDetail(businessId);

      if (!detail) {
        return json(
          {
            success: false,
            error: "TENH workspace was not found.",
          },
          { status: 404 },
        );
      }

      return json({
        success: true,
        detail,
      });
    }

    const search = cleanQuery(request.nextUrl.searchParams.get("q"));
    const rawStatus = cleanQuery(
      request.nextUrl.searchParams.get("status"),
    ).toLowerCase();
    const status = ALLOWED_STATUS_FILTERS.has(rawStatus)
      ? rawStatus
      : "all";

    const [summary, workspaces] = await Promise.all([
      loadGlobalSummary(),
      loadWorkspaceList(search, status),
    ]);

    return json({
      success: true,
      query: search,
      status,
      summary,
      workspaces,
    });
  } catch (error) {
    console.error(
      "[TENH V3.10.5 Admin Billing] Unable to load billing management:",
      error,
    );

    return json(
      {
        success: false,
        error: "Unable to load TENH billing management.",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
