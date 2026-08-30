"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AdminSecurityPanel } from "@/components/admin/admin-security-panel";
import { createClient } from "@/lib/supabase/client";

type SecurityStatus = "healthy" | "warning" | "critical" | "info";

type SecurityCheck = {
  id: string;
  label: string;
  status: SecurityStatus;
  detail: string;
};

type SecuritySectionKey =
  | "overview"
  | "authentication"
  | "credentials"
  | "webhooks"
  | "database"
  | "apiProtection"
  | "privacy"
  | "audit";

type SecurityData = {
  success: true;
  generatedAt: string;
  summary: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    info: number;
  };
  session: {
    email: string | null;
    lastSignInAt: string | null;
    createdAt: string | null;
    currentAal: string;
    nextAal: string;
    mfaRequired: boolean;
    expiresAt: string | null;
    sourceIp: string | null;
    userAgent: string | null;
  };
  metrics: {
    activeFacebookConnections: number;
    facebookCredentialProblems: number;
    activeTelegramConnections: number;
    telegramCredentialProblems: number;
    failedWebhookEvents24h: number | null;
    stalePendingWebhookEvents: number | null;
    privilegedMembersCreated7d: number | null;
    suspiciousPublicEnvironmentNames: string[];
  };
  sections: {
    authentication: SecurityCheck[];
    credentials: SecurityCheck[];
    webhooks: SecurityCheck[];
    database: SecurityCheck[];
    apiProtection: SecurityCheck[];
    privacy: SecurityCheck[];
  };
  databaseSnapshot: {
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
  } | null;
  auditLogs: Array<{
    id: string;
    adminEmail: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    createdAt: string;
  }>;
  warnings: string[];
};

const sectionTabs: Array<{
  id: SecuritySectionKey;
  label: string;
}> = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "credentials", label: "Tokens & secrets" },
  { id: "webhooks", label: "Webhooks" },
  { id: "database", label: "Database / RLS" },
  { id: "apiProtection", label: "API protection" },
  { id: "privacy", label: "Data & privacy" },
  { id: "audit", label: "Audit logs" },
];

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function statusLabel(status: SecurityStatus) {
  if (status === "healthy") return "Healthy";
  if (status === "warning") return "Review";
  if (status === "critical") return "Critical";
  return "Info";
}

function statusClasses(status: SecurityStatus) {
  if (status === "healthy") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function StatusBadge({ status }: { status: SecurityStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${statusClasses(
        status,
      )}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function CheckList({ checks }: { checks: SecurityCheck[] }) {
  return (
    <div className="space-y-2">
      {checks.map((check) => (
        <div
          key={check.id}
          className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-bold text-slate-950">{check.label}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {check.detail}
            </p>
          </div>
          <StatusBadge status={check.status} />
        </div>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function SectionShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          {eyebrow}
        </p>
        <h3 className="mt-1 text-xl font-black text-slate-950">{title}</h3>
        <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

export function AdminSecurityCenter({
  adminMfaRequired,
}: {
  adminMfaRequired: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [activeSection, setActiveSection] =
    useState<SecuritySectionKey>("overview");
  const [data, setData] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/tenh-admin/security", {
        cache: "no-store",
      });
      const result = (await response.json()) as
        | SecurityData
        | { success?: false; error?: string };

      if (!response.ok || result.success !== true) {
        throw new Error(
          "error" in result && result.error
            ? result.error
            : "Unable to load TENH security diagnostics.",
        );
      }

      setData(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load TENH security diagnostics.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  const allChecks = useMemo(() => {
    if (!data) return [] as SecurityCheck[];
    return Object.values(data.sections).flat();
  }, [data]);

  const urgentChecks = allChecks.filter(
    (check) => check.status === "critical" || check.status === "warning",
  );

  async function signOutOtherSessions() {
    if (
      !window.confirm(
        "Sign out every other session for this TENH administrator account? This browser session will remain signed in.",
      )
    ) {
      return;
    }

    setSessionBusy(true);
    setSessionMessage(null);
    setError(null);

    try {
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "others",
      });

      if (signOutError) throw signOutError;

      setSessionMessage(
        "Other administrator sessions were revoked. This current session remains signed in.",
      );
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Unable to revoke other administrator sessions.",
      );
    } finally {
      setSessionBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
              Security center
            </p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">
              TENH platform security
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Read-only security diagnostics for administrator access, encrypted
              channel credentials, webhooks, database tenant isolation, API
              protections, privacy controls, and the existing TENH admin audit
              trail. Secret values are never displayed.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadSecurity()}
            disabled={loading}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Running checks..." : "Run all security checks"}
          </button>
        </div>

        {data ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Critical"
              value={data.summary.critical}
              detail="Fix immediately"
            />
            <MetricCard
              label="Review"
              value={data.summary.warning}
              detail="Needs attention"
            />
            <MetricCard
              label="Healthy"
              value={data.summary.healthy}
              detail="Checks passed"
            />
            <MetricCard
              label="Failed webhooks"
              value={data.metrics.failedWebhookEvents24h ?? "—"}
              detail="Last 24 hours"
            />
            <MetricCard
              label="Privileged members"
              value={data.metrics.privilegedMembersCreated7d ?? "—"}
              detail="New Owner/Admin in 7 days"
            />
          </div>
        ) : null}

        {data?.generatedAt ? (
          <p className="mt-4 text-xs text-slate-400">
            Last checked {formatDate(data.generatedAt)}
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {error}
          </div>
        ) : null}

        {data?.warnings?.length ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-bold">Diagnostic warnings</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex min-w-max gap-1">
          {sectionTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSection(tab.id)}
              className={`rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${
                activeSection === tab.id
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="rounded-[24px] border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Running TENH security checks...
        </div>
      ) : null}

      {data && activeSection === "overview" ? (
        <div className="space-y-5">
          {urgentChecks.length > 0 ? (
            <SectionShell
              eyebrow="Needs attention"
              title="Security alerts"
              description="Critical and review-level checks are collected here first. No automatic destructive action is taken."
            >
              <CheckList checks={urgentChecks} />
            </SectionShell>
          ) : (
            <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
              <p className="font-black">No critical or review-level checks right now.</p>
              <p className="mt-1">
                Continue monitoring after deployments, credential changes, and new
                database migrations.
              </p>
            </div>
          )}

          <SectionShell
            eyebrow="Current admin session"
            title="Authentication & session controls"
            description="These controls apply only to the protected TENH platform administrator account."
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Administrator"
                value={data.session.email ?? "—"}
                detail={`Current assurance ${data.session.currentAal.toUpperCase()}`}
              />
              <MetricCard
                label="Last sign-in"
                value={formatDate(data.session.lastSignInAt)}
                detail="Supabase Auth timestamp"
              />
              <MetricCard
                label="Session expires"
                value={formatDate(data.session.expiresAt)}
                detail="Current browser session"
              />
              <MetricCard
                label="Current IP"
                value={data.session.sourceIp ?? "Unavailable"}
                detail="Read from this request only; not stored by this page"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                Current device
              </p>
              <p className="mt-2 break-words text-sm leading-6 text-slate-700">
                {data.session.userAgent ?? "User-Agent unavailable"}
              </p>
              <button
                type="button"
                onClick={() => void signOutOtherSessions()}
                disabled={sessionBusy}
                className="mt-4 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                {sessionBusy ? "Revoking..." : "Sign out other admin sessions"}
              </button>
              {sessionMessage ? (
                <p className="mt-3 text-sm font-medium text-emerald-700">
                  {sessionMessage}
                </p>
              ) : null}
            </div>
          </SectionShell>

          <SectionShell
            eyebrow="Channel credentials"
            title="Protected connection summary"
            description="Only counts and health state are shown. Facebook Page access tokens, Telegram bot tokens, webhook secrets, PayWay keys, and Supabase secrets never leave the server."
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Facebook"
                value={data.metrics.activeFacebookConnections}
                detail={`${data.metrics.facebookCredentialProblems} credential issue(s)`}
              />
              <MetricCard
                label="Telegram"
                value={data.metrics.activeTelegramConnections}
                detail={`${data.metrics.telegramCredentialProblems} credential issue(s)`}
              />
              <MetricCard
                label="Stale webhooks"
                value={data.metrics.stalePendingWebhookEvents ?? "—"}
                detail="Pending more than 15 minutes"
              />
              <MetricCard
                label="Public secret vars"
                value={data.metrics.suspiciousPublicEnvironmentNames.length}
                detail="Suspicious NEXT_PUBLIC_* names"
              />
            </div>
          </SectionShell>
        </div>
      ) : null}

      {activeSection === "authentication" ? (
        <div className="space-y-5">
          {data ? (
            <SectionShell
              eyebrow="Authentication"
              title="Admin access checks"
              description="Server identity binding, verified email, MFA enforcement, and current assurance level."
            >
              <CheckList checks={data.sections.authentication} />
            </SectionShell>
          ) : null}

          <AdminSecurityPanel adminMfaRequired={adminMfaRequired} />
        </div>
      ) : null}

      {data && activeSection === "credentials" ? (
        <SectionShell
          eyebrow="Credentials"
          title="Tokens & secrets"
          description="Checks credential encryption, required server-side secrets, stored channel credential coverage, and accidental public environment exposure."
        >
          <CheckList checks={data.sections.credentials} />
        </SectionShell>
      ) : null}

      {data && activeSection === "webhooks" ? (
        <SectionShell
          eyebrow="Inbound security"
          title="Webhook protection"
          description="Facebook signature prerequisites, Telegram secret coverage, and recent trusted webhook processing health."
        >
          <CheckList checks={data.sections.webhooks} />
        </SectionShell>
      ) : null}

      {data && activeSection === "database" ? (
        <div className="space-y-5">
          <SectionShell
            eyebrow="Database"
            title="RLS & tenant isolation"
            description="Server-only PostgreSQL metadata checks for tenant tables and sensitive SECURITY DEFINER function grants."
          >
            <CheckList checks={data.sections.database} />
          </SectionShell>

          {data.databaseSnapshot?.tenantTables?.length ? (
            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-black text-slate-950">
                Tenant table RLS status
              </h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.08em] text-slate-400">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-2">Table</th>
                      <th className="border-b border-slate-200 px-3 py-2">RLS</th>
                      <th className="border-b border-slate-200 px-3 py-2">Force RLS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.databaseSnapshot.tenantTables.map((table) => (
                      <tr key={table.name ?? "unknown"}>
                        <td className="border-b border-slate-100 px-3 py-3 font-mono text-xs text-slate-700">
                          {table.name ?? "unknown"}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-3">
                          <StatusBadge
                            status={table.rlsEnabled ? "healthy" : "critical"}
                          />
                        </td>
                        <td className="border-b border-slate-100 px-3 py-3 text-slate-600">
                          {table.forceRls ? "Yes" : "No"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {data.databaseSnapshot?.securityDefinerExposures?.length ? (
            <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
              <h3 className="text-lg font-black text-amber-950">
                SECURITY DEFINER functions to review
              </h3>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                Authenticated access can be intentional, but every function below
                must enforce its own authorization. PUBLIC/anon execute access is
                treated as critical by the checks above.
              </p>
              <div className="mt-4 space-y-2">
                {data.databaseSnapshot.securityDefinerExposures.map(
                  (item, index) => (
                    <div
                      key={`${item.name ?? "function"}-${item.arguments ?? index}`}
                      className="rounded-xl border border-amber-200 bg-white p-3"
                    >
                      <p className="break-all font-mono text-xs font-bold text-slate-900">
                        {item.name ?? "unknown"}({item.arguments ?? ""})
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        PUBLIC: {item.publicExecute ? "EXECUTE" : "blocked"} · anon:{" "}
                        {item.anonExecute ? "EXECUTE" : "blocked"} · authenticated:{" "}
                        {item.authenticatedExecute ? "EXECUTE" : "blocked"}
                      </p>
                    </div>
                  ),
                )}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {data && activeSection === "apiProtection" ? (
        <SectionShell
          eyebrow="API security"
          title="Authorization, CSRF & abuse protection"
          description="Shows what TENH currently enforces and clearly marks protections that should be introduced only in a separately regression-tested release."
        >
          <CheckList checks={data.sections.apiProtection} />
        </SectionShell>
      ) : null}

      {data && activeSection === "privacy" ? (
        <SectionShell
          eyebrow="Data handling"
          title="Data & privacy security"
          description="Production HTTPS, diagnostic redaction, and explicit protection of the existing billing/manual-payment workflow."
        >
          <CheckList checks={data.sections.privacy} />
        </SectionShell>
      ) : null}

      {data && activeSection === "audit" ? (
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                Security audit trail
              </p>
              <h3 className="mt-1 text-xl font-black text-slate-950">
                Recent TENH admin actions
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Read-only view of the existing server-only tenh_admin_audit_logs
                table. Metadata containing billing/customer context is intentionally
                not returned here.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-400">
              Latest {data.auditLogs.length} records
            </span>
          </div>

          {data.auditLogs.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              No admin audit records are available.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.08em] text-slate-400">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2">Time</th>
                    <th className="border-b border-slate-200 px-3 py-2">Admin</th>
                    <th className="border-b border-slate-200 px-3 py-2">Action</th>
                    <th className="border-b border-slate-200 px-3 py-2">Resource</th>
                    <th className="border-b border-slate-200 px-3 py-2">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {data.auditLogs.map((row) => (
                    <tr key={row.id}>
                      <td className="border-b border-slate-100 px-3 py-3 text-xs text-slate-500">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-xs font-semibold text-slate-700">
                        {row.adminEmail}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 font-mono text-xs text-slate-800">
                        {row.action}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-xs text-slate-600">
                        {row.resourceType}
                      </td>
                      <td className="max-w-[260px] truncate border-b border-slate-100 px-3 py-3 font-mono text-xs text-slate-500">
                        {row.resourceId ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
