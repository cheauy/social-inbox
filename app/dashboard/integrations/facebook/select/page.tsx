import Link from "next/link";
import {
  cookies,
} from "next/headers";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  decodeFacebookOAuthSession,
  FACEBOOK_OAUTH_SESSION_COOKIE,
} from "@/lib/facebook/facebook-oauth-session";
import {
  getFacebookAuthorizedPages,
} from "@/lib/facebook/facebook-authorized-pages";

export const dynamic = "force-dynamic";

export default async function FacebookPageSelectPage() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return (
      <main className="p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
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
      <main className="p-6">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            Your Facebook connection session expired. Start again from Integrations.
          </div>
          <Link
            href="/dashboard/integrations"
            className="mt-4 inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Integrations
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
      <main className="p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          The Facebook connection session is invalid. Start again from Integrations.
        </div>
      </main>
    );
  }

  if (
    session.businessId !== currentMember.business_id ||
    session.memberId !== currentMember.id
  ) {
    return (
      <main className="p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          This Facebook connection session belongs to a different TENH workspace or member.
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

  return (
    <main className="p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <p className="text-sm font-semibold text-blue-600">
            Facebook integration
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Choose Pages for this TENH workspace
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Select one or more Facebook Pages to connect to this TENH workspace.
          </p>
        </div>

        {pageLoadError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {pageLoadError}
          </div>
        ) : pages.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
              Facebook returned no Pages authorized for TENH. Reconnect Page access and select at least one Page in Facebook.
            </div>
            <Link
              href="/api/facebook/oauth/connect"
              className="inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Reconnect Page access
            </Link>
          </div>
        ) : (
          <form
            action="/api/facebook/oauth/select"
            method="post"
            className="space-y-4"
          >
            {unresolvedTargetIds.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Facebook authorized {unresolvedTargetIds.length} additional Page{unresolvedTargetIds.length === 1 ? "" : "s"}, but Meta did not allow TENH to resolve the Page details yet. Reconnect Page access and verify the required Facebook permissions.
              </div>
            ) : null}

            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="max-h-[300px] overflow-y-auto overscroll-contain pr-1">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {pages.map((page) => (
                    <label
                      key={page.id}
                      className="relative block cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="pageId"
                        value={page.id}
                        className="peer absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 cursor-pointer accent-blue-600"
                      />

                      <div className="flex min-h-[88px] items-center gap-3 rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-3 transition hover:border-blue-300 hover:bg-blue-50/30 peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:ring-1 peer-checked:ring-blue-500">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white shadow-sm">
                          f
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {page.name || "Facebook Page"}
                          </p>
                          <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                            <span className="flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-[10px] font-bold text-white">
                              f
                            </span>
                            <span>Facebook</span>
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-400">
                            Page ID: {page.id}
                          </p>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Link
                href="/api/facebook/oauth/connect"
                className="text-sm font-semibold text-blue-600 transition hover:text-blue-700"
              >
                Reconnect Page access
              </Link>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard/integrations"
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Connect
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
