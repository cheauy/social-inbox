import "server-only";

import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";

export type FacebookCustomerProfileResult = {
  fullName: string | null;
  profilePictureUrl: string | null;
  source: string | null;
  sources: string[];
  errors: string[];
  permissionHint: string | null;
};

function cleanString(
  value: unknown,
) {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : null;
}

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function pictureFromRecord(
  value: Record<string, unknown>,
) {
  const direct =
    cleanString(
      value.profile_pic,
    ) ??
    cleanString(
      value.profile_picture_url,
    );

  if (direct) {
    return direct;
  }

  if (
    isRecord(value.picture) &&
    isRecord(
      value.picture.data,
    )
  ) {
    return cleanString(
      value.picture.data.url,
    );
  }

  return null;
}

function profileFromParty(
  value: unknown,
  customerId: string,
) {
  if (!isRecord(value)) {
    return null;
  }

  if (
    cleanString(value.id) !==
    customerId
  ) {
    return null;
  }

  const joinedName = [
    cleanString(
      value.first_name,
    ),
    cleanString(
      value.last_name,
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const fullName =
    cleanString(value.name) ??
    cleanString(
      value.full_name,
    ) ??
    (joinedName || null);

  return {
    fullName,
    profilePictureUrl:
      pictureFromRecord(value),
  };
}

function findCustomerParty(
  value: unknown,
  customerId: string,
  depth = 0,
): {
  fullName: string | null;
  profilePictureUrl:
    | string
    | null;
} | null {
  if (!value || depth > 7) {
    return null;
  }

  let fullName: string | null =
    null;
  let profilePictureUrl:
    | string
    | null = null;

  const merge = (
    candidate:
      | {
          fullName: string | null;
          profilePictureUrl:
            | string
            | null;
        }
      | null,
  ) => {
    if (!candidate) {
      return;
    }

    fullName =
      fullName ??
      candidate.fullName;
    profilePictureUrl =
      profilePictureUrl ??
      candidate.profilePictureUrl;
  };

  merge(
    profileFromParty(
      value,
      customerId,
    ),
  );

  if (
    fullName &&
    profilePictureUrl
  ) {
    return {
      fullName,
      profilePictureUrl,
    };
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      merge(
        findCustomerParty(
          item,
          customerId,
          depth + 1,
        ),
      );

      if (
        fullName &&
        profilePictureUrl
      ) {
        break;
      }
    }
  } else if (
    isRecord(value)
  ) {
    for (
      const nested of
      Object.values(value)
    ) {
      if (
        !nested ||
        typeof nested !==
          "object"
      ) {
        continue;
      }

      merge(
        findCustomerParty(
          nested,
          customerId,
          depth + 1,
        ),
      );

      if (
        fullName &&
        profilePictureUrl
      ) {
        break;
      }
    }
  }

  if (
    !fullName &&
    !profilePictureUrl
  ) {
    return null;
  }

  return {
    fullName,
    profilePictureUrl,
  };
}

async function graphGet({
  path,
  token,
  params,
}: {
  path: string;
  token: string;
  params?: Record<
    string,
    string
  >;
}) {
  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION ??
    "v26.0";

  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${path}`,
  );

  for (
    const [
      key,
      value,
    ] of
    Object.entries(params ?? {})
  ) {
    url.searchParams.set(
      key,
      value,
    );
  }

  url.searchParams.set(
    "access_token",
    token,
  );

  const response =
    await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

  const text =
    await response.text();

  let result:
    Record<string, unknown> =
    {};

  if (text.trim()) {
    try {
      result =
        JSON.parse(text) as
          Record<
            string,
            unknown
          >;
    } catch {
      return {
        ok: false,
        status:
          response.status,
        result: {},
        error:
          `Facebook returned invalid JSON (${response.status}).`,
        errorType: null,
        errorCode: null,
        errorSubcode: null,
      };
    }
  }

  const errorValue =
    isRecord(
      result.error,
    )
      ? (result.error as
          Record<
            string,
            unknown
          >)
      : null;

  return {
    ok:
      response.ok &&
      !errorValue,
    status:
      response.status,
    result,
    error:
      cleanString(
        errorValue
          ?.message,
      ),
    errorType:
      cleanString(
        errorValue
          ?.type,
      ),
    errorCode:
      typeof errorValue
        ?.code ===
        "number"
        ? errorValue.code
        : null,
    errorSubcode:
      typeof errorValue
        ?.error_subcode ===
        "number"
        ? errorValue.error_subcode
        : null,
  };
}

function graphErrorText(
  label: string,
  result: {
    status: number;
    error: string | null;
    errorType?: string | null;
    errorCode?: number | null;
    errorSubcode?: number | null;
  },
) {
  const details = [
    `HTTP ${result.status}`,
    result.errorType ?? null,
    result.errorCode != null
      ? `code ${result.errorCode}`
      : null,
    result.errorSubcode != null
      ? `subcode ${result.errorSubcode}`
      : null,
  ].filter(Boolean);

  return `${label} [${details.join(", ")}]: ${
    result.error ??
    "Facebook rejected the request."
  }`;
}

export async function getFacebookCustomerProfile({
  pageId,
  customerId,
  latestMessageId,
}: {
  pageId: string;
  customerId: string;
  latestMessageId?:
    | string
    | null;
}): Promise<FacebookCustomerProfileResult> {
  const errors: string[] =
    [];

  let token: string;

  try {
    token =
      await getFacebookPageAccessToken(
        pageId,
      );
  } catch (error) {
    return {
      fullName: null,
      profilePictureUrl:
        null,
      source: null,
      sources: [],
      errors: [
        error instanceof Error
          ? error.message
          : "No Facebook Page access token is available.",
      ],
      permissionHint:
        "Reconnect Facebook from Integrations if TENH can no longer read the Page-accessible Messenger data.",
    };
  }

  let fullName: string | null =
    null;
  let profilePictureUrl:
    | string
    | null = null;
  const sources: string[] =
    [];

  const mergeProfile = (
    profile:
      | {
          fullName: string | null;
          profilePictureUrl:
            | string
            | null;
        }
      | null,
    sourceName: string,
  ) => {
    if (!profile) {
      return;
    }

    const contributedName =
      !fullName &&
      Boolean(profile.fullName);
    const contributedPicture =
      !profilePictureUrl &&
      Boolean(
        profile.profilePictureUrl,
      );

    fullName =
      fullName ??
      profile.fullName;
    profilePictureUrl =
      profilePictureUrl ??
      profile.profilePictureUrl;

    if (
      (contributedName ||
        contributedPicture) &&
      !sources.includes(
        sourceName,
      )
    ) {
      sources.push(
        sourceName,
      );
    }
  };

  /*
   * V3.1.13 PROFILE CLEANUP
   * -----------------------
   * V3.1.12 proved this Page/customer returns GraphMethodException
   * code 100 / subcode 33 for direct /{PSID} profile and picture
   * requests. Those probes are intentionally removed here.
   *
   * TENH now uses only Page-accessible message/conversation payloads.
   * A profile photo is opportunistic: if Meta supplies one, TENH saves
   * it. If not, the UI keeps the existing initial-avatar fallback.
   *
   * Performance rule: once a usable customer name is found, do NOT make
   * another Graph request only to chase a photo that Meta did not expose.
   */
  if (latestMessageId?.trim()) {
    const messageLookup =
      await graphGet({
        path:
          latestMessageId.trim(),
        token,
        params: {
          fields:
            "id,created_time,from,to,message",
        },
      });

    if (messageLookup.ok) {
      mergeProfile(
        findCustomerParty(
          messageLookup.result,
          customerId,
        ),
        "message-detail",
      );
    } else if (
      messageLookup.error
    ) {
      errors.push(
        graphErrorText(
          "Message detail",
          messageLookup,
        ),
      );
    }
  }

  /*
   * Only use the Conversations API when TENH still has no name.
   * Do not spend another network round-trip only for a missing photo.
   */
  if (!fullName) {
    const conversationLookup =
      await graphGet({
        path:
          `${pageId}/conversations`,
        token,
        params: {
          user_id:
            customerId,
          fields:
            "id,updated_time",
          limit:
            "1",
        },
      });

    if (conversationLookup.ok) {
      const data =
        Array.isArray(
          conversationLookup
            .result.data,
        )
          ? conversationLookup
              .result.data
          : [];

      const conversationId =
        data.length > 0 &&
        isRecord(data[0])
          ? cleanString(
              data[0].id,
            )
          : null;

      if (conversationId) {
        const messagesLookup =
          await graphGet({
            path:
              `${conversationId}/messages`,
            token,
            params: {
              fields:
                "id,created_time,from,to,message",
              limit:
                "25",
            },
          });

        if (messagesLookup.ok) {
          mergeProfile(
            findCustomerParty(
              messagesLookup.result,
              customerId,
            ),
            "conversations-api",
          );
        } else if (
          messagesLookup.error
        ) {
          errors.push(
            graphErrorText(
              "Conversation messages",
              messagesLookup,
            ),
          );
        }
      } else {
        errors.push(
          "Conversations API returned no Page/customer conversation.",
        );
      }
    } else if (
      conversationLookup.error
    ) {
      errors.push(
        graphErrorText(
          "Conversations API",
          conversationLookup,
        ),
      );
    }
  }

  const source =
    sources.length > 0
      ? sources.join(" + ")
      : null;

  return {
    fullName,
    profilePictureUrl,
    source,
    sources,
    errors,
    permissionHint:
      profilePictureUrl
        ? null
        : "Meta did not expose a customer photo through the Page-accessible message/conversation payloads TENH can read. Keep profile_picture_url null and use the initial-avatar fallback; save a photo later only if Meta includes one in a future accessible payload.",
  };
}
