import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  generateInvitationToken,
  hashInvitationToken,
  INVITATION_LIFETIME_MS,
  sendSubscriptionInvitationEmail,
  type SubscriptionInvitationRole,
} from "@/lib/team/subscription-invitations";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/require-permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    inviteId: string;
  }>;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function responseError(
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

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return responseError(
      authResult.error,
      authResult.status,
      authResult.code,
    );
  }
  const permissionGuard =
    await requirePermission("team_members", "manage");

  if (!permissionGuard.success) {
    return permissionGuard.response;
  }


  const { inviteId } = await context.params;
  const cleanInviteId = inviteId?.trim();

  if (!cleanInviteId) {
    return responseError(
      "Invitation is required.",
      400,
      "INVITE_REQUIRED",
    );
  }

  let body: {
    action?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return responseError(
      "Invalid invitation request.",
      400,
      "INVALID_REQUEST",
    );
  }

  const action =
    body.action === "resend" ||
    body.action === "cancel"
      ? body.action
      : null;

  if (!action) {
    return responseError(
      "Choose resend or cancel.",
      400,
      "INVALID_ACTION",
    );
  }

  const { data: invitation, error: inviteError } =
    await supabaseAdmin
      .from("subscription_invitations")
      .select(
        "id,business_id,subscription_id,email,role,status,token_hash,expires_at",
      )
      .eq("id", cleanInviteId)
      .eq("business_id", authResult.member.business_id)
      .maybeSingle();

  if (inviteError) {
    return responseError(
      "Unable to load this invitation.",
      500,
      "INVITE_LOAD_FAILED",
    );
  }

  if (!invitation) {
    return responseError(
      "Invitation was not found in this subscription.",
      404,
      "INVITE_NOT_FOUND",
    );
  }

  if (invitation.role === "owner" && authResult.member.role !== "owner") {
    return responseError(
      "Only an Owner can manage an Owner invitation.",
      403,
      "OWNER_REQUIRED",
    );
  }

  if (invitation.status !== "pending") {
    return responseError(
      "This invitation is no longer pending.",
      409,
      "INVITE_NOT_PENDING",
    );
  }

  if (action === "cancel") {
    const { error } = await supabaseAdmin
      .from("subscription_invitations")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitation.id)
      .eq("status", "pending");

    if (error) {
      return responseError(
        "Unable to cancel this invitation.",
        500,
        "INVITE_CANCEL_FAILED",
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Invitation cancelled. Its reserved user seat is now available.",
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const token = generateInvitationToken();
  const expiresAt =
    new Date(
      Date.now() + INVITATION_LIFETIME_MS,
    ).toISOString();

  const { error: rotateError } =
    await supabaseAdmin
      .from("subscription_invitations")
      .update({
        token_hash: hashInvitationToken(token),
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitation.id)
      .eq("status", "pending");

  if (rotateError) {
    const lower = rotateError.message.toLowerCase();

    if (lower.includes("tenh_invite_seat_limit")) {
      return responseError(
        "This subscription no longer has an available reserved user seat.",
        409,
        "MEMBER_LIMIT_REACHED",
      );
    }

    return responseError(
      "Unable to refresh this invitation.",
      500,
      "INVITE_RESEND_FAILED",
    );
  }

  const [{ data: business }] =
    await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("name")
        .eq("id", invitation.business_id)
        .maybeSingle(),
    ]);

  const invitationUrl =
    `${request.nextUrl.origin}/invite/accept?token=${encodeURIComponent(token)}`;

  try {
    const delivery =
      await sendSubscriptionInvitationEmail({
        email: invitation.email,
        businessName:
          business?.name?.trim() ||
          "TENH Workspace",
        role:
          invitation.role as SubscriptionInvitationRole,
        inviterName:
          authResult.member.full_name?.trim() ||
          authResult.user.email ||
          "A TENH Owner",
        invitationUrl,
      });

    return NextResponse.json(
      {
        success: true,
        message: delivery.sent
          ? `Invitation resent to ${invitation.email}.`
          : `Invitation refreshed for ${invitation.email}. Email delivery is not configured in local development.`,
        ...(delivery.localPreview
          ? { invitationUrl }
          : {}),
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    console.error(
      "[TENH Invite] Resend email failed:",
      error instanceof Error ? error.message : error,
    );

    // Keep the previously delivered invitation usable when the resend
    // provider fails. Without this rollback, rotating the token before a
    // failed email delivery would silently invalidate the user's old link.
    const { error: rollbackError } =
      await supabaseAdmin
        .from("subscription_invitations")
        .update({
          token_hash: invitation.token_hash,
          expires_at: invitation.expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invitation.id)
        .eq("status", "pending")
        .eq("token_hash", hashInvitationToken(token));

    if (rollbackError) {
      console.error(
        "[TENH Invite] Failed to restore previous invitation after resend failure:",
        rollbackError.message,
      );
    }

    return responseError(
      error instanceof Error
        ? error.message
        : "Unable to resend this invitation.",
      502,
      "INVITE_EMAIL_FAILED",
    );
  }
}
