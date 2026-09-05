import { NextRequest, NextResponse } from "next/server";

import {
  getTenhAdminUser,
  isTenhAdminMfaRequired,
} from "@/lib/admin/tenh-admin-auth";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SecurityStatus = "healthy" | "warning" | "critical" | "info";

type SecurityCheck = {
  id: string;
  label: string;
  status: SecurityStatus;
  detail: string;
};

type SocialAccountSecurityRow = {
  id: string;
  platform: string;
  is_active: boolean | null;
  facebook_page_access_token_encrypted: string | null;
  facebook_token_status: string | null;
  facebook_token_last_error: string | null;
  telegram_bot_token_encrypted: string | null;
  telegram_token_status: string | null;
  telegram_webhook_secret_encrypted: string | null;
  telegram_webhook_status: string | null;
  telegram_webhook_last_error: string | null;
};


/*
 * SECURITY DEFINER helpers that are meant to be callable by authenticated users.
 *
 * Each one reads something `authenticated` cannot reach directly -- a tenant
 * table behind RLS, or auth.sessions -- and each scopes itself to the caller
 * before returning anything. That scoping is the reason they are safe, so a
 * name belongs here only after its body has been read and its boundary found.
 *
 * The account helpers were reviewed on 2026-09-05: tenh_account_has_password
 * filters on auth.uid(), tenh_list_user_sessions filters s.user_id = auth.uid(),
 * and tenh_revoke_user_session refuses an unauthenticated caller and deletes
 * only where user_id = caller_id.
 */
const REVIEWED_AUTHENTICATED_SECURITY_DEFINER_HELPERS = new Set([
  "can_access_tenh_business",
  "can_access_tenh_customer_files",
  "can_access_tenh_presence",
  "can_access_tenh_presence_topic",
  "can_access_tenh_reminders",
  "can_access_tenh_team_room",
  "current_tenh_member_id",
  "tenh_account_has_password",
  "tenh_list_user_sessions",
  "tenh_revoke_user_session",
]);

type DatabaseSnapshot = {
  tenantTables?: Array<{
    name?: string;
    rlsEnabled?: boolean;
    forceRls?: boolean;
  }>;
  securityDefinerExposures?: Array<{
    name?: string;
    arguments?: string;
    publicExecute?: boolean;
    anonExecute?: boolean;
    authenticatedExecute?: boolean;
  }>;
  auditTable?: {
    exists?: boolean;
    rlsEnabled?: boolean;
    forceRls?: boolean;
    publicPrivilege?: boolean;
    anonPrivilege?: boolean;
    authenticatedPrivilege?: boolean;
  };
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDatabaseSnapshot(value: unknown): DatabaseSnapshot | null {
  if (!isRecord(value)) return null;

  const tenantTables = Array.isArray(value.tenantTables)
    ? value.tenantTables.filter(isRecord).map((row) => ({
        name: cleanString(row.name) ?? undefined,
        rlsEnabled:
          typeof row.rlsEnabled === "boolean" ? row.rlsEnabled : undefined,
        forceRls:
          typeof row.forceRls === "boolean" ? row.forceRls : undefined,
      }))
    : undefined;

  const securityDefinerExposures = Array.isArray(
    value.securityDefinerExposures,
  )
    ? value.securityDefinerExposures.filter(isRecord).map((row) => ({
        name: cleanString(row.name) ?? undefined,
        arguments: cleanString(row.arguments) ?? undefined,
        publicExecute:
          typeof row.publicExecute === "boolean"
            ? row.publicExecute
            : undefined,
        anonExecute:
          typeof row.anonExecute === "boolean" ? row.anonExecute : undefined,
        authenticatedExecute:
          typeof row.authenticatedExecute === "boolean"
            ? row.authenticatedExecute
            : undefined,
      }))
    : undefined;

  const auditRaw = isRecord(value.auditTable) ? value.auditTable : null;

  return {
    tenantTables,
    securityDefinerExposures,
    auditTable: auditRaw
      ? {
          exists:
            typeof auditRaw.exists === "boolean" ? auditRaw.exists : undefined,
          rlsEnabled:
            typeof auditRaw.rlsEnabled === "boolean"
              ? auditRaw.rlsEnabled
              : undefined,
          forceRls:
            typeof auditRaw.forceRls === "boolean"
              ? auditRaw.forceRls
              : undefined,
          publicPrivilege:
            typeof auditRaw.publicPrivilege === "boolean"
              ? auditRaw.publicPrivilege
              : undefined,
          anonPrivilege:
            typeof auditRaw.anonPrivilege === "boolean"
              ? auditRaw.anonPrivilege
              : undefined,
          authenticatedPrivilege:
            typeof auditRaw.authenticatedPrivilege === "boolean"
              ? auditRaw.authenticatedPrivilege
              : undefined,
        }
      : undefined,
  };
}

function isValidTokenEncryptionKey() {
  const value = process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY?.trim();

  if (!value) return false;

  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

function getSuspiciousPublicEnvironmentNames() {
  const allowed = new Set([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]);

  return Object.keys(process.env)
    .filter((name) => name.startsWith("NEXT_PUBLIC_"))
    .filter((name) => !allowed.has(name))
    .filter((name) =>
      /(SECRET|PRIVATE|PASSWORD|TOKEN|SERVICE_ROLE|API_KEY|ENCRYPTION|MERCHANT)/i.test(
        name,
      ),
    )
    .sort();
}

function requestIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}

function summarize(checks: SecurityCheck[]) {
  return {
    total: checks.length,
    healthy: checks.filter((check) => check.status === "healthy").length,
    warning: checks.filter((check) => check.status === "warning").length,
    critical: checks.filter((check) => check.status === "critical").length,
    info: checks.filter((check) => check.status === "info").length,
  };
}

export async function GET(request: NextRequest) {
  const admin = await getTenhAdminUser();

  if (!admin.success) {
    return noStoreJson(
      {
        success: false,
        error: admin.error,
      },
      admin.status,
    );
  }

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stalePendingBefore = new Date(
    now.getTime() - 15 * 60 * 1000,
  ).toISOString();

  const supabase = await createClient();
  const [aalResult, sessionResult] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.getSession(),
  ]);

  const [
    socialAccountsResult,
    failedWebhookResult,
    staleWebhookResult,
    privilegedMembersResult,
    auditResult,
    databaseSnapshotResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("social_accounts")
      .select(
        [
          "id",
          "platform",
          "is_active",
          "facebook_page_access_token_encrypted",
          "facebook_token_status",
          "facebook_token_last_error",
          "telegram_bot_token_encrypted",
          "telegram_token_status",
          "telegram_webhook_secret_encrypted",
          "telegram_webhook_status",
          "telegram_webhook_last_error",
        ].join(","),
      )
      .eq("is_active", true)
      .limit(2000),
    supabaseAdmin
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("processing_status", "failed")
      .gte("created_at", since24h),
    supabaseAdmin
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("processing_status", "pending")
      .lte("created_at", stalePendingBefore),
    supabaseAdmin
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .in("role", ["owner", "admin"])
      .gte("created_at", since7d),
    supabaseAdmin
      .from("tenh_admin_audit_logs")
      .select("id,admin_email,action,resource_type,resource_id,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin.rpc("tenh_admin_security_snapshot"),
  ]);

  const socialRows = (socialAccountsResult.data ?? []) as unknown as
    SocialAccountSecurityRow[];
  const facebookRows = socialRows.filter((row) => row.platform === "facebook");
  const telegramRows = socialRows.filter((row) => row.platform === "telegram");

  const facebookCredentialProblems = facebookRows.filter(
    (row) =>
      !row.facebook_page_access_token_encrypted ||
      row.facebook_token_status === "disconnected" ||
      Boolean(row.facebook_token_last_error?.trim()),
  ).length;

  const telegramCredentialProblems = telegramRows.filter(
    (row) =>
      !row.telegram_bot_token_encrypted ||
      !row.telegram_webhook_secret_encrypted ||
      row.telegram_token_status !== "verified" ||
      row.telegram_webhook_status !== "active" ||
      Boolean(row.telegram_webhook_last_error?.trim()),
  ).length;

  const suspiciousPublicEnv = getSuspiciousPublicEnvironmentNames();
  const databaseSnapshot = parseDatabaseSnapshot(databaseSnapshotResult.data);
  const tenantTables = databaseSnapshot?.tenantTables ?? [];
  const tenantTablesWithoutRls = tenantTables.filter(
    (table) => table.rlsEnabled === false,
  );
  const functionExposures = databaseSnapshot?.securityDefinerExposures ?? [];
  const publicFunctionExposures = functionExposures.filter(
    (item) => item.publicExecute || item.anonExecute,
  );
  const authenticatedFunctionExposures = functionExposures.filter(
    (item) =>
      !item.publicExecute && !item.anonExecute && item.authenticatedExecute,
  );
  const reviewedAuthenticatedFunctionExposures =
    authenticatedFunctionExposures.filter((item) =>
      item.name
        ? REVIEWED_AUTHENTICATED_SECURITY_DEFINER_HELPERS.has(item.name)
        : false,
    );
  const unexpectedAuthenticatedFunctionExposures =
    authenticatedFunctionExposures.filter(
      (item) =>
        !item.name ||
        !REVIEWED_AUTHENTICATED_SECURITY_DEFINER_HELPERS.has(item.name),
    );

  const currentAal = aalResult.data?.currentLevel ?? "unknown";
  const nextAal = aalResult.data?.nextLevel ?? "unknown";
  const mfaRequired = isTenhAdminMfaRequired();
  const appUrl = process.env.TENH_APP_URL?.trim() ?? "";
  const productionHttps =
    process.env.NODE_ENV !== "production" || appUrl.startsWith("https://");

  const authentication: SecurityCheck[] = [
    {
      id: "admin-identity",
      label: "TENH admin identity binding",
      status: "healthy",
      detail:
        "This endpoint is available only after server-side Supabase authentication, exact TENH_ADMIN_USER_ID + TENH_ADMIN_EMAIL matching, and verified email checks.",
    },
    {
      id: "admin-email",
      label: "Administrator email verification",
      status: admin.user.email_confirmed_at ? "healthy" : "critical",
      detail: admin.user.email_confirmed_at
        ? "The configured TENH administrator email is verified."
        : "The configured administrator email is not verified.",
    },
    {
      id: "mfa-enforcement",
      label: "Administrator MFA enforcement",
      status: mfaRequired ? "healthy" : "warning",
      detail: mfaRequired
        ? "TENH_ADMIN_REQUIRE_MFA=true. Sensitive TENH admin pages and APIs require AAL2."
        : "MFA is not enforced yet. Finish TOTP enrollment, then set TENH_ADMIN_REQUIRE_MFA=true.",
    },
    {
      id: "current-aal",
      label: "Current administrator session assurance",
      status: currentAal === "aal2" ? "healthy" : "warning",
      detail: `Current session is ${currentAal}; next available level is ${nextAal}.`,
    },
  ];

  const credentials: SecurityCheck[] = [
    {
      id: "supabase-secret",
      label: "Supabase server credential",
      status: process.env.SUPABASE_SECRET_KEY?.trim() ? "healthy" : "critical",
      detail: process.env.SUPABASE_SECRET_KEY?.trim()
        ? "Server credential is configured and is never returned by this endpoint."
        : "SUPABASE_SECRET_KEY is missing.",
    },
    {
      id: "credential-encryption",
      label: "Facebook / Telegram credential encryption key",
      status: isValidTokenEncryptionKey() ? "healthy" : "critical",
      detail: isValidTokenEncryptionKey()
        ? "AES-256-GCM credential encryption key is configured with the expected 32-byte key length."
        : "FACEBOOK_TOKEN_ENCRYPTION_KEY is missing or does not decode to exactly 32 bytes.",
    },
    {
      id: "public-secret-env",
      label: "Public environment secret exposure",
      status: suspiciousPublicEnv.length === 0 ? "healthy" : "critical",
      detail:
        suspiciousPublicEnv.length === 0
          ? "No suspicious secret-like NEXT_PUBLIC_* variable names were detected."
          : `Review these public environment variable names immediately: ${suspiciousPublicEnv.join(", ")}.`,
    },
    {
      id: "facebook-secrets",
      label: "Facebook server secrets",
      status:
        facebookRows.length === 0 ||
        (process.env.FACEBOOK_APP_SECRET?.trim() &&
          process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN?.trim())
          ? "healthy"
          : "critical",
      detail:
        facebookRows.length === 0
          ? "No active Facebook connections require server credentials right now."
          : process.env.FACEBOOK_APP_SECRET?.trim() &&
              process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN?.trim()
            ? "Facebook App Secret and webhook verification token are configured server-side."
            : "An active Facebook connection exists but one or more required Facebook server secrets are missing.",
    },
    {
      id: "facebook-token-coverage",
      label: "Facebook stored Page credentials",
      status: facebookCredentialProblems === 0 ? "healthy" : "warning",
      detail: `${facebookRows.length} active Facebook connection(s); ${facebookCredentialProblems} have missing/disconnected/error credential state.`,
    },
    {
      id: "telegram-token-coverage",
      label: "Telegram stored credentials",
      status: telegramCredentialProblems === 0 ? "healthy" : "warning",
      detail: `${telegramRows.length} active Telegram connection(s); ${telegramCredentialProblems} have missing/unverified/error token or webhook-secret state.`,
    },
  ];

  const webhooks: SecurityCheck[] = [
    {
      id: "facebook-signatures",
      label: "Facebook webhook signature prerequisite",
      status:
        facebookRows.length === 0 || process.env.FACEBOOK_APP_SECRET?.trim()
          ? "healthy"
          : "critical",
      detail:
        "The current TENH Facebook webhook rejects POST requests that fail x-hub-signature-256 verification. This check confirms the required server secret is configured.",
    },
    {
      id: "telegram-secrets",
      label: "Telegram webhook secret coverage",
      status:
        telegramRows.every(
          (row) =>
            Boolean(row.telegram_webhook_secret_encrypted) &&
            row.telegram_webhook_status === "active",
        )
          ? "healthy"
          : "warning",
      detail:
        telegramRows.length === 0
          ? "No active Telegram webhooks."
          : "Each active Telegram connection should keep an encrypted webhook secret and active webhook status.",
    },
    {
      id: "failed-webhooks",
      label: "Failed webhook processing (24h)",
      status:
        failedWebhookResult.error || (failedWebhookResult.count ?? 0) > 0
          ? "warning"
          : "healthy",
      detail: failedWebhookResult.error
        ? `Unable to read webhook failure count: ${failedWebhookResult.error.message}`
        : `${failedWebhookResult.count ?? 0} trusted webhook event(s) failed during processing in the last 24 hours.`,
    },
    {
      id: "stale-webhooks",
      label: "Stale pending webhook events",
      status:
        staleWebhookResult.error || (staleWebhookResult.count ?? 0) > 0
          ? "warning"
          : "healthy",
      detail: staleWebhookResult.error
        ? `Unable to read pending webhook count: ${staleWebhookResult.error.message}`
        : `${staleWebhookResult.count ?? 0} webhook event(s) have remained pending for more than 15 minutes.`,
    },
    {
      id: "rejected-webhooks",
      label: "Rejected untrusted webhook attempts",
      status: "info",
      detail:
        "Invalid Facebook signatures and invalid Telegram secrets are rejected before message processing. TENH intentionally does not store their untrusted request bodies, so this page does not fabricate a rejected-request count.",
    },
  ];

  const database: SecurityCheck[] = [
    {
      id: "database-snapshot",
      label: "Database security introspection",
      status: databaseSnapshotResult.error ? "warning" : "healthy",
      detail: databaseSnapshotResult.error
        ? "Run the included TENH security SQL migration to enable server-only RLS and function-grant inspection."
        : "Server-only PostgreSQL security snapshot is available.",
    },
    {
      id: "tenant-rls",
      label: "Tenant tables with business_id use RLS",
      status:
        databaseSnapshotResult.error
          ? "warning"
          : tenantTablesWithoutRls.length === 0
            ? "healthy"
            : "critical",
      detail: databaseSnapshotResult.error
        ? "RLS inspection is unavailable until the security snapshot RPC is installed."
        : tenantTablesWithoutRls.length === 0
          ? `${tenantTables.length} tenant table(s) inspected; none were found with RLS disabled.`
          : `RLS is disabled on: ${tenantTablesWithoutRls
              .map((table) => table.name ?? "unknown")
              .join(", ")}.`,
    },
    {
      id: "admin-audit-table",
      label: "TENH admin audit table isolation",
      status:
        databaseSnapshotResult.error
          ? "warning"
          : databaseSnapshot?.auditTable?.exists &&
              databaseSnapshot.auditTable.rlsEnabled &&
              !databaseSnapshot.auditTable.publicPrivilege &&
              !databaseSnapshot.auditTable.anonPrivilege &&
              !databaseSnapshot.auditTable.authenticatedPrivilege
            ? "healthy"
            : "critical",
      detail: databaseSnapshotResult.error
        ? "Audit table grant inspection is unavailable until the security snapshot RPC is installed."
        : "tenh_admin_audit_logs should have RLS enabled and no PUBLIC/anon/authenticated table privileges.",
    },
    {
      id: "security-definer-public",
      label: "SECURITY DEFINER functions exposed to PUBLIC / anon",
      status:
        databaseSnapshotResult.error
          ? "warning"
          : publicFunctionExposures.length === 0
            ? "healthy"
            : "critical",
      detail: databaseSnapshotResult.error
        ? "Function grant inspection is unavailable."
        : publicFunctionExposures.length === 0
          ? "No public-schema SECURITY DEFINER function was found executable by PUBLIC or anon."
          : `${publicFunctionExposures.length} SECURITY DEFINER function(s) are executable by PUBLIC or anon and require review.`,
    },
    {
      id: "security-definer-authenticated",
      label: "Authenticated RLS / Realtime security helpers",
      status: databaseSnapshotResult.error
        ? "warning"
        : unexpectedAuthenticatedFunctionExposures.length > 0
          ? "warning"
          : "healthy",
      detail: databaseSnapshotResult.error
        ? "Function grant inspection is unavailable."
        : unexpectedAuthenticatedFunctionExposures.length === 0
          ? `${reviewedAuthenticatedFunctionExposures.length} reviewed TENH SECURITY DEFINER helper(s) are intentionally executable only by authenticated users for RLS / Realtime authorization; no unexpected authenticated exposure was detected.`
          : `${unexpectedAuthenticatedFunctionExposures.length} unexpected authenticated SECURITY DEFINER function(s) require review. ${reviewedAuthenticatedFunctionExposures.length} known TENH RLS / Realtime helper(s) are allowlisted by the diagnostic only.`,
    },
  ];

  const apiProtection: SecurityCheck[] = [
    {
      id: "admin-api-auth",
      label: "TENH admin API authorization",
      status: "healthy",
      detail:
        "TENH admin APIs use server-validated admin identity, and MFA is added when TENH_ADMIN_REQUIRE_MFA=true.",
    },
    {
      id: "admin-csrf",
      label: "State-changing admin request protection",
      status: "healthy",
      detail:
        "Current TENH admin mutation routes require same-origin requests and application/json through getTenhAdminMutationUser().",
    },
    {
      id: "distributed-rate-limit",
      label: "Distributed application rate limiting",
      status: "warning",
      detail:
        "This safe security patch does not silently insert a new distributed rate limiter into working Messenger, Telegram, billing, or manual-payment routes. Keep Vercel Firewall/rate limits enabled and add route-specific limits in a separately tested release.",
    },
    {
      id: "request-body-limits",
      label: "Explicit application request-body limits",
      status: "warning",
      detail:
        "Platform request limits still apply, but a single shared TENH application-level JSON body limiter is not enforced across every existing API route. Add it route-by-route after regression testing.",
    },
  ];

  const privacy: SecurityCheck[] = [
    {
      id: "https",
      label: "Production HTTPS application URL",
      status: productionHttps ? "healthy" : "critical",
      detail: productionHttps
        ? process.env.NODE_ENV === "production"
          ? "TENH_APP_URL is configured with HTTPS."
          : "Local/development environment detected; HTTPS is required for production."
        : "TENH_APP_URL is not HTTPS in production.",
    },
    {
      id: "secret-response",
      label: "Security diagnostics secret handling",
      status: "healthy",
      detail:
        "This endpoint returns only booleans, counts, safe environment variable names, and masked operational metadata. It never returns access tokens, secrets, passwords, payment credentials, or private proof paths.",
    },
    {
      id: "manual-payment-isolation",
      label: "Manual payment safety boundary",
      status: "healthy",
      detail:
        "The Security Center does not replace or mutate manual payment submission, proof upload, approval/rejection, PayWay verification, invoice, or subscription activation code.",
    },
  ];

  const sections = {
    authentication,
    credentials,
    webhooks,
    database,
    apiProtection,
    privacy,
  };
  const allChecks = Object.values(sections).flat();

  return noStoreJson({
    success: true,
    generatedAt: now.toISOString(),
    summary: summarize(allChecks),
    session: {
      email: admin.user.email ?? null,
      lastSignInAt: admin.user.last_sign_in_at ?? null,
      createdAt: admin.user.created_at ?? null,
      currentAal,
      nextAal,
      mfaRequired,
      expiresAt:
        typeof sessionResult.data.session?.expires_at === "number"
          ? new Date(sessionResult.data.session.expires_at * 1000).toISOString()
          : null,
      sourceIp: requestIp(request),
      userAgent: request.headers.get("user-agent"),
    },
    metrics: {
      activeFacebookConnections: facebookRows.length,
      facebookCredentialProblems,
      activeTelegramConnections: telegramRows.length,
      telegramCredentialProblems,
      failedWebhookEvents24h: failedWebhookResult.error
        ? null
        : failedWebhookResult.count ?? 0,
      stalePendingWebhookEvents: staleWebhookResult.error
        ? null
        : staleWebhookResult.count ?? 0,
      privilegedMembersCreated7d: privilegedMembersResult.error
        ? null
        : privilegedMembersResult.count ?? 0,
      suspiciousPublicEnvironmentNames: suspiciousPublicEnv,
    },
    sections,
    databaseSnapshot: databaseSnapshot ?? null,
    auditLogs: auditResult.error
      ? []
      : (auditResult.data ?? []).map((row) => ({
          id: row.id,
          adminEmail: row.admin_email,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          createdAt: row.created_at,
        })),
    warnings: [
      socialAccountsResult.error
        ? `social_accounts security scan: ${socialAccountsResult.error.message}`
        : null,
      auditResult.error
        ? `admin audit log: ${auditResult.error.message}`
        : null,
      privilegedMembersResult.error
        ? `privileged member scan: ${privilegedMembersResult.error.message}`
        : null,
      aalResult.error ? `MFA assurance: ${aalResult.error.message}` : null,
      sessionResult.error ? `session inspection: ${sessionResult.error.message}` : null,
      databaseSnapshotResult.error
        ? `database snapshot: ${databaseSnapshotResult.error.message}`
        : null,
    ].filter((value): value is string => Boolean(value)),
  });
}