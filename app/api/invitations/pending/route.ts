import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { acceptSubscriptionInvitationSafely } from "@/lib/team/subscription-invitations";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

/**
 * In-app alerts for invitations sent to an email that already belongs to a
 * TENH account.
 *
 * The raw invitation token is never stored — only its hash — so these
 * endpoints work by invitation id instead. That is not a weaker check: the
 * security boundary here is that the signed-in user's VERIFIED email must
 * equal the invited email. Knowing an id gets you nothing without the
 * matching inbox.
 *
 * team_notifications is keyed by (business_id, recipient_member_id), and an
 * invited person has no member row in that workspace yet, so it cannot
 * carry these. This is a separate, email-keyed surface.
 */

function errorResponse(error: string, status: number, code?: string) {
  return NextResponse.json(
    { success: false, error, ...(code ? { code } : {}) },
    { status, headers: NO_STORE_HEADERS },
  );
}

type InvitationRow = {
  id: string;
  business_id: string;
  subscription_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
  token_hash: string;
};

async function requireVerifiedUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false as const, status: 401 };
  }

  // An unverified address must never claim an invitation — otherwise
  // signing up with someone else's email would be enough to steal it.
  if (!user.email_confirmed_at || !user.email) {
    return { ok: false as const, status: 403 };
  }

  return {
    ok: true as const,
    user,
    email: user.email.trim().toLowerCase(),
  };
}

export async function GET() {
  const auth = await requireVerifiedUser();

  if (!auth.ok) {
    // A quiet empty list keeps the dashboard banner from erroring for
    // users who simply have no verified email yet.
    return NextResponse.json(
      { success: true, invitations: [] },
      { headers: NO_STORE_HEADERS },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("subscription_invitations")
    .select(
      "id, business_id, subscription_id, email, role, status, expires_at, created_at",
    )
    .eq("email", auth.email)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return errorResponse(
      "Unable to load your pending invitations.",
      500,
      "PENDING_INVITES_FAILED",
    );
  }

  const rows = (data ?? []) as Omit<InvitationRow, "token_hash">[];

  if (rows.length === 0) {
    return NextResponse.json(
      { success: true, invitations: [] },
      { headers: NO_STORE_HEADERS },
    );
  }

  // Skip workspaces the user is already an active member of, so a stale
  // invitation never nags someone who has already joined.
  const { data: memberships } = await supabaseAdmin
    .from("team_members")
    .select("business_id")
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  const joined = new Set(
    (memberships ?? []).map((row) => row.business_id as string),
  );

  const pending = rows.filter((row) => !joined.has(row.business_id));

  const { data: businesses } = await supabaseAdmin
    .from("businesses")
    .select("id, name")
    .in(
      "id",
      pending.length > 0 ? pending.map((row) => row.business_id) : [""],
    );

  const nameById = new Map(
    (businesses ?? []).map((row) => [row.id as string, row.name as string]),
  );

  return NextResponse.json(
    {
      success: true,
      invitations: pending.map((row) => ({
        id: row.id,
        role: row.role,
        email: row.email,
        expiresAt: row.expires_at,
        businessName:
          nameById.get(row.business_id)?.trim() || "TENH Workspace",
        subscriptionLabel: `#${row.subscription_id
          .slice(0, 8)
          .toUpperCase()}`,
      })),
    },
    { headers: NO_STORE_HEADERS },
  );
}

type AcceptBody = {
  invitationId?: unknown;
};

export async function POST(request: NextRequest) {
  const auth = await requireVerifiedUser();

  if (!auth.ok) {
    return auth.status === 401
      ? errorResponse(
          "Sign in with the invited email before accepting.",
          401,
          "SIGN_IN_REQUIRED",
        )
      : errorResponse(
          "Verify your email address before accepting this invitation.",
          403,
          "EMAIL_NOT_VERIFIED",
        );
  }

  let body: AcceptBody;

  try {
    body = (await request.json()) as AcceptBody;
  } catch {
    return errorResponse("Invalid request.", 400, "INVALID_REQUEST");
  }

  const invitationId =
    typeof body.invitationId === "string" ? body.invitationId.trim() : "";

  if (!invitationId) {
    return errorResponse(
      "An invitationId is required.",
      400,
      "INVITE_ID_REQUIRED",
    );
  }

  const { data, error } = await supabaseAdmin
    .from("subscription_invitations")
    .select("id, email, status, expires_at, token_hash")
    .eq("id", invitationId)
    .maybeSingle();

  if (error || !data) {
    return errorResponse(
      "This TENH invitation could not be found.",
      404,
      "INVITE_NOT_FOUND",
    );
  }

  const invitation = data as Pick<
    InvitationRow,
    "id" | "email" | "status" | "expires_at" | "token_hash"
  >;

  // The security boundary: the invitation must belong to this verified
  // email address. Everything else below is a friendliness check.
  if (invitation.email.trim().toLowerCase() !== auth.email) {
    return errorResponse(
      "This invitation was sent to a different email address.",
      403,
      "INVITE_EMAIL_MISMATCH",
    );
  }

  if (
    invitation.status !== "pending" ||
    Date.parse(invitation.expires_at) <= Date.now()
  ) {
    return errorResponse(
      "This invitation has expired or is no longer available.",
      410,
      "INVITE_EXPIRED",
    );
  }

  // Use the same guarded acceptance path as the secure token link. The
  // database RPC remains preferred; a compatibility path is used only when
  // that RPC is genuinely missing from an older TENH deployment.
  const acceptResult = await acceptSubscriptionInvitationSafely({
    tokenHash: invitation.token_hash,
    userId: auth.user.id,
    email: auth.email,
    fullName:
      typeof auth.user.user_metadata?.full_name === "string"
        ? auth.user.user_metadata.full_name
        : "",
  });

  if (!acceptResult.success) {
    if (acceptResult.code === "INVITE_ACCEPT_FAILED") {
      console.error(
        "[TENH Invite] In-app accept failed without changing workspace access.",
        acceptResult.debug ?? { code: acceptResult.code },
      );
    } else {
      console.warn(
        "[TENH Invite] In-app safe accept rejected:",
        acceptResult.code,
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: acceptResult.error,
        code: acceptResult.code,
        ...(process.env.NODE_ENV !== "production" && acceptResult.debug
          ? { debug: acceptResult.debug }
          : {}),
      },
      { status: acceptResult.status, headers: NO_STORE_HEADERS },
    );
  }

  const accepted = acceptResult.data;

  const response = NextResponse.json(
    {
      success: true,
      businessId: accepted.business_id,
      role: accepted.role ?? null,
    },
    { headers: NO_STORE_HEADERS },
  );

  response.cookies.set(TENH_ACTIVE_BUSINESS_COOKIE, accepted.business_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
