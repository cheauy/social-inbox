import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  decryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    socialAccountId: string;
  }>;
};

type GraphErrorPayload = {
  error?: {
    message?: string;
  };
  success?: boolean;
};

async function readGraphJson(
  response: Response,
): Promise<GraphErrorPayload> {
  try {
    return (await response.json()) as
      GraphErrorPayload;
  } catch {
    return {};
  }
}

export async function POST(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;
  const { socialAccountId } =
    await context.params;
  const cleanSocialAccountId =
    socialAccountId?.trim();

  if (!cleanSocialAccountId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "socialAccountId is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: socialAccount,
    error: socialAccountError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      business_id,
      platform,
      platform_account_id,
      account_name,
      is_active,
      facebook_page_access_token_encrypted
    `)
    .eq("id", cleanSocialAccountId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq("platform", "facebook")
    .maybeSingle();

  if (socialAccountError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Facebook Page connection.",
        details:
          socialAccountError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!socialAccount) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Facebook Page connection was not found in this TENH workspace.",
      },
      {
        status: 404,
      },
    );
  }

  if (!socialAccount.is_active) {
    return NextResponse.json({
      success: true,
      alreadyDisconnected: true,
      socialAccountId:
        socialAccount.id,
    });
  }

  const pageId =
    socialAccount.platform_account_id?.trim();
  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION
      ?.trim() || "v26.0";

  let warning: string | null = null;

  /*
   * Best-effort remote unsubscribe before the local soft disconnect.
   * We intentionally keep the social_accounts row so all existing
   * contacts/conversations/messages remain linked to the same Page.
   */
  if (
    pageId &&
    socialAccount
      .facebook_page_access_token_encrypted
  ) {
    try {
      const pageAccessToken =
        decryptFacebookToken(
          socialAccount
            .facebook_page_access_token_encrypted,
        );

      const unsubscribeUrl = new URL(
        `https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`,
      );

      const unsubscribeResponse =
        await fetch(unsubscribeUrl, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${pageAccessToken}`,
          },
          cache: "no-store",
        });

      if (!unsubscribeResponse.ok) {
        const graphResult =
          await readGraphJson(
            unsubscribeResponse,
          );

        warning =
          graphResult.error?.message
            ? `TENH disconnected the Page locally, but Meta webhook unsubscribe returned: ${graphResult.error.message}`
            : "TENH disconnected the Page locally, but Meta webhook unsubscribe could not be confirmed.";
      }
    } catch (unsubscribeError) {
      warning =
        unsubscribeError instanceof Error
          ? `TENH disconnected the Page locally, but webhook unsubscribe could not be confirmed: ${unsubscribeError.message}`
          : "TENH disconnected the Page locally, but webhook unsubscribe could not be confirmed.";
    }
  }

  const {
    data: disconnectedAccount,
    error: disconnectError,
  } = await supabaseAdmin
    .from("social_accounts")
    .update({
      is_active: false,
      facebook_token_status:
        "disconnected",
      facebook_token_last_error:
        warning,
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", socialAccount.id)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .select(`
      id,
      platform_account_id,
      account_name,
      is_active,
      facebook_token_status
    `)
    .single();

  if (
    disconnectError ||
    !disconnectedAccount
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          disconnectError?.message ??
          "Unable to disconnect the Facebook Page.",
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    warning,
    connection: disconnectedAccount,
    historyPreserved: true,
  });
}
