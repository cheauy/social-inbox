import { NextRequest, NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import {
  hashInvitationToken,
  loadInvitationByToken,
} from "@/lib/team/subscription-invitations";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function errorResponse(
  error: string,
  status: number,
  code?: string,
) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...(code ? { code } : {}),
    },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

function isExpired(value: string) {
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function mapAcceptError(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("tenh_invite_email_mismatch")) {
    return {
      status: 403,
      code: "INVITE_EMAIL_MISMATCH",
      error:
        "This invitation was sent to a different email address. Sign in with the invited email.",
    };
  }

  if (
    lower.includes("tenh_invite_expired") ||
    lower.includes("tenh_invite_not_pending")
  ) {
    return {
      status: 410,
      code: "INVITE_EXPIRED",
      error:
        "This invitation has expired or is no longer available. Ask the workspace Owner to send a new invitation.",
    };
  }

  if (lower.includes("tenh_invite_seat_limit")) {
    return {
      status: 409,
      code: "MEMBER_LIMIT_REACHED",
      error:
        "This subscription no longer has an available user seat. Ask the Owner to add capacity and resend the invitation.",
    };
  }

  if (lower.includes("tenh_invite_subscription_locked")) {
    return {
      status: 409,
      code: "SUBSCRIPTION_LOCKED",
      error:
        "This TENH subscription is expired or inactive. Its Owner must reactivate it before you can join.",
    };
  }

  if (
    lower.includes("tenh_invite_not_found") ||
    lower.includes("tenh_invite_subscription_not_found")
  ) {
    return {
      status: 404,
      code: "INVITE_NOT_FOUND",
      error: "This TENH invitation could not be found.",
    };
  }

  return {
    status: 500,
    code: "INVITE_ACCEPT_FAILED",
    error:
      "TENH could not safely accept this invitation. No workspace access was changed.",
  };
}

export async function GET(request: NextRequest) {
  const token =
    request.nextUrl.searchParams.get("token")?.trim() ?? "";

  if (!token) {
    return errorResponse(
      "Invitation token is missing.",
      400,
      "INVITE_TOKEN_REQUIRED",
    );
  }

  try {
    const invitation =
      await loadInvitationByToken(token);

    if (!invitation) {
      return errorResponse(
        "This TENH invitation could not be found.",
        404,
        "INVITE_NOT_FOUND",
      );
    }

    if (
      invitation.status !== "pending" ||
      isExpired(invitation.expires_at)
    ) {
      if (
        invitation.status === "pending" &&
        isExpired(invitation.expires_at)
      ) {
        await supabaseAdmin
          .from("subscription_invitations")
          .update({
            status: "expired",
            updated_at: new Date().toISOString(),
          })
          .eq("id", invitation.id)
          .eq("status", "pending");
      }

      return errorResponse(
        "This invitation has expired or is no longer available. Ask the workspace Owner to send a new invitation.",
        410,
        "INVITE_EXPIRED",
      );
    }

    const [
      { data: business, error: businessError },
      { data: subscription, error: subscriptionError },
    ] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("id,name")
        .eq("id", invitation.business_id)
        .maybeSingle(),
      supabaseAdmin
        .from("business_subscriptions")
        .select(
          "id,status,current_period_end,trial_ends_at",
        )
        .eq("id", invitation.subscription_id)
        .eq("business_id", invitation.business_id)
        .maybeSingle(),
    ]);

    if (businessError || subscriptionError) {
      throw new Error(
        businessError?.message ??
          subscriptionError?.message ??
          "Unable to load invitation workspace.",
      );
    }

    if (!business || !subscription) {
      return errorResponse(
        "The subscription for this invitation no longer exists.",
        404,
        "INVITE_SUBSCRIPTION_NOT_FOUND",
      );
    }

    const end =
      subscription.status === "trialing"
        ? subscription.trial_ends_at ??
          subscription.current_period_end
        : subscription.current_period_end;

    const operational =
      ["active", "trialing"].includes(subscription.status) &&
      !(
        end &&
        Number.isFinite(Date.parse(end)) &&
        Date.parse(end) <= Date.now()
      );

    if (!operational) {
      return errorResponse(
        "This TENH subscription is expired or inactive. Its Owner must reactivate it before you can join.",
        409,
        "SUBSCRIPTION_LOCKED",
      );
    }

    return NextResponse.json(
      {
        success: true,
        invitation: {
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expires_at,
          businessName:
            business.name?.trim() ||
            "TENH Workspace",
          subscriptionId:
            invitation.subscription_id,
          subscriptionLabel:
            `#${invitation.subscription_id
              .slice(0, 8)
              .toUpperCase()}`,
        },
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    console.error(
      "[TENH Invite] Preview failed:",
      error instanceof Error ? error.message : error,
    );

    return errorResponse(
      "Unable to verify this TENH invitation.",
      500,
      "INVITE_PREVIEW_FAILED",
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    token?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(
      "Invalid invitation request.",
      400,
      "INVALID_REQUEST",
    );
  }

  const token =
    typeof body.token === "string"
      ? body.token.trim()
      : "";

  if (!token) {
    return errorResponse(
      "Invitation token is missing.",
      400,
      "INVITE_TOKEN_REQUIRED",
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return errorResponse(
      "Sign in with the invited email before accepting this invitation.",
      401,
      "SIGN_IN_REQUIRED",
    );
  }

  const email =
    user.email?.trim().toLowerCase() ?? "";

  if (!user.email_confirmed_at) {
    return errorResponse(
      "Verify your email address before accepting this TENH invitation.",
      403,
      "EMAIL_NOT_VERIFIED",
    );
  }

  if (!email) {
    return errorResponse(
      "Your TENH account does not have a verified email address.",
      400,
      "EMAIL_REQUIRED",
    );
  }

  try {
    const { data, error } = await supabaseAdmin.rpc(
      "tenh_accept_subscription_invitation",
      {
        p_token_hash: hashInvitationToken(token),
        p_user_id: user.id,
        p_email: email,
        p_full_name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : "",
      },
    );

    if (error) {
      const safe = mapAcceptError(error.message);

      console.warn(
        "[TENH Invite] Atomic accept rejected:",
        safe.code,
      );

      return errorResponse(
        safe.error,
        safe.status,
        safe.code,
      );
    }

    const accepted = Array.isArray(data)
      ? data[0]
      : data;

    if (!accepted?.business_id) {
      return errorResponse(
        "TENH could not confirm the accepted workspace membership.",
        500,
        "INVITE_ACCEPT_FAILED",
      );
    }

    const response = NextResponse.json(
      {
        success: true,
        businessId: accepted.business_id,
        subscriptionId:
          accepted.subscription_id ?? null,
        memberId: accepted.member_id ?? null,
        role: accepted.role ?? null,
        message:
          "Invitation accepted. This workspace is now available in your ONE TENH Inbox.",
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );

    response.cookies.set(
      TENH_ACTIVE_BUSINESS_COOKIE,
      accepted.business_id,
      {
        httpOnly: true,
        sameSite: "lax",
        secure:
          process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      },
    );

    return response;
  } catch (error) {
    console.error(
      "[TENH Invite] Accept failed:",
      error instanceof Error ? error.message : error,
    );

    return errorResponse(
      "TENH could not safely accept this invitation.",
      500,
      "INVITE_ACCEPT_FAILED",
    );
  }
}
