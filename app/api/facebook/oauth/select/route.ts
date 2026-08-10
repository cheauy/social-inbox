import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  cookies,
} from "next/headers";

import {
  getCurrentMember,
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
        "Unable to load Facebook Pages.",
    );
  }

  return payload.data ?? [];
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
        platform_account_id
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
      throw new Error(
        "This Facebook Page is already connected to another TENH workspace.",
      );
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
