import Link from "next/link";
import { cookies } from "next/headers";

import { WorkspaceLanguageText } from "@/components/display/workspace-language-text";
import { FacebookPageSelectUi } from "@/components/integrations/facebook-page-select-ui";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  decodeFacebookOAuthSession,
  FACEBOOK_OAUTH_SESSION_COOKIE,
} from "@/lib/facebook/facebook-oauth-session";
import { getFacebookAuthorizedPages } from "@/lib/facebook/facebook-authorized-pages";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function FacebookPageSelectPage() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return (
      <main className="min-h-screen bg-white px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {authResult.error}
        </div>
      </main>
    );
  }

  const currentMember = authResult.member;
  const cookieStore = await cookies();
  const encryptedSession = cookieStore.get(
    FACEBOOK_OAUTH_SESSION_COOKIE,
  )?.value;

  if (!encryptedSession) {
    return (
      <main className="min-h-screen bg-white px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            <WorkspaceLanguageText
              en="Your Facebook connection session expired. Start again from Integrations."
              km="សម័យភ្ជាប់ Facebook របស់អ្នកបានផុតកំណត់។ សូមចាប់ផ្តើមម្តងទៀតពី Integrations។"
            />
          </div>
          <Link
            href="/dashboard/integrations"
            className="mt-4 inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <WorkspaceLanguageText
              en="Back to Integrations"
              km="ត្រឡប់ទៅ Integrations"
            />
          </Link>
        </div>
      </main>
    );
  }

  let session;

  try {
    session = decodeFacebookOAuthSession(
      encryptedSession,
    );
  } catch {
    return (
      <main className="min-h-screen bg-white px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <WorkspaceLanguageText
            en="The Facebook connection session is invalid. Start again from Integrations."
            km="សម័យភ្ជាប់ Facebook នេះមិនត្រឹមត្រូវទេ។ សូមចាប់ផ្តើមម្តងទៀតពី Integrations។"
          />
        </div>
      </main>
    );
  }

  if (
    session.businessId !== currentMember.business_id ||
    session.memberId !== currentMember.id
  ) {
    return (
      <main className="min-h-screen bg-white px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <WorkspaceLanguageText
            en="This Facebook connection session belongs to a different TENH workspace or member."
            km="សម័យភ្ជាប់ Facebook នេះជារបស់ TENH workspace ឬសមាជិកផ្សេង។"
          />
        </div>
      </main>
    );
  }

  let pages: Awaited<
    ReturnType<typeof getFacebookAuthorizedPages>
  >["pages"] = [];
  let unresolvedTargetIds: string[] = [];
  let pageLoadError: string | null = null;

  try {
    const authorized = await getFacebookAuthorizedPages(
      session.userAccessToken,
    );
    pages = authorized.pages;
    unresolvedTargetIds = authorized.unresolvedTargetIds;
  } catch (error) {
    pageLoadError =
      error instanceof Error
        ? error.message
        : "Unable to load Facebook Pages.";
  }

  /*
   * Meta returns every Page this user administers, so the list alone cannot
   * tell the customer which Pages TENH already has. Load this workspace's own
   * rows and label each Page, so a Page that was just disconnected shows as
   * "Reconnect" and a Page that is still live shows as "Already connected"
   * instead of looking like a brand-new connection.
   */
  const authorizedPageIds = pages
    .map((page) => page.id)
    .filter(Boolean);

  let connectionByPageId = new Map<
    string,
    { isActive: boolean; tokenStatus: string }
  >();

  if (authorizedPageIds.length > 0) {
    const { data: workspacePages } = await supabaseAdmin
      .from("social_accounts")
      .select("platform_account_id,is_active,facebook_token_status")
      .eq("business_id", currentMember.business_id)
      .eq("platform", "facebook")
      .in("platform_account_id", authorizedPageIds);

    connectionByPageId = new Map(
      (workspacePages ?? [])
        .filter((row) => typeof row.platform_account_id === "string")
        .map((row) => [
          String(row.platform_account_id),
          {
            isActive: row.is_active === true,
            tokenStatus:
              typeof row.facebook_token_status === "string"
                ? row.facebook_token_status
                : "unknown",
          },
        ]),
    );
  }

  const safePages = pages.map((page) => {
    const connection = connectionByPageId.get(page.id);
    const connectionState: "new" | "connected" | "reconnect" = !connection
      ? "new"
      : connection.isActive && connection.tokenStatus !== "disconnected"
        ? "connected"
        : "reconnect";

    return {
      id: page.id,
      name: page.name || "Facebook Page",
      ready: Boolean(page.access_token),
      connectionState,
    };
  });

  return (
    <main className="h-[100dvh] overflow-y-auto bg-white px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1380px]">
        <header className="border-b border-slate-200 pb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Link
                href="/dashboard/integrations"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-blue-600 transition hover:bg-blue-50"
                aria-label="Back to Integrations"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>

              <div className="min-w-0">
                <p className="text-sm font-bold text-blue-600">
                  <WorkspaceLanguageText
                    en="Facebook integration"
                    km="ការភ្ជាប់ Facebook"
                  />
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 xl:absolute xl:left-1/2 xl:-translate-x-1/2">
              <div className="flex items-center gap-2 text-slate-500">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-blue-600">
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="m3.5 8.3 2.6 2.7 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="text-sm font-semibold">
                  <WorkspaceLanguageText
                    en="Authorize"
                    km="អនុញ្ញាត"
                  />
                </span>
              </div>

              <span className="hidden h-px w-5 bg-slate-300 sm:block" />

              <div className="flex items-center gap-2 text-blue-700">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  2
                </span>
                <span className="text-sm font-bold">
                  <WorkspaceLanguageText
                    en="Choose Pages"
                    km="ជ្រើសរើស Page"
                  />
                </span>
              </div>

              <span className="hidden h-px w-5 bg-slate-300 sm:block" />

              <div className="flex items-center gap-2 text-slate-500">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-bold">
                  3
                </span>
                <span className="text-sm font-semibold">
                  <WorkspaceLanguageText
                    en="Review & Connect"
                    km="ពិនិត្យ និងភ្ជាប់"
                  />
                </span>
              </div>
            </div>
          </div>
        </header>

        <section className="pt-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <div>
              <h1 className="text-[26px] font-bold tracking-[-0.03em] text-slate-950 sm:text-[30px]">
                <WorkspaceLanguageText
                  en="Choose Pages to connect"
                  km="ជ្រើសរើស Page ដើម្បីភ្ជាប់"
                />
              </h1>
              <p className="mt-1 text-sm text-slate-500 sm:text-base">
                <WorkspaceLanguageText
                  en="Each Page gets its own Messenger inbox and comment sync."
                  km="Page នីមួយៗមានប្រអប់សារ Messenger និងការធ្វើសមកាលកម្មមតិយោបល់ផ្ទាល់ខ្លួន។"
                />

              </p>
            </div>

          
          </div>

          {pageLoadError ? (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {pageLoadError}
            </div>
          ) : safePages.length === 0 ? (
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
                <WorkspaceLanguageText
                  en="Facebook returned no Pages authorized for TENH. Reconnect Page access and select at least one Page in Facebook."
                  km="Facebook មិនបានត្រឡប់ Page ណាមួយដែលអនុញ្ញាតសម្រាប់ TENH ទេ។ សូមភ្ជាប់សិទ្ធិ Page ម្តងទៀត ហើយជ្រើសរើសយ៉ាងហោចណាស់មួយ Page នៅក្នុង Facebook។"
                />
              </div>
              <Link
                href="/api/facebook/oauth/connect"
                className="inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <WorkspaceLanguageText
                  en="Reconnect Page access"
                  km="ភ្ជាប់សិទ្ធិ Page ម្តងទៀត"
                />
              </Link>
            </div>
          ) : (
            <FacebookPageSelectUi
              pages={safePages}
              unresolvedCount={unresolvedTargetIds.length}
            />
          )}
        </section>
      </div>
    </main>
  );
}
