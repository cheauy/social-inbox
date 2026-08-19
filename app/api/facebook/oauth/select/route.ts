import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  cookies,
} from "next/headers";

import {
  getCurrentMember,
  TENH_ACTIVE_BUSINESS_COOKIE,
} from "@/lib/auth/get-current-member";
import {
  encryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";
import {
  decodeFacebookOAuthSession,
  FACEBOOK_OAUTH_SESSION_COOKIE,
} from "@/lib/facebook/facebook-oauth-session";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  canActivateAnotherChannel,
} from "@/lib/subscription/get-business-entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FacebookPage = {
  id?: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
};

type AccountsResult = {
  data?: FacebookPage[];
  paging?: {
    cursors?: {
      after?: string;
    };
  };
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

function redirectToIntegrations(
  request: NextRequest,
  params: {
    facebook: "connected" | "error";
    message?: string;
    warning?: string;
  },
) {
  const url = new URL(
    "/dashboard/integrations",
    request.nextUrl.origin,
  );

  url.searchParams.set(
    "facebook",
    params.facebook,
  );

  if (params.message) {
    url.searchParams.set(
      "message",
      params.message,
    );
  }

  if (params.warning) {
    url.searchParams.set(
      "warning",
      params.warning,
    );
  }

  return NextResponse.redirect(url, 303);
}

async function readAccountsPage(
  url: URL,
  userAccessToken: string,
) {
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
        "Unable to load Facebook Pages authorized for TENH.",
    );
  }

  return payload;
}

async function getPagesWithTokens(
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
    "id,name,access_token,tasks",
  );
  url.searchParams.set("limit", "100");

  const pages: FacebookPage[] = [];
  let after: string | undefined;

  // Facebook Login for Business can authorize many Pages. Follow cursor
  // pagination so TENH can find any Page selected in Meta's asset picker.
  for (let requestNumber = 0; requestNumber < 20; requestNumber += 1) {
    if (after) {
      url.searchParams.set("after", after);
    } else {
      url.searchParams.delete("after");
    }

    const payload = await readAccountsPage(
      url,
      userAccessToken,
    );

    pages.push(...(payload.data ?? []));

    const nextAfter =
      payload.paging?.cursors?.after?.trim();

    if (!nextAfter || nextAfter === after) {
      break;
    }

    after = nextAfter;
  }

  return pages;
}

async function subscribePage({
  pageId,
  pageAccessToken,
}: {
  pageId: string;
  pageAccessToken: string;
}) {
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
    "v26.0";

  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`,
  );
  url.searchParams.set(
    "subscribed_fields",
    [
      "messages",
      "feed",
      "messaging_postbacks",
      "message_reads",
      "message_deliveries",
    ].join(","),
  );

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${pageAccessToken}`,
    },
  });

  return response.ok;
}

export async function POST(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return redirectToIntegrations(request, {
      facebook: "error",
      message: authResult.error,
    });
  }

  const currentMember = authResult.member;
  const cookieStore = await cookies();
  const encryptedSession = cookieStore.get(
    FACEBOOK_OAUTH_SESSION_COOKIE,
  )?.value;

  if (!encryptedSession) {
    return redirectToIntegrations(request, {
      facebook: "error",
      message:
        "Your Facebook connection session expired. Start again.",
    });
  }

  let session;

  try {
    session = decodeFacebookOAuthSession(
      encryptedSession,
    );
  } catch {
    cookieStore.delete(
      FACEBOOK_OAUTH_SESSION_COOKIE,
    );

    return redirectToIntegrations(request, {
      facebook: "error",
      message:
        "The Facebook connection session is invalid. Start again.",
    });
  }

  if (
    session.businessId !==
      currentMember.business_id ||
    session.memberId !== currentMember.id
  ) {
    cookieStore.delete(
      FACEBOOK_OAUTH_SESSION_COOKIE,
    );

    return redirectToIntegrations(request, {
      facebook: "error",
      message:
        "This Facebook connection session belongs to a different TENH workspace or member.",
    });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return redirectToIntegrations(request, {
      facebook: "error",
      message: "Invalid Page selection.",
    });
  }

  const selectedPageIdRaw = formData.get(
    "pageId",
  );
  const selectedPageId =
    typeof selectedPageIdRaw === "string"
      ? selectedPageIdRaw.trim()
      : "";

  if (!selectedPageId) {
    return redirectToIntegrations(request, {
      facebook: "error",
      message: "Choose a Facebook Page first.",
    });
  }

  try {
    const managedPages = await getPagesWithTokens(
      session.userAccessToken,
    );

    const selectedPage = managedPages.find(
      (page) => page.id === selectedPageId,
    );

    if (
      !selectedPage?.id ||
      !selectedPage.access_token
    ) {
      throw new Error(
        "The selected Page was not returned by Facebook for this account. Start the connection again.",
      );
    }

    // Prevent one Facebook Page from being attached to two TENH workspaces.
    const {
      data: existingPage,
      error: existingPageError,
    } = await supabaseAdmin
      .from("social_accounts")
      .select(`
        id,
        business_id,
        platform_account_id,
        is_active
      `)
      .eq("platform", "facebook")
      .eq(
        "platform_account_id",
        selectedPage.id,
      )
      .maybeSingle();

    if (existingPageError) {
      throw new Error(existingPageError.message);
    }

    if (
      existingPage &&
      existingPage.business_id !==
        currentMember.business_id
    ) {
      /*
       * V3.11.31 — verified duplicate Page = join existing subscription.
       *
       * Facebook just returned this Page + Page access token from /me/accounts,
       * so this authenticated Facebook user proved they can manage the Page.
       * Do NOT duplicate or move the Page connection. Join the existing TENH
       * subscription as an Agent and switch the active subscription instead.
       */
      const { data: joinedRows, error: joinError } =
        await supabaseAdmin.rpc(
          "tenh_join_subscription_as_agent",
          {
            p_user_id: authResult.user.id,
            p_business_id:
              existingPage.business_id,
            p_full_name:
              currentMember.full_name,
            p_email:
              currentMember.email ||
              authResult.user.email ||
              "",
          },
        );

      if (joinError) {
        throw new Error(joinError.message);
      }

      const joined = Array.isArray(joinedRows)
        ? joinedRows[0]
        : joinedRows;

      if (!joined) {
        throw new Error(
          "Unable to join the existing TENH subscription for this Facebook Page.",
        );
      }

      cookieStore.set(
        TENH_ACTIVE_BUSINESS_COOKIE,
        existingPage.business_id,
        {
          httpOnly: true,
          sameSite: "lax",
          secure:
            process.env.NODE_ENV ===
            "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        },
      );

      cookieStore.delete(
        FACEBOOK_OAUTH_SESSION_COOKIE,
      );

      return redirectToIntegrations(request, {
        facebook: "connected",
        message:
          joined.role === "owner"
            ? "This Facebook Page already belongs to one of your TENH subscriptions. TENH switched to that subscription."
            : "This Facebook Page already belongs to an existing TENH subscription. You joined that subscription as an Agent.",
      });
    }

    // Only the Owner may attach a brand-new Page to this subscription.
    // An Agent can use channels already connected by the Owner.
    if (currentMember.role !== "owner") {
      throw new Error(
        "Only the subscription Owner can connect a new Facebook Page. You can use Pages already connected to subscriptions where you are an Agent.",
      );
    }

    // V3.8.2 — a new active Page consumes one channel slot.
    // Reconnecting an already-active Page does not consume another slot.
    const consumesNewChannelSlot =
      !existingPage || existingPage.is_active !== true;

    if (consumesNewChannelSlot) {
      const entitlement =
        await canActivateAnotherChannel(
          currentMember.business_id,
        );

      if (!entitlement.allowed) {
        throw new Error(
          entitlement.message ??
            "Your TENH plan does not allow another Facebook Page connection.",
        );
      }
    }

    const now = new Date().toISOString();
    const connectionData = {
      business_id: currentMember.business_id,
      platform: "facebook",
      platform_account_id: selectedPage.id,
      account_name:
        selectedPage.name ?? "Facebook Page",
      facebook_page_name:
        selectedPage.name ?? null,
      facebook_page_access_token_encrypted:
        encryptFacebookToken(
          selectedPage.access_token,
        ),
      facebook_user_access_token_encrypted:
        encryptFacebookToken(
          session.userAccessToken,
        ),
      facebook_user_token_expires_at:
        session.userTokenExpiresAt,
      facebook_connected_at: now,
      facebook_token_status: "connected",
      facebook_token_last_error: null,
      is_active: true,
    };

    let savedAccountId: string;

    if (existingPage) {
      const {
        data: updatedAccount,
        error: updateError,
      } = await supabaseAdmin
        .from("social_accounts")
        .update(connectionData)
        .eq("id", existingPage.id)
        .eq(
          "business_id",
          currentMember.business_id,
        )
        .select("id")
        .single();

      if (updateError || !updatedAccount) {
        throw new Error(
          updateError?.message ??
            "Unable to update the Facebook Page connection.",
        );
      }

      savedAccountId = updatedAccount.id;
    } else {
      const {
        data: insertedAccount,
        error: insertError,
      } = await supabaseAdmin
        .from("social_accounts")
        .insert(connectionData)
        .select("id")
        .single();

      if (insertError || !insertedAccount) {
        throw new Error(
          insertError?.message ??
            "Unable to save the Facebook Page connection.",
        );
      }

      savedAccountId = insertedAccount.id;
    }

    // V3.1.17 — keep every connected Facebook Page active.
    // Reconnecting an existing Page refreshes only that Page's tokens.
    // Adding another Page must NOT deactivate the previous Page.

    const subscribed = await subscribePage({
      pageId: selectedPage.id,
      pageAccessToken:
        selectedPage.access_token,
    });

    cookieStore.delete(
      FACEBOOK_OAUTH_SESSION_COOKIE,
    );

    if (!subscribed) {
      await supabaseAdmin
        .from("social_accounts")
        .update({
          facebook_token_last_error:
            "Facebook connected, but the webhook subscription could not be refreshed.",
        })
        .eq("id", savedAccountId);

      return redirectToIntegrations(request, {
        facebook: "connected",
        warning:
          "Facebook connected, but the webhook subscription could not be refreshed. Open Webhook status to verify it.",
      });
    }

    return redirectToIntegrations(request, {
      facebook: "connected",
    });
  } catch (error) {
    cookieStore.delete(
      FACEBOOK_OAUTH_SESSION_COOKIE,
    );

    console.error(
      "[Tenh Facebook OAuth] Page selection failed:",
      error instanceof Error
        ? error.message
        : "Unknown error",
    );

    return redirectToIntegrations(request, {
      facebook: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to connect the selected Facebook Page.",
    });
  }
}
