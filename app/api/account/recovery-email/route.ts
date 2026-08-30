import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase has no built-in "recovery email" field — password resets always
 * go to the primary account email. This stores a secondary address on the
 * user's metadata so support can reach the account owner and so the UI has
 * something real to show. It is a contact address of record, not a second
 * login channel.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type RecoveryBody = {
  recoveryEmail?: unknown;
};

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      {
        success: false,
        error: "Your session has expired. Please sign in again.",
      },
      { status: 401 },
    );
  }

  const stored = user.user_metadata?.recovery_email;

  return NextResponse.json({
    success: true,
    recoveryEmail: typeof stored === "string" ? stored : null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        success: false,
        error: "Your session has expired. Please sign in again.",
      },
      { status: 401 },
    );
  }

  let body: RecoveryBody;

  try {
    body = (await request.json()) as RecoveryBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const raw =
    typeof body.recoveryEmail === "string"
      ? body.recoveryEmail.trim().toLowerCase()
      : "";

  // An empty value clears the recovery email.
  if (raw) {
    if (!EMAIL_PATTERN.test(raw) || raw.length > 254) {
      return NextResponse.json(
        {
          success: false,
          error: "Enter a valid email address.",
        },
        { status: 400 },
      );
    }

    if (raw === user.email?.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Your recovery email must be different from your account email.",
        },
        { status: 400 },
      );
    }
  }

  const { error: updateError } =
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...(user.user_metadata ?? {}),
        recovery_email: raw || null,
      },
    });

  if (updateError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to save your recovery email.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    recoveryEmail: raw || null,
  });
}
