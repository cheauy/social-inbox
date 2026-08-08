import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  cookies,
} from "next/headers";

import {
  encryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime =
  "nodejs";

const OAUTH_STATE_COOKIE =
  "tenh_facebook_oauth_state";

type TokenResult = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;

  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

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

async function readJson<T>(
  response: Response,
): Promise<T> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  return JSON.parse(
    text,
  ) as T;
}

function redirectWithResult(
  request: NextRequest,
  key: "connected" | "error",
  value: string,
) {
  const url =
    new URL(
      "/dashboard/integrations",
      request.nextUrl.origin,
    );

  url.searchParams.set(
    "facebook",
    key === "connected"
      ? "connected"
      : "error",
  );

  if (key === "error") {
    url.searchParams.set(
      "message",
      value,
    );
  }

  return NextResponse.redirect(
    url,
  );
}

export async function GET(
  request: NextRequest,
) {
  const cookieStore =
    await cookies();

  const expectedState =
    cookieStore.get(
      OAUTH_STATE_COOKIE,
    )?.value;

  cookieStore.delete(
    OAUTH_STATE_COOKIE,
  );

  const state =
    request.nextUrl.searchParams.get(
      "state",
    );

  const code =
    request.nextUrl.searchParams.get(
      "code",
    );

  const oauthError =
    request.nextUrl.searchParams.get(
      "error_message",
    ) ??
    request.nextUrl.searchParams.get(
      "error_description",
    );

  if (oauthError) {
    return redirectWithResult(
      request,
      "error",
      oauthError,
    );
  }

  if (
    !state ||
    !expectedState ||
    state !== expectedState
  ) {
    return redirectWithResult(
      request,
      "error",
      "Invalid Facebook OAuth state.",
    );
  }

  if (!code) {
    return redirectWithResult(
      request,
      "error",
      "Facebook did not return an authorization code.",
    );
  }

  const appId =
    process.env
      .FACEBOOK_APP_ID?.trim();

  const appSecret =
    process.env
      .FACEBOOK_APP_SECRET?.trim();

  const configuredPageId =
    process.env
      .FACEBOOK_PAGE_ID?.trim();

  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION ??
    "v26.0";

  if (
    !appId ||
    !appSecret ||
    !configuredPageId
  ) {
    return redirectWithResult(
      request,
      "error",
      "Facebook OAuth environment variables are incomplete.",
    );
  }

  const redirectUri =
    new URL(
      "/api/facebook/oauth/callback",
      request.nextUrl.origin,
    ).toString();

  try {
    /*
     * 1) OAuth authorization code -> User Access Token.
     */
    const codeExchangeUrl =
      new URL(
        `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
      );

    codeExchangeUrl.searchParams.set(
      "client_id",
      appId,
    );

    codeExchangeUrl.searchParams.set(
      "client_secret",
      appSecret,
    );

    codeExchangeUrl.searchParams.set(
      "redirect_uri",
      redirectUri,
    );

    codeExchangeUrl.searchParams.set(
      "code",
      code,
    );

    const codeExchangeResponse =
      await fetch(
        codeExchangeUrl,
        {
          method: "GET",
          cache: "no-store",
        },
      );

    const shortTokenResult =
      await readJson<TokenResult>(
        codeExchangeResponse,
      );

    if (
      !codeExchangeResponse.ok ||
      !shortTokenResult.access_token
    ) {
      throw new Error(
        shortTokenResult.error?.message ??
          "Unable to exchange Facebook authorization code.",
      );
    }

    /*
     * 2) Exchange the User token for a long-lived User token.
     */
    const longTokenUrl =
      new URL(
        `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
      );

    longTokenUrl.searchParams.set(
      "grant_type",
      "fb_exchange_token",
    );

    longTokenUrl.searchParams.set(
      "client_id",
      appId,
    );

    longTokenUrl.searchParams.set(
      "client_secret",
      appSecret,
    );

    longTokenUrl.searchParams.set(
      "fb_exchange_token",
      shortTokenResult
        .access_token,
    );

    const longTokenResponse =
      await fetch(
        longTokenUrl,
        {
          method: "GET",
          cache: "no-store",
        },
      );

    const longTokenResult =
      await readJson<TokenResult>(
        longTokenResponse,
      );

    if (
      !longTokenResponse.ok ||
      !longTokenResult.access_token
    ) {
      throw new Error(
        longTokenResult.error?.message ??
          "Unable to exchange Facebook User token.",
      );
    }

    const longUserToken =
      longTokenResult.access_token;

    /*
     * 3) User token -> Pages the user can manage, including
     *    each Page Access Token.
     */
    const accountsUrl =
      new URL(
        `https://graph.facebook.com/${graphVersion}/me/accounts`,
      );

    accountsUrl.searchParams.set(
      "fields",
      "id,name,access_token,tasks",
    );

    accountsUrl.searchParams.set(
      "access_token",
      longUserToken,
    );

    const accountsResponse =
      await fetch(
        accountsUrl,
        {
          method: "GET",
          cache: "no-store",
        },
      );

    const accountsResult =
      await readJson<AccountsResult>(
        accountsResponse,
      );

    if (!accountsResponse.ok) {
      throw new Error(
        accountsResult.error?.message ??
          "Unable to load Facebook Pages.",
      );
    }

    const selectedPage =
      accountsResult.data?.find(
        (page) =>
          page.id ===
          configuredPageId,
      );

    if (
      !selectedPage?.id ||
      !selectedPage.access_token
    ) {
      throw new Error(
        `Facebook Page ${configuredPageId} was not returned by /me/accounts. Make sure the Facebook user has access to that Page.`,
      );
    }

    /*
     * 4) Save encrypted tokens in your existing social_accounts row.
     */
    const userTokenExpiresAt =
      longTokenResult.expires_in
        ? new Date(
            Date.now() +
              longTokenResult.expires_in *
                1000,
          ).toISOString()
        : null;

    const {
      data: updatedAccount,
      error: updateError,
    } = await supabaseAdmin
      .from("social_accounts")
      .update({
        facebook_page_name:
          selectedPage.name ??
          null,

        facebook_page_access_token_encrypted:
          encryptFacebookToken(
            selectedPage.access_token,
          ),

        facebook_user_access_token_encrypted:
          encryptFacebookToken(
            longUserToken,
          ),

        facebook_user_token_expires_at:
          userTokenExpiresAt,

        facebook_connected_at:
          new Date().toISOString(),

        facebook_token_status:
          "connected",

        facebook_token_last_error:
          null,

        is_active:
          true,
      })
      .eq(
        "platform",
        "facebook",
      )
      .eq(
        "platform_account_id",
        selectedPage.id,
      )
      .select("id")
      .maybeSingle();

    if (
      updateError ||
      !updatedAccount
    ) {
      throw new Error(
        updateError?.message ??
          `No social_accounts row exists for Facebook Page ${selectedPage.id}.`,
      );
    }

    /*
     * 5) Best-effort webhook subscription.
     *    Your Page may already be subscribed; this keeps it configured.
     */
    const subscribeUrl =
      new URL(
        `https://graph.facebook.com/${graphVersion}/${selectedPage.id}/subscribed_apps`,
      );

    subscribeUrl.searchParams.set(
      "subscribed_fields",
      [
        "messages",
        "feed",
        "messaging_postbacks",
        "message_reads",
        "message_deliveries",
      ].join(","),
    );

    subscribeUrl.searchParams.set(
      "access_token",
      selectedPage.access_token,
    );

    const subscribeResponse =
      await fetch(
        subscribeUrl,
        {
          method: "POST",
          cache: "no-store",
        },
      );

    if (!subscribeResponse.ok) {
      console.warn(
        "Facebook connected, but subscribed_apps update failed:",
        await subscribeResponse.text(),
      );
    }

    return redirectWithResult(
      request,
      "connected",
      "success",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to connect Facebook.";

    console.error(
      "Facebook OAuth callback failed:",
      error,
    );

    /*
     * Mark the current configured Page connection as error.
     * Do not throw again if this status write fails.
     */
    await supabaseAdmin
      .from("social_accounts")
      .update({
        facebook_token_status:
          "error",

        facebook_token_last_error:
          message,
      })
      .eq(
        "platform",
        "facebook",
      )
      .eq(
        "platform_account_id",
        configuredPageId,
      );

    return redirectWithResult(
      request,
      "error",
      message,
    );
  }
}