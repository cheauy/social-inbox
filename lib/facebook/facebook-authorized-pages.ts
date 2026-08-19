export type FacebookAuthorizedPage = {
  id: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
};

type FacebookGraphError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
};

type AccountsResult = {
  data?: Array<{
    id?: string;
    name?: string;
    access_token?: string;
    tasks?: string[];
  }>;
  paging?: {
    cursors?: {
      after?: string;
    };
  };
  error?: FacebookGraphError;
};

type PageResult = {
  id?: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
  error?: FacebookGraphError;
};

type DebugTokenResult = {
  data?: {
    is_valid?: boolean;
    app_id?: string;
    scopes?: string[];
    granular_scopes?: Array<{
      scope?: string;
      target_ids?: Array<string | number>;
    }>;
  };
  error?: FacebookGraphError;
};

export type FacebookAuthorizedPagesResult = {
  pages: FacebookAuthorizedPage[];
  authorizedTargetIds: string[];
  unresolvedTargetIds: string[];
};

function getGraphVersion() {
  return (
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
    "v26.0"
  );
}

async function parseJson<T>(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

async function getPagesFromMeAccounts(
  userAccessToken: string,
): Promise<FacebookAuthorizedPage[]> {
  const url = new URL(
    `https://graph.facebook.com/${getGraphVersion()}/me/accounts`,
  );
  url.searchParams.set(
    "fields",
    "id,name,access_token,tasks",
  );
  url.searchParams.set("limit", "100");

  const pages: FacebookAuthorizedPage[] = [];
  let after: string | undefined;

  for (let requestNumber = 0; requestNumber < 20; requestNumber += 1) {
    if (after) {
      url.searchParams.set("after", after);
    } else {
      url.searchParams.delete("after");
    }

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    });

    const payload = await parseJson<AccountsResult>(response);

    if (!response.ok || payload.error) {
      throw new Error(
        payload.error?.message ??
          "Unable to load Facebook Pages from /me/accounts.",
      );
    }

    for (const page of payload.data ?? []) {
      const id = page.id?.trim();

      if (!id) {
        continue;
      }

      pages.push({
        id,
        name: page.name,
        access_token: page.access_token,
        tasks: page.tasks,
      });
    }

    const nextAfter =
      payload.paging?.cursors?.after?.trim();

    if (!nextAfter || nextAfter === after) {
      break;
    }

    after = nextAfter;
  }

  return pages;
}

async function getAuthorizedTargetIds(
  userAccessToken: string,
): Promise<string[]> {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();

  // Keep the old /me/accounts behavior as a safe fallback when the app
  // credentials are not available in this server environment.
  if (!appId || !appSecret) {
    return [];
  }

  const url = new URL(
    `https://graph.facebook.com/${getGraphVersion()}/debug_token`,
  );
  url.searchParams.set("input_token", userAccessToken);

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${appId}|${appSecret}`,
    },
  });

  const payload = await parseJson<DebugTokenResult>(response);

  if (!response.ok || payload.error || payload.data?.is_valid === false) {
    console.warn(
      "[TENH Facebook OAuth] Unable to read granular Page authorization:",
      payload.error?.message ?? "Facebook token debug failed.",
    );
    return [];
  }

  const granularScopes = payload.data?.granular_scopes ?? [];

  // pages_show_list is the clearest representation of which Pages the user
  // selected in Facebook's Page asset picker. Prefer it when Meta returns it.
  const showListTargetIds = granularScopes
    .filter((item) => item.scope === "pages_show_list")
    .flatMap((item) => item.target_ids ?? [])
    .map(String)
    .map((id) => id.trim())
    .filter(Boolean);

  const sourceIds =
    showListTargetIds.length > 0
      ? showListTargetIds
      : granularScopes
          .filter((item) => item.scope?.startsWith("pages_"))
          .flatMap((item) => item.target_ids ?? [])
          .map(String)
          .map((id) => id.trim())
          .filter(Boolean);

  return [...new Set(sourceIds)];
}

async function getPageById(
  pageId: string,
  userAccessToken: string,
): Promise<FacebookAuthorizedPage | null> {
  const withTokenUrl = new URL(
    `https://graph.facebook.com/${getGraphVersion()}/${encodeURIComponent(pageId)}`,
  );
  withTokenUrl.searchParams.set(
    "fields",
    "id,name,access_token,tasks",
  );

  const response = await fetch(withTokenUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
    },
  });

  const payload = await parseJson<PageResult>(response);

  if (response.ok && !payload.error && payload.id) {
    return {
      id: payload.id,
      name: payload.name,
      access_token: payload.access_token,
      tasks: payload.tasks,
    };
  }

  // Some Page access combinations reject access_token/tasks in a field
  // expansion while still allowing the Page identity to be read. Keep the
  // authorized Page visible so TENH can report the real Meta authorization
  // instead of silently dropping it from the selector.
  const identityUrl = new URL(
    `https://graph.facebook.com/${getGraphVersion()}/${encodeURIComponent(pageId)}`,
  );
  identityUrl.searchParams.set("fields", "id,name");

  const identityResponse = await fetch(identityUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
    },
  });

  const identityPayload = await parseJson<PageResult>(identityResponse);

  if (
    identityResponse.ok &&
    !identityPayload.error &&
    identityPayload.id
  ) {
    return {
      id: identityPayload.id,
      name: identityPayload.name,
    };
  }

  console.warn(
    `[TENH Facebook OAuth] Authorized Page ${pageId} could not be resolved:`,
    payload.error?.message ??
      identityPayload.error?.message ??
      "Unknown Graph API error",
  );

  return null;
}

export async function getFacebookAuthorizedPages(
  userAccessToken: string,
): Promise<FacebookAuthorizedPagesResult> {
  // /me/accounts remains useful because it normally returns the Page access
  // token directly. However, Facebook Login for Business can authorize Page
  // target IDs that /me/accounts does not include, so it cannot be the only
  // source of truth for the Page picker.
  const accountPages = await getPagesFromMeAccounts(userAccessToken);
  const accountPagesById = new Map(
    accountPages.map((page) => [page.id, page]),
  );

  const authorizedTargetIds = await getAuthorizedTargetIds(
    userAccessToken,
  );

  // Older/non-granular Facebook tokens may not expose target_ids. In that
  // case preserve the previous behavior rather than breaking connections.
  if (authorizedTargetIds.length === 0) {
    return {
      pages: accountPages,
      authorizedTargetIds: accountPages.map((page) => page.id),
      unresolvedTargetIds: [],
    };
  }

  const pages: FacebookAuthorizedPage[] = [];
  const unresolvedTargetIds: string[] = [];

  for (const pageId of authorizedTargetIds) {
    const fromAccounts = accountPagesById.get(pageId);

    if (fromAccounts) {
      pages.push(fromAccounts);
      continue;
    }

    const resolved = await getPageById(
      pageId,
      userAccessToken,
    );

    if (resolved) {
      pages.push(resolved);
    } else {
      unresolvedTargetIds.push(pageId);
    }
  }

  return {
    pages,
    authorizedTargetIds,
    unresolvedTargetIds,
  };
}
