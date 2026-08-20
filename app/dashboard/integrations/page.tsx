import Link from "next/link";

import { IntegrationWorkspace } from "@/components/integrations/integration-workspace";
import { FacebookDisconnectButton } from "@/components/integrations/facebook-disconnect-button";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type FacebookSocialAccount = {
  id: string;
  platform: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean | null;
  facebook_token_status: string | null;
};

type IntegrationsPageProps = {
  searchParams?: Promise<{
    facebook?: string | string[];
    message?: string | string[];
    warning?: string | string[];
  }>;
};

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        ok ? "bg-emerald-500" : "bg-slate-300"
      }`}
      aria-hidden="true"
    />
  );
}

export default async function IntegrationsPage({
  searchParams,
}: IntegrationsPageProps) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return (
      <main className="h-full min-h-0 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {authResult.error}
          </div>
        </div>
      </main>
    );
  }

  const currentMember = authResult.member;
  const params = searchParams ? await searchParams : {};
  const facebookResult = singleParam(params.facebook);
  const resultMessage = singleParam(params.message);
  const resultWarning = singleParam(params.warning);

  const {
    data: facebookAccounts,
    error: facebookAccountsError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      platform,
      platform_account_id,
      account_name,
      is_active,
      facebook_token_status
    `)
    .eq("business_id", currentMember.business_id)
    .eq("platform", "facebook")
    .order("created_at", { ascending: true })
    .returns<FacebookSocialAccount[]>();

  /*
   * Capacity-disabled Pages stay connected in TENH and keep their token/history.
   * Fully disconnected Pages are hidden from the customer-facing integration list.
   */
  const visiblePages = (facebookAccounts ?? []).filter(
    (account) => account.facebook_token_status !== "disconnected",
  );
  const activePages = visiblePages.filter(
    (account) => account.is_active === true,
  );

  return (
    <main className="h-full min-h-0 overflow-y-auto p-6">
      <IntegrationWorkspace>
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
              <p className="mt-1 text-sm text-slate-500">
                Connect and manage the social accounts used by your business.
              </p>
            </div>

            <form
              action="/api/facebook/oauth/pages"
              method="get"
            >
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                + Add Facebook Page
              </button>
            </form>
          </div>

          {facebookResult === "connected" ? (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {resultMessage || "Facebook Page connected successfully."}
            </div>
          ) : null}

          {facebookResult === "disconnected" ? (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {resultMessage ||
                "Facebook Page disconnected. Conversation history was preserved."}
            </div>
          ) : null}

          {facebookResult === "error" ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {resultMessage || "Unable to connect Facebook."}
            </div>
          ) : null}

          {resultWarning ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {resultWarning}
            </div>
          ) : null}

          {facebookAccountsError ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Unable to load Facebook connections: {facebookAccountsError.message}
            </div>
          ) : null}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl shadow-sm">
                  <img
                    src="/images/channels/messenger.png"
                    alt="Messenger"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-slate-900">Facebook Pages</h2>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        activePages.length > 0
                          ? "bg-emerald-50 text-emerald-700"
                          : visiblePages.length > 0
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {activePages.length > 0
                        ? "Connected"
                        : visiblePages.length > 0
                          ? "Disabled"
                          : "Not connected"}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-slate-500">
                    Each connected Page keeps its own Messenger, comments, tokens, and conversations.
                  </p>
                </div>
              </div>
            </div>

            {visiblePages.length === 0 ? (
              <div className="p-8 text-center">
                <p className="font-semibold text-slate-900">No Facebook Pages connected</p>
                <p className="mt-1 text-sm text-slate-500">
                  Connect a Page to receive Messenger messages and Facebook comments.
                </p>
              </div>
            ) : (
              <div className="max-h-[380px] divide-y divide-slate-200 overflow-y-auto overscroll-contain">
                {visiblePages.map((account) => {
                  const pageId = account.platform_account_id;
                  const pageName = account.account_name?.trim() || "Facebook Page";
                  const tokenStatus = account.facebook_token_status?.trim() || "stored";
                  const enabled = account.is_active === true;

                  return (
                    <div
                      key={account.id}
                      className={`p-6 ${enabled ? "bg-white" : "bg-amber-50/35"}`}
                    >
                      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-bold text-slate-900">{pageName}</h3>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                enabled
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              <StatusDot ok={enabled} />
                              {enabled ? "Connected" : "Disabled"}
                            </span>
                          </div>

                          <p className="mt-1 break-all text-sm text-slate-500">
                            Page ID: {pageId || "Missing"}
                          </p>

                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 font-medium text-slate-700">
                              <StatusDot ok={enabled} />
                              Messenger
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 font-medium text-slate-700">
                              <StatusDot ok={enabled} />
                              Comments
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 font-medium text-slate-700">
                              Token: {tokenStatus}
                            </span>
                          </div>

                          {!enabled ? (
                            <p className="mt-3 text-xs font-medium text-amber-700">
                              This Page is disabled in subscription usage. It does not use a channel slot and cannot be opened in Inbox.
                            </p>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {enabled ? (
                            <Link
                              href={`/dashboard/inbox?page=${encodeURIComponent(account.id)}`}
                              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                            >
                              Use in Inbox
                            </Link>
                          ) : (
                            <Link
                              href="/dashboard/settings/users?tab=channels"
                              className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
                            >
                              Enable channel
                            </Link>
                          )}

                          {pageId ? (
                            <a
                              href={`https://www.facebook.com/${pageId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              Open Page
                            </a>
                          ) : null}

                          {enabled ? (
                            <form
                              action="/api/facebook/comments/sync"
                              method="post"
                            >
                              <input
                                type="hidden"
                                name="socialAccountId"
                                value={account.id}
                              />
                              <button
                                type="submit"
                                className="inline-flex items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-100"
                              >
                                Sync comments
                              </button>
                            </form>
                          ) : null}

                          <a
                            href="/api/facebook/oauth/connect"
                            className="inline-flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                          >
                            Reconnect
                          </a>

                          <FacebookDisconnectButton
                            socialAccountId={account.id}
                            pageName={pageName}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </IntegrationWorkspace>
    </main>
  );
}
