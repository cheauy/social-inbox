import "server-only";

import {
  createHash,
  randomBytes,
} from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const INVITATION_LIFETIME_MS =
  7 * 24 * 60 * 60 * 1000;

export type SubscriptionInvitationRole =
  | "agent"
  | "owner";

export type SubscriptionInvitationRow = {
  id: string;
  business_id: string;
  subscription_id: string;
  email: string;
  role: SubscriptionInvitationRole;
  status:
    | "pending"
    | "accepted"
    | "cancelled"
    | "expired";
  invited_by_member_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeInvitationEmail(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

export function looksLikeInvitationEmail(value: string) {
  return (
    value.length > 3 &&
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function generateInvitationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string) {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

export function shortInvitationSubscriptionId(
  subscriptionId: string,
) {
  return `#${subscriptionId.slice(0, 8).toUpperCase()}`;
}

export function sanitizeInternalNext(
  value: string | null | undefined,
  fallback = "/dashboard/inbox",
) {
  const next = value?.trim();

  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return fallback;
  }

  return next;
}

export async function expireOldInvitations(
  subscriptionId?: string,
) {
  let query = supabaseAdmin
    .from("subscription_invitations")
    .update({
      status: "expired",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "pending")
    .lte("expires_at", new Date().toISOString());

  if (subscriptionId) {
    query = query.eq("subscription_id", subscriptionId);
  }

  const { error } = await query;

  if (error) {
    console.warn(
      "[TENH Invite] Unable to expire stale invitations:",
      error.message,
    );
  }
}

export async function loadInvitationByToken(
  token: string,
) {
  const cleanToken = token.trim();

  if (
    cleanToken.length < 20 ||
    cleanToken.length > 256
  ) {
    return null;
  }

  const tokenHash =
    hashInvitationToken(cleanToken);

  const { data, error } = await supabaseAdmin
    .from("subscription_invitations")
    .select(`
      id,
      business_id,
      subscription_id,
      email,
      role,
      status,
      invited_by_member_id,
      expires_at,
      accepted_at,
      created_at,
      updated_at
    `)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    console.error(
      "[TENH Invite] Unable to load invitation:",
      error.message,
    );
    throw new Error(
      "Unable to verify this TENH invitation.",
    );
  }

  return data as SubscriptionInvitationRow | null;
}


type InvitationAcceptDatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type AcceptedSubscriptionInvitation = {
  business_id: string;
  subscription_id: string;
  member_id: string;
  role: SubscriptionInvitationRole;
};

export type AcceptSubscriptionInvitationResult =
  | {
      success: true;
      data: AcceptedSubscriptionInvitation;
      usedFallback: boolean;
    }
  | {
      success: false;
      status: number;
      code: string;
      error: string;
      debug?: InvitationAcceptDatabaseError;
    };

function invitationAcceptFailure(
  status: number,
  code: string,
  error: string,
  debug?: InvitationAcceptDatabaseError,
): AcceptSubscriptionInvitationResult {
  return {
    success: false,
    status,
    code,
    error,
    ...(debug ? { debug } : {}),
  };
}

function mapInvitationAcceptDatabaseError(
  databaseError: InvitationAcceptDatabaseError,
): AcceptSubscriptionInvitationResult {
  const text = [
    databaseError.message,
    databaseError.details,
    databaseError.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("tenh_invite_email_mismatch")) {
    return invitationAcceptFailure(
      403,
      "INVITE_EMAIL_MISMATCH",
      "This invitation was sent to a different email address. Sign in with the invited email.",
      databaseError,
    );
  }

  if (
    text.includes("tenh_invite_expired") ||
    text.includes("tenh_invite_not_pending")
  ) {
    return invitationAcceptFailure(
      410,
      "INVITE_EXPIRED",
      "This invitation has expired or is no longer available. Ask the workspace Owner to send a new invitation.",
      databaseError,
    );
  }

  if (text.includes("tenh_invite_seat_limit")) {
    return invitationAcceptFailure(
      409,
      "MEMBER_LIMIT_REACHED",
      "This subscription no longer has an available user seat. Ask the Owner to add capacity and resend the invitation.",
      databaseError,
    );
  }

  if (text.includes("tenh_invite_subscription_locked")) {
    return invitationAcceptFailure(
      409,
      "SUBSCRIPTION_LOCKED",
      "This TENH subscription is expired or inactive. Its Owner must reactivate it before you can join.",
      databaseError,
    );
  }

  if (
    text.includes("tenh_invite_not_found") ||
    text.includes("tenh_invite_subscription_not_found")
  ) {
    return invitationAcceptFailure(
      404,
      "INVITE_NOT_FOUND",
      "This TENH invitation could not be found.",
      databaseError,
    );
  }

  return invitationAcceptFailure(
    500,
    "INVITE_ACCEPT_FAILED",
    "TENH could not safely accept this invitation. No workspace access was changed.",
    databaseError,
  );
}

function isMissingInvitationAcceptRpc(
  databaseError: InvitationAcceptDatabaseError,
) {
  const text = [
    databaseError.message,
    databaseError.details,
    databaseError.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    // PostgreSQL 42702 = ambiguous_column. Older TENH versions of the
    // accept RPC can fail before completing because RETURNS TABLE output
    // names such as business_id collide with unqualified table columns.
    // PostgreSQL rolls the failed RPC transaction back, so it is safe to
    // use the guarded compatibility path below for this known function bug.
    databaseError.code === "42702" ||
    databaseError.code === "PGRST202" ||
    databaseError.code === "42883" ||
    (text.includes("tenh_accept_subscription_invitation") &&
      (text.includes("could not find") ||
        text.includes("does not exist") ||
        text.includes("schema cache")))
  );
}

function invitationPeriodEnded(value: string | null | undefined) {
  if (!value) return false;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function invitationSubscriptionIsOperational(subscription: {
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
}) {
  if (!["active", "trialing"].includes(subscription.status)) {
    return false;
  }

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !invitationPeriodEnded(end);
}

function invitationMemberName(fullName: string, email: string) {
  const clean = fullName.trim();

  if (clean) {
    return clean.slice(0, 120);
  }

  return (email.split("@")[0]?.trim() || "TENH Member").slice(0, 120);
}

async function rollbackFallbackInvitationClaim(
  invitationId: string,
  claimedAt: string,
) {
  const { error } = await supabaseAdmin
    .from("subscription_invitations")
    .update({
      status: "pending",
      accepted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invitationId)
    .eq("status", "accepted")
    .eq("accepted_at", claimedAt);

  if (error) {
    console.error(
      "[TENH Invite] CRITICAL: fallback acceptance could not restore invitation after membership failure:",
      error.message,
    );
  }
}

async function acceptInvitationWithoutRpc({
  tokenHash,
  userId,
  email,
  fullName,
}: {
  tokenHash: string;
  userId: string;
  email: string;
  fullName: string;
}): Promise<AcceptSubscriptionInvitationResult> {
  const normalizedEmail = normalizeInvitationEmail(email);
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: invitationData, error: invitationError } =
    await supabaseAdmin
      .from("subscription_invitations")
      .select(
        "id,business_id,subscription_id,email,role,status,expires_at,accepted_at,token_hash",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();

  if (invitationError) {
    console.error(
      "[TENH Invite] Fallback could not load invitation:",
      invitationError.message,
    );
    return invitationAcceptFailure(
      500,
      "INVITE_ACCEPT_FAILED",
      "TENH could not safely verify this invitation. No workspace access was changed.",
      invitationError,
    );
  }

  if (!invitationData) {
    return invitationAcceptFailure(
      404,
      "INVITE_NOT_FOUND",
      "This TENH invitation could not be found.",
    );
  }

  const invitation = invitationData as {
    id: string;
    business_id: string;
    subscription_id: string;
    email: string;
    role: string;
    status: string;
    expires_at: string;
    accepted_at: string | null;
    token_hash: string;
  };

  if (normalizeInvitationEmail(invitation.email) !== normalizedEmail) {
    return invitationAcceptFailure(
      403,
      "INVITE_EMAIL_MISMATCH",
      "This invitation was sent to a different email address. Sign in with the invited email.",
    );
  }

  if (
    invitation.status !== "pending" ||
    invitationPeriodEnded(invitation.expires_at)
  ) {
    return invitationAcceptFailure(
      410,
      "INVITE_EXPIRED",
      "This invitation has expired or is no longer available. Ask the workspace Owner to send a new invitation.",
    );
  }

  if (invitation.role !== "agent" && invitation.role !== "owner") {
    return invitationAcceptFailure(
      409,
      "INVITE_ROLE_INVALID",
      "This invitation has an invalid workspace role. Ask the Owner to cancel it and send a new invitation.",
    );
  }

  const { data: subscription, error: subscriptionError } =
    await supabaseAdmin
      .from("business_subscriptions")
      .select(
        "id,business_id,status,member_limit,current_period_end,trial_ends_at",
      )
      .eq("id", invitation.subscription_id)
      .eq("business_id", invitation.business_id)
      .maybeSingle();

  if (subscriptionError) {
    console.error(
      "[TENH Invite] Fallback could not verify subscription:",
      subscriptionError.message,
    );
    return invitationAcceptFailure(
      500,
      "INVITE_ACCEPT_FAILED",
      "TENH could not safely verify this subscription. No workspace access was changed.",
      subscriptionError,
    );
  }

  if (!subscription) {
    return invitationAcceptFailure(
      404,
      "INVITE_NOT_FOUND",
      "The subscription for this invitation no longer exists.",
    );
  }

  if (!invitationSubscriptionIsOperational(subscription)) {
    return invitationAcceptFailure(
      409,
      "SUBSCRIPTION_LOCKED",
      "This TENH subscription is expired or inactive. Its Owner must reactivate it before you can join.",
    );
  }

  const [byUserResult, byEmailResult] = await Promise.all([
    supabaseAdmin
      .from("team_members")
      .select("id,user_id,business_id,email,role,is_active")
      .eq("business_id", invitation.business_id)
      .eq("user_id", userId)
      .limit(2),
    supabaseAdmin
      .from("team_members")
      .select("id,user_id,business_id,email,role,is_active")
      .eq("business_id", invitation.business_id)
      .ilike("email", normalizedEmail)
      .limit(2),
  ]);

  if (byUserResult.error || byEmailResult.error) {
    const databaseError = byUserResult.error ?? byEmailResult.error;
    console.error(
      "[TENH Invite] Fallback could not verify existing membership:",
      databaseError?.message,
    );
    return invitationAcceptFailure(
      500,
      "INVITE_ACCEPT_FAILED",
      "TENH could not safely verify your workspace membership. No workspace access was changed.",
      databaseError ?? undefined,
    );
  }

  const candidates = new Map<
    string,
    {
      id: string;
      user_id: string | null;
      business_id: string;
      email: string;
      role: string;
      is_active: boolean;
    }
  >();

  for (const row of [
    ...(byUserResult.data ?? []),
    ...(byEmailResult.data ?? []),
  ]) {
    candidates.set(row.id as string, row as never);
  }

  // There should be only one membership per person/workspace. Refuse to
  // guess if older data produced two conflicting rows.
  if (candidates.size > 1) {
    return invitationAcceptFailure(
      409,
      "MEMBERSHIP_CONFLICT",
      "TENH found conflicting membership records for this workspace. No access was changed. Please contact TENH support.",
    );
  }

  const existingMember = candidates.values().next().value as
    | {
        id: string;
        user_id: string | null;
        business_id: string;
        email: string;
        role: string;
        is_active: boolean;
      }
    | undefined;

  if (!existingMember?.is_active) {
    const [activeCountResult, pendingCountResult] = await Promise.all([
      supabaseAdmin
        .from("team_members")
        .select("id", { count: "exact", head: true })
        .eq("business_id", invitation.business_id)
        .eq("is_active", true),
      supabaseAdmin
        .from("subscription_invitations")
        .select("id", { count: "exact", head: true })
        .eq("business_id", invitation.business_id)
        .eq("subscription_id", invitation.subscription_id)
        .eq("status", "pending")
        .gt("expires_at", nowIso),
    ]);

    if (activeCountResult.error || pendingCountResult.error) {
      const databaseError = activeCountResult.error ?? pendingCountResult.error;
      console.error(
        "[TENH Invite] Fallback could not verify reserved member capacity:",
        databaseError?.message,
      );
      return invitationAcceptFailure(
        500,
        "INVITE_ACCEPT_FAILED",
        "TENH could not safely verify subscription capacity. No workspace access was changed.",
        databaseError ?? undefined,
      );
    }

    const memberLimit = Number(subscription.member_limit ?? 0);
    const activeCount = activeCountResult.count ?? 0;
    const reservedPendingCount = pendingCountResult.count ?? 0;

    // Pending invitations reserve seats. Keeping active + valid pending at or
    // below the plan limit prevents concurrent accepts from oversubscribing a
    // subscription even though this compatibility path cannot open a SQL
    // transaction itself.
    if (
      !Number.isFinite(memberLimit) ||
      memberLimit <= 0 ||
      activeCount + reservedPendingCount > memberLimit
    ) {
      return invitationAcceptFailure(
        409,
        "MEMBER_LIMIT_REACHED",
        "This subscription no longer has a safely reserved user seat. Ask the Owner to add capacity or cancel extra pending invitations, then resend this invitation.",
      );
    }
  }

  // Claim the invitation before changing membership. The conditional update
  // prevents a simultaneous Owner cancellation or second accept from racing
  // this request. If membership activation fails, we restore only our claim.
  const claimedAt = new Date().toISOString();
  const { data: claimedInvitation, error: claimError } =
    await supabaseAdmin
      .from("subscription_invitations")
      .update({
        status: "accepted",
        accepted_at: claimedAt,
        updated_at: claimedAt,
      })
      .eq("id", invitation.id)
      .eq("token_hash", tokenHash)
      .eq("status", "pending")
      .gt("expires_at", claimedAt)
      .select("id")
      .maybeSingle();

  if (claimError) {
    console.error(
      "[TENH Invite] Fallback could not claim invitation:",
      claimError.message,
    );
    return invitationAcceptFailure(
      500,
      "INVITE_ACCEPT_FAILED",
      "TENH could not safely claim this invitation. No workspace access was changed.",
      claimError,
    );
  }

  if (!claimedInvitation) {
    return invitationAcceptFailure(
      410,
      "INVITE_EXPIRED",
      "This invitation changed or expired while it was being accepted. No workspace access was changed. Ask the Owner to send a new invitation if needed.",
    );
  }

  let member:
    | {
        id: string;
        business_id: string;
        role: string;
      }
    | null = null;

  if (existingMember?.is_active) {
    // Never change an already-active member's role from an old/stale invite.
    // The invitation is simply consumed and the existing access remains as-is.
    member = {
      id: existingMember.id,
      business_id: invitation.business_id,
      role: existingMember.role,
    };
  } else if (existingMember) {
    const { data, error } = await supabaseAdmin
      .from("team_members")
      .update({
        user_id: userId,
        full_name: invitationMemberName(fullName, normalizedEmail),
        email: normalizedEmail,
        role: invitation.role,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingMember.id)
      .eq("business_id", invitation.business_id)
      .eq("is_active", false)
      .select("id,business_id,role")
      .maybeSingle();

    if (error || !data) {
      await rollbackFallbackInvitationClaim(invitation.id, claimedAt);
      console.error(
        "[TENH Invite] Fallback could not reactivate membership:",
        error?.message ?? "No row returned",
      );
      return invitationAcceptFailure(
        500,
        "INVITE_ACCEPT_FAILED",
        "TENH could not safely activate your workspace access. The invitation was restored and no access was changed.",
        error ?? undefined,
      );
    }

    member = data as {
      id: string;
      business_id: string;
      role: string;
    };
  } else {
    const { data, error } = await supabaseAdmin
      .from("team_members")
      .insert({
        user_id: userId,
        business_id: invitation.business_id,
        full_name: invitationMemberName(fullName, normalizedEmail),
        email: normalizedEmail,
        role: invitation.role,
        profile_picture_url: null,
        is_active: true,
      })
      .select("id,business_id,role")
      .single();

    if (error || !data) {
      await rollbackFallbackInvitationClaim(invitation.id, claimedAt);
      console.error(
        "[TENH Invite] Fallback could not create membership:",
        error?.message ?? "No row returned",
      );
      return invitationAcceptFailure(
        500,
        "INVITE_ACCEPT_FAILED",
        "TENH could not safely create your workspace access. The invitation was restored and no access was changed.",
        error ?? undefined,
      );
    }

    member = data as {
      id: string;
      business_id: string;
      role: string;
    };
  }

  return {
    success: true,
    data: {
      business_id: invitation.business_id,
      subscription_id: invitation.subscription_id,
      member_id: member.id,
      role: invitation.role,
    },
    usedFallback: true,
  };
}

/**
 * Accepts a subscription invitation through the database RPC when available.
 *
 * Some TENH deployments created the invitation tables/routes before the
 * tenh_accept_subscription_invitation RPC was installed. In that one narrow
 * compatibility case, use a guarded server-only fallback. Any other RPC
 * rejection is preserved and never bypassed.
 */
export async function acceptSubscriptionInvitationSafely({
  tokenHash,
  userId,
  email,
  fullName,
}: {
  tokenHash: string;
  userId: string;
  email: string;
  fullName: string;
}): Promise<AcceptSubscriptionInvitationResult> {
  const normalizedEmail = normalizeInvitationEmail(email);

  if (!tokenHash || !userId || !looksLikeInvitationEmail(normalizedEmail)) {
    return invitationAcceptFailure(
      400,
      "INVALID_INVITATION_ACCEPT",
      "TENH could not safely verify this invitation request.",
    );
  }

  const { data, error } = await supabaseAdmin.rpc(
    "tenh_accept_subscription_invitation",
    {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_email: normalizedEmail,
      p_full_name: fullName.trim().slice(0, 120),
    },
  );

  if (!error) {
    const accepted = Array.isArray(data) ? data[0] : data;

    if (!accepted?.business_id || !accepted?.member_id) {
      return invitationAcceptFailure(
        500,
        "INVITE_ACCEPT_FAILED",
        "TENH could not confirm the accepted workspace membership.",
      );
    }

    return {
      success: true,
      data: {
        business_id: accepted.business_id,
        subscription_id: accepted.subscription_id ?? "",
        member_id: accepted.member_id,
        role:
          accepted.role === "owner" ? "owner" : "agent",
      },
      usedFallback: false,
    };
  }

  if (!isMissingInvitationAcceptRpc(error)) {
    return mapInvitationAcceptDatabaseError(error);
  }

  console.warn(
    "[TENH Invite] tenh_accept_subscription_invitation RPC is unavailable; using guarded compatibility acceptance.",
    { code: error.code },
  );

  return acceptInvitationWithoutRpc({
    tokenHash,
    userId,
    email: normalizedEmail,
    fullName,
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendSubscriptionInvitationEmail({
  email,
  businessName,
  role,
  inviterName,
  invitationUrl,
}: {
  email: string;
  businessName: string;
  role: SubscriptionInvitationRole;
  inviterName: string;
  invitationUrl: string;
}) {
  const apiKey =
    process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.TENH_INVITE_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[TENH Invite] Email delivery is not configured. Local invitation URL:",
        invitationUrl,
      );

      return {
        sent: false,
        localPreview: true,
      } as const;
    }

    throw new Error(
      "TENH invitation email is not configured. Set RESEND_API_KEY and TENH_INVITE_FROM_EMAIL.",
    );
  }

  const safeBusiness = escapeHtml(businessName);
  const safeInviter = escapeHtml(inviterName);
  const safeRole =
    role === "owner" ? "Owner" : "Agent";
  const safeUrl = escapeHtml(invitationUrl);

  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Join ${businessName} on TENH Chat`,
        text:
          `${inviterName} invited you to join ${businessName} on TENH Chat as ${safeRole}.\n\n` +
          `Accept invitation: ${invitationUrl}\n\n` +
          "This invitation expires in 7 days.",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
            <h2 style="margin-bottom:12px">Join ${safeBusiness} on TENH Chat</h2>
            <p style="line-height:1.6">${safeInviter} invited you to join this TENH workspace as <strong>${safeRole}</strong>.</p>
            <p style="margin:28px 0">
              <a href="${safeUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">
                Accept invitation
              </a>
            </p>
            <p style="font-size:13px;color:#64748b;line-height:1.6">This invitation expires in 7 days. If you were not expecting it, you can ignore this email.</p>
          </div>
        `,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();

    console.error(
      "[TENH Invite] Email delivery failed:",
      response.status,
      text.slice(0, 500),
    );

    throw new Error(
      "TENH could not send the invitation email. Check the email service and try again.",
    );
  }

  return {
    sent: true,
    localPreview: false,
  } as const;
}
