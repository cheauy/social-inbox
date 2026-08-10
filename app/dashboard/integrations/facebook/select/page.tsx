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

export const dynamic = "force-dynamic";

type FacebookPage = {
  id?: string;
  name?: string;
  tasks?: string[];
};

type AccountsResult = {
  data?: FacebookPage[];
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

async function getManagedPages(
  userAccessToken: string,
) {
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
    "v26.0";

  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/me/accounts`,
  );
  url.searchParams.set(
    "fields",
    "id,name,tasks",
  );

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
    },
  });

  const text = await response.text();
  let payload: AccountsResult = {};

  if (text.trim()) {
    try {
      payload = JSON.parse(text) as AccountsResult;
    } catch {
      payload = {};
    }
  }

  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message ??
        "Unable to load the Facebook Pages you manage.",
    );
  }

  return (payload.data ?? []).filter(
    (page): page is Required<
      Pick<FacebookPage, "id">
    > & FacebookPage => Boolean(page.id),
  );
}

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
        <div className="mx-auto max-w-3xl">
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
    session.businessId !==
      currentMember.business_id ||
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
    ReturnType<typeof getManagedPages>
  > = [];
  let pageLoadError: string | null = null;

  try {
    pages = await getManagedPages(
      session.userAccessToken,
    );
  } catch (error) {
    pageLoadError =
      error instanceof Error
        ? error.message
        : "Unable to load Facebook Pages.";
  }

  return (
    <main className="p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <p className="text-sm font-semibold text-blue-600">
            Facebook integration
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Choose a Facebook Page
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Choose one Page to add or reconnect now. Pages already connected to this TENH workspace stay connected. The list comes from the Pages your Facebook account is allowed to manage.
          </p>
        </div>

        {pageLoadError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {pageLoadError}
          </div>
        ) : pages.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            Facebook returned no Pages that this account can manage. Check the Facebook account/Page access and try again.
          </div>
        ) : (
          <form
            action="/api/facebook/oauth/select"
            method="post"
            className="space-y-4"
          >
            <div className="space-y-3">
              {pages.map((page, index) => (
                <label
                  key={page.id}
                  className="flex cursor-pointer items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/30"
                >
                  <input
                    type="radio"
                    name="pageId"
                    value={page.id}
                    defaultChecked={index === 0}
                    required
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />

                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">
                      f
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        {page.name || "Facebook Page"}
                      </p>
                      <p className="mt-1 break-all text-xs text-slate-500">
                        Page ID: {page.id}
                      </p>
                      {page.tasks?.length ? (
                        <p className="mt-2 text-xs text-slate-400">
                          Access: {page.tasks.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <Link
                href="/dashboard/integrations"
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </Link>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Add / reconnect selected Page
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
