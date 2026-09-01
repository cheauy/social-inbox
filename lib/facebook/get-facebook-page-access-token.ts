import "server-only";

import {
  decryptFacebookToken,
  encryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

type FacebookTokenError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type FacebookPageTokenResult = {
  id?: string;
  name?: string;
  access_token?: string;
  error?: FacebookTokenError;
};

type FacebookTokenRow = {
  id: string;
  business_id: string;
  account_name: string | null;
  is_active: boolean | null;
  facebook_page_access_token_encrypted: string | null;
  facebook_user_access_token_encrypted: string | null;
  facebook_user_token_expires_at: string | null;
  facebook_token_status: string | null;
};

function getPageId(
  pageIdInput?: string,
) {
  const pageId =
    pageIdInput?.trim() ||
    process.env
      .FACEBOOK_PAGE_ID?.trim();

  if (!pageId) {
    throw new Error(
      "Facebook Page ID is missing.",
    );
  }

  return pageId;
}

function userTokenIsExpired(
  expiresAt: string | null,
) {
  if (!expiresAt) {
    return false;
  }

  const timestamp =
    Date.parse(expiresAt);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return timestamp <= Date.now();
}

async function readGraphJson<T>(
  response: Response,
): Promise<T> {
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

async function loadFacebookTokenRow(
  pageId: string,
): Promise<FacebookTokenRow | null> {
  const {
    data,
    error,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      business_id,
      account_name,
      is_active,
      facebook_page_access_token_encrypted,
      facebook_user_access_token_encrypted,
      facebook_user_token_expires_at,
      facebook_token_status
    `)
    .eq(
      "platform",
      "facebook",
    )
    .eq(
      "platform_account_id",
      pageId,
    )
    .maybeSingle<FacebookTokenRow>();

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return data ?? null;
}

async function saveFacebookTokenError({
  socialAccountId,
  message,
}: {
  socialAccountId: string;
  message: string;
}) {
  const { error } =
    await supabaseAdmin
      .from("social_accounts")
      .update({
        facebook_token_last_error:
          message,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        socialAccountId,
      );

  if (error) {
    console.warn(
      "[TENH Facebook Token] Unable to save token diagnostic:",
      error.message,
    );
  }
}

function facebookStatusNeedsAttention(status: string | null) {
  const normalized = status?.trim().toLowerCase() ?? "";

  return [
    "expired",
    "invalid",
    "error",
    "revoked",
  ].some((value) => normalized.includes(value));
}

async function notifyFacebookReauthorizationRequired({
  socialAccount,
  message,
}: {
  socialAccount: FacebookTokenRow;
  message: string;
}) {
  // Notify only on the transition from a healthy-looking connection to a
  // real reauthorization problem. The hourly watchdog can run repeatedly
  // without spamming Owners with the same alert.
  if (facebookStatusNeedsAttention(socialAccount.facebook_token_status)) {
    return;
  }

  const { data: owners, error: ownerError } = await supabaseAdmin
    .from("team_members")
    .select("id")
    .eq("business_id", socialAccount.business_id)
    .eq("role", "owner")
    .eq("is_active", true);

  if (ownerError) {
    console.warn(
      "[TENH Facebook Token] Unable to load Owners for reauthorization notification:",
      ownerError.message,
    );
    return;
  }

  const pageName = socialAccount.account_name?.trim() || "Facebook Page";
  const rows = (owners ?? []).map((owner) => ({
    business_id: socialAccount.business_id,
    recipient_member_id: owner.id,
    actor_member_id: null,
    notification_type: "facebook_reauthorization_required",
    title: "Facebook needs reconnection",
    body: `${pageName} needs Facebook authorization again. ${message}`.slice(0, 1500),
    link: `/dashboard/integrations?facebookPage=${encodeURIComponent(
      socialAccount.id,
    )}`,
    room_id: null,
    conversation_id: null,
    contact_id: null,
    is_read: false,
    read_at: null,
  }));

  if (rows.length === 0) {
    return;
  }

  const { error: notificationError } = await supabaseAdmin
    .from("team_notifications")
    .insert(rows);

  if (notificationError) {
    console.warn(
      "[TENH Facebook Token] Unable to notify Owners about Facebook reauthorization:",
      notificationError.message,
    );
  }
}

async function resolveFacebookReauthorizationNotifications(
  socialAccount: FacebookTokenRow,
) {
  const now = new Date().toISOString();
  const link = `/dashboard/integrations?facebookPage=${encodeURIComponent(
    socialAccount.id,
  )}`;

  const { error } = await supabaseAdmin
    .from("team_notifications")
    .update({
      is_read: true,
      read_at: now,
    })
    .eq("business_id", socialAccount.business_id)
    .eq("notification_type", "facebook_reauthorization_required")
    .eq("link", link)
    .eq("is_read", false);

  if (error) {
    console.warn(
      "[TENH Facebook Token] Unable to resolve Facebook reauthorization notification:",
      error.message,
    );
  }
}

async function markFacebookAuthorizationNeedsAttention({
  socialAccount,
  status,
  message,
}: {
  socialAccount: FacebookTokenRow;
  status: "expired" | "invalid" | "revoked";
  message: string;
}) {
  await notifyFacebookReauthorizationRequired({
    socialAccount,
    message,
  });

  const { error } = await supabaseAdmin
    .from("social_accounts")
    .update({
      facebook_token_status: status,
      facebook_token_last_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", socialAccount.id);

  if (error) {
    console.warn(
      "[TENH Facebook Token] Unable to mark Facebook authorization for attention:",
      error.message,
    );
  }
}

export function isFacebookAccessTokenError(
  error?: {
    code?: number;
  } | null,
) {
  return (
    error?.code === 190 ||
    error?.code === 102
  );
}

/*
 * Re-derive a Page Access Token from TENH's already-authorized,
 * encrypted User Access Token.
 *
 * This does NOT bypass Meta authorization. It only repairs a stale Page
 * token while the user's Facebook authorization is still valid. If Meta has
 * revoked/expired the User token or the user no longer has Page access,
 * explicit Facebook reauthorization is still required.
 *
 * The existing Page token is never cleared on a failed recovery attempt.
 * That keeps webhook/history/channel state intact and makes this safe to call
 * as a one-time retry after Meta returns an invalid-token error.
 */
export async function refreshFacebookPageAccessToken(
  pageIdInput?: string,
): Promise<string> {
  const pageId =
    getPageId(pageIdInput);
  const socialAccount =
    await loadFacebookTokenRow(
      pageId,
    );

  if (
    !socialAccount ||
    !socialAccount.is_active ||
    socialAccount.facebook_token_status ===
      "disconnected"
  ) {
    throw new Error(
      "Facebook Page is not connected. Reconnect Facebook from Integrations.",
    );
  }

  if (
    !socialAccount
      .facebook_user_access_token_encrypted
  ) {
    await markFacebookAuthorizationNeedsAttention({
      socialAccount,
      status: "invalid",
      message:
        "Stored Facebook User authorization is missing. Facebook reconnection is required.",
    });

    throw new Error(
      "Facebook authorization cannot be refreshed automatically. Reconnect Facebook from Integrations.",
    );
  }

  if (
    userTokenIsExpired(
      socialAccount
        .facebook_user_token_expires_at,
    )
  ) {
    await markFacebookAuthorizationNeedsAttention({
      socialAccount,
      status: "expired",
      message:
        "Stored Facebook User authorization expired. Facebook reconnection is required.",
    });

    throw new Error(
      "Facebook authorization expired. Reconnect Facebook from Integrations.",
    );
  }

  let userAccessToken: string;

  try {
    userAccessToken =
      decryptFacebookToken(
        socialAccount
          .facebook_user_access_token_encrypted,
      ).trim();
  } catch (error) {
    console.error(
      "[TENH Facebook Token] Unable to decrypt stored Facebook User token:",
      error,
    );

    await markFacebookAuthorizationNeedsAttention({
      socialAccount,
      status: "invalid",
      message:
        "Stored Facebook User authorization cannot be read. Facebook reconnection is required.",
    });

    throw new Error(
      "Facebook authorization cannot be refreshed automatically. Reconnect Facebook from Integrations.",
    );
  }

  if (!userAccessToken) {
    await markFacebookAuthorizationNeedsAttention({
      socialAccount,
      status: "invalid",
      message:
        "Stored Facebook User authorization is empty. Facebook reconnection is required.",
    });

    throw new Error(
      "Facebook authorization cannot be refreshed automatically. Reconnect Facebook from Integrations.",
    );
  }

  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION
      ?.trim() || "v26.0";
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}`,
  );

  url.searchParams.set(
    "fields",
    "id,name,access_token",
  );

  let response: Response;

  try {
    response = await fetch(
      url,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization:
            `Bearer ${userAccessToken}`,
        },
      },
    );
  } catch (error) {
    console.error(
      "[TENH Facebook Token] Page-token recovery request failed:",
      error,
    );

    throw new Error(
      "TENH could not refresh Facebook authorization right now. Try again. If the problem continues, reconnect Facebook from Integrations.",
    );
  }

  const result =
    await readGraphJson<FacebookPageTokenResult>(
      response,
    );
  const refreshedToken =
    result.access_token?.trim();
  const returnedPageId =
    result.id?.trim();

  if (
    !response.ok ||
    result.error ||
    !refreshedToken ||
    returnedPageId !== pageId
  ) {
    const message =
      result.error?.message ??
      "Meta did not return a valid Page Access Token during automatic recovery.";

    if (
      isFacebookAccessTokenError(result.error) ||
      (returnedPageId && returnedPageId !== pageId)
    ) {
      await markFacebookAuthorizationNeedsAttention({
        socialAccount,
        status: "invalid",
        message,
      });
    } else {
      await saveFacebookTokenError({
        socialAccountId:
          socialAccount.id,
        message,
      });
    }

    throw new Error(
      isFacebookAccessTokenError(
        result.error,
      )
        ? "Facebook authorization is no longer valid. Reconnect Facebook from Integrations."
        : `TENH could not refresh the Facebook Page token. ${message}`,
    );
  }

  const now =
    new Date().toISOString();
  const { error: updateError } =
    await supabaseAdmin
      .from("social_accounts")
      .update({
        facebook_page_access_token_encrypted:
          encryptFacebookToken(
            refreshedToken,
          ),
        facebook_token_status:
          "connected",
        facebook_token_last_error:
          null,
        updated_at:
          now,
      })
      .eq(
        "id",
        socialAccount.id,
      );

  if (updateError) {
    throw new Error(
      `Facebook returned a refreshed Page token, but TENH could not save it: ${updateError.message}`,
    );
  }

  await resolveFacebookReauthorizationNotifications(
    socialAccount,
  );

  console.log(
    "[TENH Facebook Token] Page Access Token recovered automatically.",
    {
      pageId,
      socialAccountId:
        socialAccount.id,
    },
  );

  return refreshedToken;
}

export async function getFacebookPageAccessToken(
  pageIdInput?: string,
): Promise<string> {
  const pageId =
    getPageId(pageIdInput);
  const socialAccount =
    await loadFacebookTokenRow(
      pageId,
    );

  if (
    socialAccount
      ?.is_active &&
    socialAccount
      .facebook_token_status !==
      "disconnected" &&
    socialAccount
      .facebook_page_access_token_encrypted
  ) {
    try {
      return decryptFacebookToken(
        socialAccount
          .facebook_page_access_token_encrypted,
      );
    } catch (error) {
      console.error(
        "Unable to decrypt stored Facebook Page token:",
        error,
      );
    }
  }

  /*
   * Temporary migration fallback.
   *
   * Keep your existing .env token while converting all Facebook API routes
   * to OAuth. Do not use this fallback as automatic recovery for an invalid
   * OAuth token because it may belong to a different Page in a multi-Page
   * TENH workspace.
   */
  const legacyToken =
    process.env
      .FACEBOOK_PAGE_ACCESS_TOKEN
      ?.trim();

  if (legacyToken) {
    return legacyToken;
  }

  throw new Error(
    "Facebook is not connected. Reconnect Facebook from Integrations.",
  );
}
