import Link from "next/link";

import { WorkspaceLanguageText } from "@/components/display/workspace-language-text";
import { IntegrationWorkspace } from "@/components/integrations/integration-workspace";
import { FacebookDisconnectButton } from "@/components/integrations/facebook-disconnect-button";
import { FacebookPageAvatar } from "@/components/integrations/facebook-page-avatar";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
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

function StatusDot({ tone = "green" }: { tone?: "green" | "amber" | "slate" }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        tone === "green"
          ? "bg-emerald-600"
          : tone === "amber"
            ? "bg-amber-700"
            : "bg-slate-400"
      }`}
      aria-hidden="true"
    />
  );
}

function tokenNeedsAttention(status: string | null) {
  const normalized = status?.trim().toLowerCase() ?? "";

  return [
    "expired",
    "invalid",
    "error",
    "revoked",
    "disconnected",
  ].some((value) => normalized.includes(value));
}


export default async function IntegrationsPage({
  searchParams,
}: IntegrationsPageProps) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return (
      <main className="h-full min-h-0 overflow-y-auto bg-white p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {authResult.error}
          </div>
        </div>
      </main>
    );
  }

  const currentMember = authResult.member;

  // Gated server-side: "none" must not be able to read the page at all,
  // not merely have its buttons hidden.
  const canManageChannels = await memberHasPermission(
    currentMember,
    "channels",
    "manage",
  );

  const canViewChannels =
    canManageChannels ||
    (await memberHasPermission(currentMember, "channels", "view"));

  if (!canViewChannels) {
    return (
      <main className="mx-auto w-full max-w-[1500px] px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-950">
            <WorkspaceLanguageText
              en="Integrations are not available"
              km="ការតភ្ជាប់មិនអាចប្រើបានទេ"
            />
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-600">
            <WorkspaceLanguageText
              en="You do not have access to channels in this workspace. If you own another workspace, switch to it to manage its connections."
              km="អ្នកមិនមានសិទ្ធិចូលប្រើឆានែលក្នុងកន្លែងធ្វើការនេះទេ។ ប្រសិនបើអ្នកមានកន្លែងធ្វើការផ្សេង សូមប្តូរទៅវាដើម្បីគ្រប់គ្រងការតភ្ជាប់។"
            />
          </p>
        </div>
      </main>
    );
  }
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


  return (
    <main className="h-full min-h-0 overflow-y-auto bg-white p-6">
      <IntegrationWorkspace canManageChannels={canManageChannels}>
        {!canManageChannels ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            <WorkspaceLanguageText
              en="View only. Manage permission is required to add or change connections."
              km="មើលបានតែប៉ុណ្ណោះ។ ត្រូវការសិទ្ធិ Manage ដើម្បីបន្ថែម ឬផ្លាស់ប្តូរការតភ្ជាប់។"
            />
          </div>
        ) : null}

        <div className="space-y-3">
          {facebookResult === "connected" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {resultMessage || (
                <WorkspaceLanguageText
                  en="Facebook Page connected successfully."
                  km="បានភ្ជាប់ Facebook Page ដោយជោគជ័យ។"
                />
              )}
            </div>
          ) : null}

          {facebookResult === "disconnected" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {resultMessage || (
                <WorkspaceLanguageText
                  en="Facebook Page disconnected. Conversation history was preserved."
                  km="បានផ្តាច់ Facebook Page។ ប្រវត្តិសន្ទនារបស់អ្នកត្រូវបានរក្សាទុក។"
                />
              )}
            </div>
          ) : null}

          {facebookResult === "error" ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {resultMessage || (
                <WorkspaceLanguageText
                  en="Unable to connect Facebook."
                  km="មិនអាចភ្ជាប់ Facebook បានទេ។"
                />
              )}
            </div>
          ) : null}

          {resultWarning ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {resultWarning}
            </div>
          ) : null}

          {facebookAccountsError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <WorkspaceLanguageText
                en="Unable to load Facebook connections:"
                km="មិនអាចផ្ទុកការតភ្ជាប់ Facebook បានទេ៖"
              />{" "}{facebookAccountsError.message}
            </div>
          ) : null}

          {visiblePages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <p className="font-semibold text-slate-900">
                <WorkspaceLanguageText
                  en="No Facebook Pages connected"
                  km="មិនទាន់មាន Facebook Page ដែលបានភ្ជាប់ទេ"
                />
              </p>
              <p className="mt-1 text-sm text-slate-500">
                <WorkspaceLanguageText
                  en="Connect a Page to receive Messenger messages and Facebook comments."
                  km="ភ្ជាប់ Page ដើម្បីទទួលសារ Messenger និងមតិយោបល់ Facebook។"
                />
              </p>
              <form action="/api/facebook/oauth/pages" method="get" className="mt-4">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-600"
                >
                  <WorkspaceLanguageText
                    en="+ Add Connection"
                    km="+ បន្ថែមការតភ្ជាប់"
                  />
                </button>
              </form>
            </div>
          ) : (
            <>
              {visiblePages.map((account) => {
                const pageId = account.platform_account_id;
                const pageName = account.account_name?.trim() || "Facebook Page";
                const tokenStatus = account.facebook_token_status?.trim() || "stored";
                const enabled = account.is_active === true;
                const tokenAttention = tokenNeedsAttention(account.facebook_token_status);
                const needsAttention = !enabled || tokenAttention;

                return (
                  <article
                    key={account.id}
                    className={`rounded-2xl border bg-white p-4 shadow-sm ${
                      needsAttention
                        ? "border-amber-400"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <FacebookPageAvatar
                          pageId={pageId}
                          pageName={pageName}
                        />

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-bold text-slate-950">
                              {pageName}
                            </h3>

                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                !enabled || tokenAttention
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-50 text-emerald-700"
                              }`}
                            >
                              {!enabled ? (
                                <WorkspaceLanguageText
                                  en="Disabled"
                                  km="បានបិទ"
                                />
                              ) : tokenAttention ? (
                                <WorkspaceLanguageText
                                  en="⚠ Needs attention"
                                  km="⚠ ត្រូវការពិនិត្យ"
                                />
                              ) : (
                                <WorkspaceLanguageText
                                  en="Connected"
                                  km="បានភ្ជាប់"
                                />
                              )}
                            </span>
                          </div>

                          <p className="mt-0.5 text-sm text-slate-500">
                            {needsAttention
                              ? !enabled
                                ? (
                                    <WorkspaceLanguageText
                                      en="Inbox is disabled for this workspace"
                                      km="ប្រអប់សារត្រូវបានបិទសម្រាប់កន្លែងធ្វើការនេះ"
                                    />
                                  )
                                : (
                                    <WorkspaceLanguageText
                                      en="Facebook authorization needs attention"
                                      km="ការអនុញ្ញាត Facebook ត្រូវការពិនិត្យ"
                                    />
                                  )
                              : (
                                  <WorkspaceLanguageText
                                    en="Messenger and comments are connected"
                                    km="Messenger និងមតិយោបល់ត្រូវបានភ្ជាប់"
                                  />
                                )}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {!enabled ? (
                          <Link
                            href="/dashboard/settings/users?tab=channels"
                            className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                          >
                            <WorkspaceLanguageText en="Enable channel" km="បើកឆានែល" />
                          </Link>
                        ) : tokenAttention && canManageChannels ? (
                          <a
                            href="/api/facebook/oauth/connect"
                            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                          >
                            <WorkspaceLanguageText en="Reconnect" km="ភ្ជាប់ឡើងវិញ" />
                          </a>
                        ) : (
                          <Link
                            href={`/dashboard/inbox?page=${encodeURIComponent(account.id)}`}
                            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                          >
                            <WorkspaceLanguageText en="Use in Inbox" km="ប្រើក្នុងប្រអប់សារ" />
                          </Link>
                        )}

                        {canManageChannels ? (
                        <details className="relative">
                          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-300 bg-white text-lg text-slate-700 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                            ⋯
                          </summary>

                          <div className="absolute right-0 top-full z-50 mt-1 w-[150px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">

                            <a
                              href="/api/facebook/oauth/connect"
                              className="block rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                            >
                              <WorkspaceLanguageText en="Reconnect" km="ភ្ជាប់ឡើងវិញ" />
                            </a>

                            <div className="my-1 border-t border-slate-100" />

                            <div className="px-1 py-1">
                              <FacebookDisconnectButton
                                socialAccountId={account.id}
                                pageName={pageName}
                              />
                            </div>
                          </div>
                        </details>
                        ) : null}
                      </div>
                    </div>

                    {needsAttention ? (
                      <div className="mt-3 rounded-xl bg-amber-100 px-3 py-3 text-sm text-amber-900">
                        {!enabled
                          ? (
                              <WorkspaceLanguageText
                                en="This Page is still connected, but Inbox access is disabled. Enable the channel to receive new messages again — your existing conversations stay preserved."
                                km="Page នេះនៅតែបានភ្ជាប់ ប៉ុន្តែការចូលប្រើប្រអប់សារត្រូវបានបិទ។ បើកឆានែលដើម្បីទទួលសារថ្មីម្តងទៀត — សន្ទនាដែលមានស្រាប់របស់អ្នកនៅតែត្រូវបានរក្សាទុក។"
                              />
                            )
                          : (
                              <WorkspaceLanguageText
                                en="Facebook authorization for this Page needs attention. Reconnect the Page to refresh access while keeping your TENH conversation history."
                                km="ការអនុញ្ញាត Facebook សម្រាប់ Page នេះត្រូវការពិនិត្យ។ ភ្ជាប់ Page ឡើងវិញដើម្បីធ្វើឱ្យសិទ្ធិចូលប្រើថ្មី ខណៈដែលប្រវត្តិសន្ទនា TENH របស់អ្នកនៅតែត្រូវបានរក្សាទុក។"
                              />
                            )}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-3 text-sm text-slate-700">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot tone={enabled ? "green" : "amber"} />
                        Messenger
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot tone={tokenAttention ? "amber" : "green"} />
                        <WorkspaceLanguageText en="Comments" km="មតិយោបល់" />
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot tone={tokenAttention ? "amber" : "green"} />
                        <WorkspaceLanguageText en="Token" km="ថូខិន" />{" "}
                        {tokenAttention ? tokenStatus : (
                          <WorkspaceLanguageText en="valid" km="មានសុពលភាព" />
                        )}
                      </span>
                      {pageId ? (
                        <span className="ml-auto hidden text-xs text-slate-400 sm:inline">
                          <WorkspaceLanguageText en="Page ID:" km="លេខសម្គាល់ Page:" />{" "}{pageId}
                        </span>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </>
          )}
        </div>
      </IntegrationWorkspace>
    </main>
  );
}
