import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  expireOldInvitations,
  generateInvitationToken,
  hashInvitationToken,
  INVITATION_LIFETIME_MS,
  looksLikeInvitationEmail,
  normalizeInvitationEmail,
  sendSubscriptionInvitationEmail,
  type SubscriptionInvitationRole,
} from "@/lib/team/subscription-invitations";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

type SubscriptionRow = {
  id: string;
  business_id: string;
  status: string;
  member_limit: number | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
};

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperational(subscription: SubscriptionRow) {
  if (!["active", "trialing"].includes(subscription.status)) {
    return false;
  }

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

async function loadCurrentSubscription(businessId: string) {
  const { data, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select(
      "id,business_id,status,member_limit,current_period_end,trial_ends_at,created_at",
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      "Unable to verify this TENH subscription.",
    );
  }

  return (data ?? null) as SubscriptionRow | null;
}

function invitationError(message: string, status: number, code?: string) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(code ? { code } : {}),
    },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return invitationError(
      authResult.error,
      authResult.status,
      authResult.code,
    );
  }

  if (authResult.member.role !== "owner") {
    return NextResponse.json(
      {
        success: true,
        canManage: false,
        invitations: [],
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const subscription = await loadCurrentSubscription(
      authResult.member.business_id,
    );

    if (!subscription) {
      return invitationError(
        "This workspace does not have a TENH subscription.",
        409,
        "SUBSCRIPTION_NOT_FOUND",
      );
    }

    await expireOldInvitations(subscription.id);

    const { data, error } = await supabaseAdmin
      .from("subscription_invitations")
      .select(
        "id,business_id,subscription_id,email,role,status,expires_at,created_at,updated_at",
      )
      .eq("business_id", authResult.member.business_id)
      .eq("subscription_id", subscription.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(
        "Unable to load pending invitations.",
      );
    }

    return NextResponse.json(
      {
        success: true,
        canManage:
          authResult.member.role === "owner",
        invitations: data ?? [],
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    console.error(
      "[TENH Invite] List failed:",
      error instanceof Error ? error.message : error,
    );

    return invitationError(
      error instanceof Error
        ? error.message
        : "Unable to load pending invitations.",
      500,
      "INVITE_LIST_FAILED",
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return invitationError(
      authResult.error,
      authResult.status,
      authResult.code,
    );
  }

  if (authResult.member.role !== "owner") {
    return invitationError(
      "Only an Owner can invite users to this subscription.",
      403,
      "OWNER_REQUIRED",
    );
  }

  let body: {
    email?: unknown;
    role?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return invitationError(
      "Invalid invitation request.",
      400,
      "INVALID_REQUEST",
    );
  }

  const email = normalizeInvitationEmail(body.email);
  const role: SubscriptionInvitationRole | null =
    body.role === "owner"
      ? "owner"
      : body.role === "agent"
        ? "agent"
        : null;

  if (!looksLikeInvitationEmail(email) || !role) {
    return invitationError(
      "Enter a valid email and choose Agent or Owner.",
      400,
      "INVALID_INVITATION",
    );
  }

  if (
    email ===
    (authResult.user.email ?? "").trim().toLowerCase()
  ) {
    return invitationError(
      "You already belong to this subscription.",
      409,
      "ALREADY_MEMBER",
    );
  }

  try {
    const subscription = await loadCurrentSubscription(
      authResult.member.business_id,
    );

    if (!subscription || !isOperational(subscription)) {
      return invitationError(
        "This subscription is expired or inactive. Reactivate it before inviting users.",
        409,
        "SUBSCRIPTION_LOCKED",
      );
    }

    await expireOldInvitations(subscription.id);

    const {
      data: existingMemberRows,
      error: existingMemberError,
    } = await supabaseAdmin
      .from("team_members")
      .select("id,is_active,email,user_id")
      .eq("business_id", authResult.member.business_id)
      .ilike("email", email)
      .limit(2);

    if (existingMemberError) {
      throw new Error(
        "Unable to verify existing workspace users.",
      );
    }

    const existingMember =
      existingMemberRows?.[0] ?? null;

    if (existingMember?.is_active) {
      return invitationError(
        "This email already has access to the subscription.",
        409,
        "ALREADY_MEMBER",
      );
    }

    const {
      data: existingInvite,
      error: existingInviteError,
    } = await supabaseAdmin
      .from("subscription_invitations")
      .select("id,email,role,status,expires_at")
      .eq("business_id", authResult.member.business_id)
      .eq("subscription_id", subscription.id)
      .ilike("email", email)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (existingInviteError) {
      throw new Error(
        "Unable to verify pending invitations.",
      );
    }

    if (existingInvite) {
      return invitationError(
        "A pending invitation already exists for this email. Resend or cancel it from User Permissions.",
        409,
        "INVITE_ALREADY_PENDING",
      );
    }

    const token = generateInvitationToken();
    const tokenHash = hashInvitationToken(token);
    const now = new Date();
    const expiresAt =
      new Date(
        now.getTime() + INVITATION_LIFETIME_MS,
      ).toISOString();

    const {
      data: created,
      error: createError,
    } = await supabaseAdmin
      .from("subscription_invitations")
      .insert({
        business_id: authResult.member.business_id,
        subscription_id: subscription.id,
        email,
        role,
        token_hash: tokenHash,
        status: "pending",
        invited_by_member_id: authResult.member.id,
        expires_at: expiresAt,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select(
        "id,business_id,subscription_id,email,role,status,expires_at,created_at,updated_at",
      )
      .single();

    if (createError || !created) {
      const message =
        createError?.message ?? "";
      const lower = message.toLowerCase();

      if (
        lower.includes("tenh_invite_seat_limit") ||
        lower.includes("member limit")
      ) {
        return invitationError(
          "No user seats are available. Add user capacity before inviting another person.",
          409,
          "MEMBER_LIMIT_REACHED",
        );
      }

      if (
        createError?.code === "23505" ||
        lower.includes(
          "subscription_invitations_one_pending_email",
        )
      ) {
        return invitationError(
          "A pending invitation already exists for this email.",
          409,
          "INVITE_ALREADY_PENDING",
        );
      }

      console.error(
        "[TENH Invite] Unable to create invitation:",
        createError?.message ?? "No row returned",
      );

      return invitationError(
        "Unable to create this invitation.",
        500,
        "INVITE_CREATE_FAILED",
      );
    }

    const { data: business } =
      await supabaseAdmin
        .from("businesses")
        .select("name")
        .eq("id", authResult.member.business_id)
        .maybeSingle();

    const invitationUrl =
      `${request.nextUrl.origin}/invite/accept?token=${encodeURIComponent(token)}`;

    try {
      const delivery =
        await sendSubscriptionInvitationEmail({
          email,
          businessName:
            business?.name?.trim() ||
            "TENH Workspace",
          role,
          inviterName:
            authResult.member.full_name?.trim() ||
            authResult.user.email ||
            "A TENH Owner",
          invitationUrl,
        });

      return NextResponse.json(
        {
          success: true,
          invitation: created,
          message: delivery.sent
            ? `Invitation sent to ${email}.`
            : `Invitation created for ${email}. Email delivery is not configured in local development.`,
          ...(delivery.localPreview
            ? { invitationUrl }
            : {}),
        },
        {
          status: 201,
          headers: NO_STORE_HEADERS,
        },
      );
    } catch (emailError) {
      await supabaseAdmin
        .from("subscription_invitations")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", created.id)
        .eq("status", "pending");

      throw emailError;
    }
  } catch (error) {
    console.error(
      "[TENH Invite] Create failed:",
      error instanceof Error ? error.message : error,
    );

    return invitationError(
      error instanceof Error
        ? error.message
        : "Unable to send this invitation.",
      500,
      "INVITE_CREATE_FAILED",
    );
  }
}
