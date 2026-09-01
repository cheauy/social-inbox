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
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  getFacebookAuthorizedPages,
} from "@/lib/facebook/facebook-authorized-pages";
import {
  encryptFacebookToken,
  encryptFacebookUserAuthorization,
} from "@/lib/facebook/facebook-token-crypto";
import {
  decodeFacebookOAuthSession,
  FACEBOOK_OAUTH_SESSION_COOKIE,
} from "@/lib/facebook/facebook-oauth-session";
import {
  ensureFacebookPageConnectionHealthy,
} from "@/lib/facebook/facebook-connection-health";
import {
  recoverRecentFacebookData,
} from "@/lib/facebook/recover-facebook-missed-data";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  getBusinessEntitlements,
} from "@/lib/subscription/get-business-entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FACEBOOK_PRODUCTION_ORIGIN =
  "https://tenhchat.com";

const FACEBOOK_COOKIE_DOMAIN =
  process.env.NODE_ENV === "production"
    ? ".tenhchat.com"
    : undefined;

function getFacebookAppOrigin(
  request: NextRequest,
) {
  return process.env.NODE_ENV === "production"
    ? FACEBOOK_PRODUCTION_ORIGIN
    : request.nextUrl.origin;
}

function clearFacebookSelectionSession(
  response: NextResponse,
) {
  response.cookies.set(
    FACEBOOK_OAUTH_SESSION_COOKIE,
    "",
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      domain: FACEBOOK_COOKIE_DOMAIN,
      maxAge: 0,
    },
  );

  return response;
}


type ExistingFacebookAccount = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
  is_active: boolean | null;
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
    getFacebookAppOrigin(request),
  );

  url.searchParams.set("facebook", params.facebook);

  if (params.message) {
    url.searchParams.set("message", params.message);
  }

  if (params.warning) {
    url.searchParams.set("warning", params.warning);
  }

  return NextResponse.redirect(url, 303);
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
    return clearFacebookSelectionSession(
      redirectToIntegrations(request, {
        facebook: "error",
        message:
          "The Facebook connection session is invalid. Start again.",
      }),
    );
  }

  if (
    session.businessId !== currentMember.business_id ||
    session.memberId !== currentMember.id
  ) {
    return clearFacebookSelectionSession(
      redirectToIntegrations(request, {
        facebook: "error",
        message:
          "This Facebook connection session belongs to a different TENH workspace or member.",
      }),
    );
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

  const selectedPageIds = [
    ...new Set(
      formData
        .getAll("pageId")
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  if (selectedPageIds.length === 0) {
    return redirectToIntegrations(request, {
      facebook: "error",
      message: "Choose at least one Facebook Page first.",
    });
  }

  try {
    const authorized = await getFacebookAuthorizedPages(
      session.userAccessToken,
    );
    const authorizedById = new Map(
      authorized.pages.map((page) => [page.id, page]),
    );

    const selectedPages = selectedPageIds.map((pageId) => {
      const page = authorizedById.get(pageId);

      if (!page) {
        throw new Error(
          "One or more selected Pages are no longer authorized for TENH. Reconnect Page access and select them again.",
        );
      }

      if (!page.access_token) {
        throw new Error(
          `${page.name || "A selected Facebook Page"} is authorized, but Facebook did not return a Page access token. Reconnect Page access and verify the required permissions.`,
        );
      }

      return page;
    });

    const {
      data: existingRows,
      error: existingRowsError,
    } = await supabaseAdmin
      .from("social_accounts")
      .select(`
        id,
        business_id,
        platform_account_id,
        is_active
      `)
      .eq("platform", "facebook")
      .in("platform_account_id", selectedPageIds)
      .returns<ExistingFacebookAccount[]>();

    if (existingRowsError) {
      throw new Error(existingRowsError.message);
    }

    const existingByPageId = new Map(
      (existingRows ?? [])
        .filter((row) => row.platform_account_id)
        .map((row) => [row.platform_account_id as string, row]),
    );

    const foreignRows = (existingRows ?? []).filter(
      (row) =>
        row.business_id !== currentMember.business_id,
    );

    if (foreignRows.length > 0) {
      // Preserve the old verified duplicate-Page behavior when the user chose
      // exactly one Page. For a batch, never switch workspaces halfway through.
      if (
        selectedPages.length === 1 &&
        foreignRows.length === 1
      ) {
        const existingPage = foreignRows[0];
        const { data: joinedRows, error: joinError } =
          await supabaseAdmin.rpc(
            "tenh_join_subscription_as_agent",
            {
              p_user_id: authResult.user.id,
              p_business_id: existingPage.business_id,
              p_full_name: currentMember.full_name,
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
              process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
          },
        );

        return clearFacebookSelectionSession(
          redirectToIntegrations(request, {
            facebook: "connected",
            message:
              joined.role === "owner"
                ? "This Facebook Page already belongs to one of your TENH subscriptions. TENH switched to that subscription."
                : "This Facebook Page already belongs to an existing TENH subscription. You joined that subscription as an Agent.",
          }),
        );
      }

      throw new Error(
        "One or more selected Pages already belong to another TENH subscription. Connect those Pages one at a time so TENH can switch or join the correct subscription safely.",
      );
    }

    // Was owner-only. The channels permission makes the
    // Roles & permissions setting meaningful; Owners always pass.
    if (
      !(await memberHasPermission(currentMember, "channels", "manage"))
    ) {
      return permissionDenied(
        "You do not have permission to manage channels in this workspace.",
      );
    }


    const pagesConsumingNewSlots = selectedPages.filter((page) => {
      const existing = existingByPageId.get(page.id);
      return !existing || existing.is_active !== true;
    });

    if (pagesConsumingNewSlots.length > 0) {
      const entitlementResult = await getBusinessEntitlements(
        currentMember.business_id,
      );

      if (!entitlementResult.success) {
        throw new Error(entitlementResult.error);
      }

      const entitlement = entitlementResult.data;

      if (entitlement.locked) {
        throw new Error(
          "Workspace subscription is not active. Open Subscription to continue using TENH Chat.",
        );
      }

      if (
        entitlement.managed &&
        entitlement.channelLimit !== null
      ) {
        const availableSlots = Math.max(
          0,
          entitlement.channelLimit -
            entitlement.activeChannels,
        );

        if (
          pagesConsumingNewSlots.length > availableSlots
        ) {
          throw new Error(
            availableSlots === 0
              ? `Your TENH plan has no available channel slots. You selected ${pagesConsumingNewSlots.length} new Page${pagesConsumingNewSlots.length === 1 ? "" : "s"}. Upgrade or free a channel slot first.`
              : `You selected ${pagesConsumingNewSlots.length} new Pages, but your TENH plan has only ${availableSlots} available channel slot${availableSlots === 1 ? "" : "s"}. Select fewer Pages or upgrade your plan.`,
          );
        }
      }
    }

    const now = new Date().toISOString();
    const connectionWarnings: string[] = [];

    for (const selectedPage of selectedPages) {
      const existingPage = existingByPageId.get(
        selectedPage.id,
      );

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
            selectedPage.access_token!,
          ),
        facebook_user_access_token_encrypted:
          encryptFacebookUserAuthorization({
            accessToken: session.userAccessToken,
            userId: session.facebookUserId,
          }),
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
              `Unable to reconnect ${selectedPage.name || "Facebook Page"}.`,
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
              `Unable to connect ${selectedPage.name || "Facebook Page"}.`,
          );
        }

        savedAccountId = insertedAccount.id;
      }

      // A reconnect is not complete until TENH verifies the Page identity,
      // Messenger Conversations access and webhook subscription. The health
      // helper repairs a stale Page token/webhook automatically and also clears
      // any old "reconnect Facebook" notifications when the Page is healthy.
      const health = await ensureFacebookPageConnectionHealthy({
        pageId: selectedPage.id,
        socialAccountId: savedAccountId,
      });

      if (!health.healthy || !health.accessToken) {
        connectionWarnings.push(
          `${selectedPage.name || selectedPage.id}: ${
            health.error || "Facebook connected, but TENH could not fully verify the connection."
          }`,
        );
        continue;
      }

      // Immediately recover a wider window after authorization is restored.
      // This is intentionally deeper than the hourly watchdog, but still
      // bounded/idempotent so reconnect cannot duplicate existing messages.
      const reconnectLookback = Number(
        process.env.FACEBOOK_RECONNECT_RECOVERY_LOOKBACK_MINUTES?.trim() ||
          "10080",
      );
      const recovery = await recoverRecentFacebookData({
        pageId: selectedPage.id,
        socialAccountId: savedAccountId,
        accessToken: health.accessToken,
        lookbackMinutes: Number.isFinite(reconnectLookback)
          ? reconnectLookback
          : 10_080,
        mode: "reconnect",
      });

      if (
        recovery.messenger.failed > 0 ||
        recovery.comments.failed > 0 ||
        recovery.messenger.truncated ||
        recovery.comments.truncated
      ) {
        connectionWarnings.push(
          `${selectedPage.name || selectedPage.id}: connected successfully, but some missed-data recovery checks could not finish. TENH's watchdog will continue checking automatically.`,
        );
      }
    }

    return clearFacebookSelectionSession(
      redirectToIntegrations(request, {
        facebook: "connected",
        message:
          selectedPages.length === 1
            ? "Facebook Page connected successfully."
            : `${selectedPages.length} Facebook Pages connected successfully.`,
        warning:
          connectionWarnings.length > 0
            ? connectionWarnings.join(" ")
            : undefined,
      }),
    );
  } catch (error) {
    console.error(
      "[Tenh Facebook OAuth] Page selection failed:",
      error instanceof Error
        ? error.message
        : "Unknown error",
    );

    return clearFacebookSelectionSession(
      redirectToIntegrations(request, {
        facebook: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect the selected Facebook Pages.",
      }),
    );
  }
}
