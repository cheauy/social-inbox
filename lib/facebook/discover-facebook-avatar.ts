import "server-only";

import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  sanitizeFacebookDiagnosticValue,
} from "@/lib/facebook/sanitize-facebook-diagnostic";

export type FacebookAvatarDiscoveryAttempt = {
  label: string;
  ok: boolean;
  status: number;
  path: string;
  fields: string | null;
  matchedCustomer: boolean;
  matchedCustomerKeys: string[];
  discoveredAvatarUrl: string | null;
  responseShape: unknown;
  error: string | null;
};

export type FacebookAvatarDiscoveryResult = {
  avatarUrl: string | null;
  source: string | null;
  conversationId: string | null;
  attempts: FacebookAvatarDiscoveryAttempt[];
  notes: string[];
};

type GraphResult = {
  ok: boolean;
  status: number;
  result: Record<string, unknown>;
  error: string | null;
};

type PartyMatch = {
  matched: boolean;
  keys: string[];
  avatarUrl: string | null;
};

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: unknown) {
  const text = cleanString(value);

  if (!text) {
    return null;
  }

  try {
    const parsed = new URL(text);

    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function avatarFromPartyRecord(value: Record<string, unknown>) {
  const directKeys = [
    "profile_pic",
    "profile_picture_url",
    "profile_picture",
    "avatar_url",
    "avatar",
  ];

  for (const key of directKeys) {
    const candidate = isHttpUrl(value[key]);

    if (candidate) {
      return candidate;
    }
  }

  const picture = value.picture;

  if (isRecord(picture)) {
    const directPicture = isHttpUrl(picture.url);

    if (directPicture) {
      return directPicture;
    }

    if (isRecord(picture.data)) {
      const nestedPicture = isHttpUrl(picture.data.url);

      if (nestedPicture) {
        return nestedPicture;
      }
    }
  }

  return null;
}

function findMatchingCustomerParty(
  value: unknown,
  customerId: string,
  depth = 0,
): PartyMatch {
  if (!value || depth > 8) {
    return {
      matched: false,
      keys: [],
      avatarUrl: null,
    };
  }

  if (Array.isArray(value)) {
    let matched = false;
    let keys: string[] = [];
    let avatarUrl: string | null = null;

    for (const item of value) {
      const found = findMatchingCustomerParty(item, customerId, depth + 1);

      matched = matched || found.matched;
      keys = Array.from(new Set([...keys, ...found.keys]));
      avatarUrl = avatarUrl ?? found.avatarUrl;

      if (avatarUrl) {
        break;
      }
    }

    return {
      matched,
      keys,
      avatarUrl,
    };
  }

  if (!isRecord(value)) {
    return {
      matched: false,
      keys: [],
      avatarUrl: null,
    };
  }

  let matched = cleanString(value.id) === customerId;
  let keys = matched ? Object.keys(value).sort() : [];
  let avatarUrl = matched ? avatarFromPartyRecord(value) : null;

  for (const nested of Object.values(value)) {
    if (!nested || typeof nested !== "object") {
      continue;
    }

    const found = findMatchingCustomerParty(nested, customerId, depth + 1);

    matched = matched || found.matched;
    keys = Array.from(new Set([...keys, ...found.keys]));
    avatarUrl = avatarUrl ?? found.avatarUrl;

    if (avatarUrl) {
      break;
    }
  }

  return {
    matched,
    keys,
    avatarUrl,
  };
}

function safeShape(value: unknown): unknown {
  return sanitizeFacebookDiagnosticValue(value);
}

async function graphGet({
  path,
  token,
  params,
}: {
  path: string;
  token: string;
  params?: Record<string, string>;
}): Promise<GraphResult> {
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";

  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${path}`,
  );

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  url.searchParams.set("access_token", token);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    const text = await response.text();
    let result: Record<string, unknown> = {};

    if (text.trim()) {
      try {
        result = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {
          ok: false,
          status: response.status,
          result: {},
          error: `Facebook returned invalid JSON (${response.status}).`,
        };
      }
    }

    const graphError = isRecord(result.error) ? result.error : null;

    return {
      ok: response.ok && !graphError,
      status: response.status,
      result,
      error:
        cleanString(graphError?.message) ??
        (!response.ok ? `Facebook returned HTTP ${response.status}.` : null),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      result: {},
      error:
        error instanceof Error
          ? error.message
          : "Facebook request failed.",
    };
  }
}

export async function discoverFacebookAvatar({
  pageId,
  customerId,
  latestMessageId,
  latestCommentId,
}: {
  pageId: string;
  customerId: string;
  latestMessageId?: string | null;
  latestCommentId?: string | null;
}): Promise<FacebookAvatarDiscoveryResult> {
  const attempts: FacebookAvatarDiscoveryAttempt[] = [];
  const notes: string[] = [];

  let token: string;

  try {
    token = await getFacebookPageAccessToken(pageId);
  } catch (error) {
    return {
      avatarUrl: null,
      source: null,
      conversationId: null,
      attempts: [],
      notes: [
        error instanceof Error
          ? error.message
          : "Unable to load Facebook Page access token.",
      ],
    };
  }

  let avatarUrl: string | null = null;
  let avatarSource: string | null = null;
  let conversationId: string | null = null;

  const runAttempt = async ({
    label,
    path,
    params,
  }: {
    label: string;
    path: string;
    params?: Record<string, string>;
  }) => {
    const response = await graphGet({
      path,
      token,
      params,
    });

    const match = response.ok
      ? findMatchingCustomerParty(response.result, customerId)
      : {
          matched: false,
          keys: [],
          avatarUrl: null,
        };

    if (!avatarUrl && match.avatarUrl) {
      avatarUrl = match.avatarUrl;
      avatarSource = label;
    }

    attempts.push({
      label,
      ok: response.ok,
      status: response.status,
      path,
      fields: params?.fields ?? null,
      matchedCustomer: match.matched,
      matchedCustomerKeys: match.keys,
      discoveredAvatarUrl: match.avatarUrl,
      responseShape: safeShape(response.result),
      error: response.error,
    });

    return response;
  };

  /*
   * The official Meta Conversations API supports locating a Page conversation
   * using the customer's Page-scoped ID. V3.1.14 stays on those Page-accessible
   * surfaces and does NOT retry the rejected direct /{PSID} profile endpoints.
   */
  const conversationLookup = await runAttempt({
    label: "conversation-lookup",
    path: `${pageId}/conversations`,
    params: {
      user_id: customerId,
      fields: "id,link,updated_time",
      limit: "1",
    },
  });

  if (conversationLookup.ok) {
    const data = Array.isArray(conversationLookup.result.data)
      ? conversationLookup.result.data
      : [];

    if (data.length > 0 && isRecord(data[0])) {
      conversationId = cleanString(data[0].id);
    }
  }

  if (conversationId) {
    await runAttempt({
      label: "conversation-participants-basic",
      path: conversationId,
      params: {
        fields: "id,participants",
      },
    });

    await runAttempt({
      label: "conversation-participants-expanded-picture",
      path: conversationId,
      params: {
        fields: "id,participants{id,name,picture}",
      },
    });

    await runAttempt({
      label: "conversation-messages-basic",
      path: `${conversationId}/messages`,
      params: {
        fields: "id,created_time,from,to",
        limit: "25",
      },
    });

    await runAttempt({
      label: "conversation-messages-expanded-picture",
      path: `${conversationId}/messages`,
      params: {
        fields:
          "id,created_time,from{id,name,picture},to{id,name,picture}",
        limit: "25",
      },
    });
  } else {
    notes.push(
      "The Page Conversations API returned no conversation ID for this customer.",
    );
  }

  if (latestMessageId?.trim()) {
    await runAttempt({
      label: "message-detail-basic",
      path: latestMessageId.trim(),
      params: {
        fields: "id,created_time,from,to,reply_to",
      },
    });

    await runAttempt({
      label: "message-detail-expanded-picture",
      path: latestMessageId.trim(),
      params: {
        fields:
          "id,created_time,from{id,name,picture},to{id,name,picture},reply_to",
      },
    });
  }

  if (latestCommentId?.trim()) {
    await runAttempt({
      label: "comment-detail-basic",
      path: latestCommentId.trim(),
      params: {
        fields: "id,from,created_time",
      },
    });

    await runAttempt({
      label: "comment-detail-expanded-picture",
      path: latestCommentId.trim(),
      params: {
        fields: "id,from{id,name,picture},created_time",
      },
    });
  }

  if (!avatarUrl) {
    notes.push(
      "No customer avatar URL was exposed by the tested Page-accessible conversation/message/comment shapes.",
    );
    notes.push(
      "Check matchedCustomerKeys and responseShape to see exactly which fields Meta returned for the customer object.",
    );
  }

  return {
    avatarUrl,
    source: avatarSource,
    conversationId,
    attempts,
    notes,
  };
}
