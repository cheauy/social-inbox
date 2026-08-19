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
