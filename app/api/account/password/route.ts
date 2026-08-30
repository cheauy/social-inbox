import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient as createStandaloneClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Per-instance throttle on wrong current-password guesses. This is not a
 * substitute for a real rate limiter, but it stops a stolen session from
 * brute-forcing the existing password through this endpoint.
 */
const attempts = new Map<
  string,
  { count: number; firstAt: number }
>();

function tooManyAttempts(userId: string) {
  const record = attempts.get(userId);

  if (!record) {
    return false;
  }

  if (Date.now() - record.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.delete(userId);
    return false;
  }

  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(userId: string) {
  const record = attempts.get(userId);

  if (!record || Date.now() - record.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(userId, { count: 1, firstAt: Date.now() });
    return;
  }

  record.count += 1;
}

/**
 * Whether the account actually has a password.
 *
 * auth.identities is NOT reliable here: setting a password on an
 * OAuth-created account does not add an "email" identity row
 * (supabase/auth #2085, #2472). Without the SQL helper the account would
 * look password-less forever and this endpoint would keep skipping the
 * current-password check — a session-hijack hole. The SQL function reads
 * auth.users.encrypted_password, which is authoritative.
 *
 * If the helper is not installed we fall back to the identity check and
 * report it, so the UI can warn instead of silently running unprotected.
 */
async function resolveHasPassword(
  supabase: Awaited<ReturnType<typeof createClient>>,
  identityFallback: boolean,
) {
  const { data, error } = await supabase.rpc(
    "tenh_account_has_password",
  );

  if (error) {
    return { hasPassword: identityFallback, authoritative: false };
  }

  return { hasPassword: data === true, authoritative: true };
}

export async function GET() {
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

  const identityFallback = (user.identities ?? []).some(
    (identity) => identity.provider === "email",
  );

  const { hasPassword, authoritative } = await resolveHasPassword(
    supabase,
    identityFallback,
  );

  return NextResponse.json({
    success: true,
    hasPassword,
    passwordCheckAuthoritative: authoritative,
  });
}

type PasswordBody = {
  currentPassword?: unknown;
  newPassword?: unknown;
  signOutOtherSessions?: unknown;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user || !user.email) {
    return NextResponse.json(
      {
        success: false,
        error: "Your session has expired. Please sign in again.",
      },
      { status: 401 },
    );
  }

  let body: PasswordBody;

  try {
    body = (await request.json()) as PasswordBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";

  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  const signOutOtherSessions = body.signOutOtherSessions !== false;

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      {
        success: false,
        error: `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  if (newPassword === currentPassword) {
    return NextResponse.json(
      {
        success: false,
        error: "Your new password must be different from the current one.",
      },
      { status: 400 },
    );
  }

  // An account with no password yet (OAuth-only) is allowed to set one
  // for the first time. Any account that already has a password must
  // prove it knows the current one.
  const identityFallback = (user.identities ?? []).some(
    (identity) => identity.provider === "email",
  );

  const { hasPassword: hasPasswordIdentity } =
    await resolveHasPassword(supabase, identityFallback);

  if (hasPasswordIdentity) {
    if (tooManyAttempts(user.id)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Too many incorrect attempts. Please wait 15 minutes and try again.",
        },
        { status: 429 },
      );
    }

    if (!currentPassword) {
      return NextResponse.json(
        {
          success: false,
          requiresCurrentPassword: true,
          error: "Enter your current password.",
        },
        { status: 400 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Password change is not configured on this server.",
        },
        { status: 500 },
      );
    }

    // Verification happens on a throwaway client so the caller's real
    // session and cookies are never touched.
    const verifier = createStandaloneClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data: verifyData, error: verifyError } =
      await verifier.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

    // signInWithPassword mints a real session. Revoke it immediately or it
    // shows up as a phantom device on the Active sessions page.
    const throwawayToken = verifyData?.session?.access_token;

    if (throwawayToken) {
      try {
        await supabaseAdmin.auth.admin.signOut(throwawayToken, "local");
      } catch {
        /* Best effort — the session expires on its own regardless. */
      }
    }

    if (verifyError || !verifyData?.user) {
      recordFailure(user.id);

      return NextResponse.json(
        {
          success: false,
          error: "Your current password is incorrect.",
        },
        { status: 400 },
      );
    }

    if (verifyData.user.id !== user.id) {
      return NextResponse.json(
        { success: false, error: "Unable to verify your password." },
        { status: 400 },
      );
    }

    attempts.delete(user.id);
  }

  const { error: updateError } =
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

  if (updateError) {
    return NextResponse.json(
      {
        success: false,
        error: updateError.message || "Unable to update your password.",
      },
      { status: 400 },
    );
  }

  let othersSignedOut = false;

  if (signOutOtherSessions) {
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "others",
    });

    othersSignedOut = !signOutError;
  }

  return NextResponse.json({
    success: true,
    wasFirstPassword: !hasPasswordIdentity,
    hasPassword: true,
    othersSignedOut,
  });
}
