import { NextResponse } from "next/server";
import { validateAuthMutationRequest } from "@/lib/auth/mutation-request";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { authJson, clearAuthSessionCookies } from "@/lib/auth/auth-flow";

import { createClient } from "@/lib/supabase/server";
import {
  loadInvitationByToken,
} from "@/lib/team/subscription-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 128;

function normalizeText(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function looksLikeEmail(value: string) {
  return (
    value.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function isRetryableAuthError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };

  const name =
    typeof value.name === "string"
      ? value.name.toLowerCase()
      : "";

  const code =
    typeof value.code === "string"
      ? value.code.toLowerCase()
      : "";

  const message =
    typeof value.message === "string"
      ? value.message.toLowerCase()
      : "";

  const status =
    typeof value.status === "number"
      ? value.status
      : null;

  return (
    name.includes("authretryablefetcherror") ||
    code.includes("retryable") ||
    (status !== null && status >= 500) ||
    message.includes("network request failed") ||
    message.includes("fetch failed")
  );
}

function publicAuthError(error: unknown) {
  const fallback =
    "Unable to create your account right now. Please try again.";

  if (!error || typeof error !== "object") {
    return {
      message: fallback,
      status: 400,
      code: "REGISTER_FAILED",
    };
  }

  const value = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
  };

  const code =
    typeof value.code === "string"
      ? value.code.toLowerCase()
      : "";

  const rawMessage =
    typeof value.message === "string"
      ? value.message.trim()
      : "";

  const message = rawMessage.toLowerCase();

  // Supabase JS 2.112.3+ preserves the JSON body for 5xx Auth responses.
  // Check actionable messages before falling back to a generic retryable
  // service error.
  if (
    message.includes("error sending confirmation") ||
    message.includes("confirmation email") ||
    message.includes("confirmation mail") ||
    message.includes("smtp")
  ) {
    return {
      message:
        "TENH could not send the verification email right now. Please wait a moment and try again. If this continues, the TENH email service needs attention.",
      status: 503,
      code: "VERIFICATION_EMAIL_FAILED",
    };
  }

  if (
    value.status === 429 ||
    code === "over_request_rate_limit" ||
    code.includes("email_rate") ||
    code.includes("over_email_send_rate_limit") ||
    message.includes("email rate limit") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return {
      message:
        "Too many signup or verification emails were requested. Please wait before trying again.",
      status: 429,
      code: "RATE_LIMITED",
    };
  }

  if (isRetryableAuthError(error)) {
    return {
      message:
        "TENH could not reach the authentication service. Please wait a moment and try again.",
      status: 503,
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    };
  }

  if (
    code === "user_already_exists" ||
    code === "email_exists"
  ) {
    return {
      message:
        "This email is already registered. Please sign in.",
      status: 409,
      code: "ACCOUNT_EXISTS",
    };
  }

  if (
    code.includes("weak_password") ||
    (message.includes("password") &&
      message.includes("weak"))
  ) {
    return {
      message:
        "Please choose a stronger password with at least 8 characters, including letters and numbers.",
      status: 400,
      code: "WEAK_PASSWORD",
    };
  }

  if (
    code.includes("signup_disabled") ||
    message.includes("signups not allowed") ||
    message.includes("signup is disabled")
  ) {
    return {
      message:
        "New account registration is temporarily unavailable. Please try again later.",
      status: 503,
      code: "SIGNUP_DISABLED",
    };
  }

  return {
    message: fallback,
    status:
      typeof value.status === "number" &&
      value.status >= 400 &&
      value.status <= 599
        ? value.status
        : 400,
    code: "REGISTER_FAILED",
  };
}

async function signUpOnce(
  email: string,
  password: string,
  fullName: string,
  workspaceName: string | null,
  redirectTo: string,
) {
  const supabase = await createClient({ authFlow: true });

  // Signup is a write operation. Do not automatically retry it: the first
  // request may have reached Supabase even if the response was interrupted.
  // This avoids duplicate confirmation-email attempts and keeps account
  // creation deterministic.
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectTo,
      data: {
        full_name: fullName,
        ...(workspaceName
          ? { business_name: workspaceName }
          : {}),
      },
    },
  });
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const validation = validateAuthMutationRequest(request);
  if (!validation.success) return authJson({ success: false, code: validation.code, error: validation.error }, validation.status);
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        code: "INVALID_BODY",
        error: "Invalid registration request.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const payload =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};

  const fullName = normalizeText(payload.fullName);
  const workspaceName = normalizeText(payload.workspaceName);
  const inviteToken = normalizeText(payload.inviteToken);
  const email = normalizeEmail(payload.email);
  const rate = await consumeAuthRateLimit(request, "signup", email);
  if (!rate.allowed) return authJson({ success: false, error: rate.unavailable ? "Registration is temporarily unavailable." : "Too many attempts. Try again later." }, rate.unavailable ? 503 : 429, { "Retry-After": String(rate.retryAfterSeconds) });
  const password =
    typeof payload.password === "string"
      ? payload.password
      : "";

  let invitation:
    | Awaited<ReturnType<typeof loadInvitationByToken>>
    | null = null;

  if (inviteToken) {
    try {
      invitation =
        await loadInvitationByToken(inviteToken);
    } catch {
      return NextResponse.json(
        {
          success: false,
          code: "INVITE_VERIFY_FAILED",
          error:
            "TENH could not verify this invitation. Please reopen the invitation link and try again.",
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const inviteExpired =
      invitation?.expires_at
        ? Date.parse(invitation.expires_at) <= Date.now()
        : true;

    if (
      !invitation ||
      invitation.status !== "pending" ||
      inviteExpired
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "INVITE_EXPIRED",
          error:
            "This invitation has expired or is no longer available. Ask the workspace Owner to send a new invitation.",
        },
        {
          status: 410,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (
      invitation.email.trim().toLowerCase() !== email
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "INVITE_EMAIL_MISMATCH",
          error:
            "Use the same email address that received this TENH invitation.",
        },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }

  if (
    !fullName ||
    fullName.length > MAX_NAME_LENGTH ||
    (!inviteToken && !workspaceName) ||
    workspaceName.length > MAX_NAME_LENGTH ||
    !looksLikeEmail(email) ||
    !password ||
    payload.confirmPassword !== password ||
    password.length < 8 ||
    password.length > MAX_PASSWORD_LENGTH ||
    !/[A-Za-z]/.test(password) ||
    !/\d/.test(password)
  ) {
    return NextResponse.json(
      {
        success: false,
        code: "INVALID_INPUT",
        error:
          inviteToken
            ? "Check your name, invited email, and password, then try again."
            : "Check your name, workspace, email, and password, then try again.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    const { data, error } =
      await signUpOnce(
        email,
        password,
        fullName,
        invitation ? null : workspaceName,
        `${requestUrl.origin}/auth/confirm?next=${encodeURIComponent(inviteToken ? `/invite/accept?token=${encodeURIComponent(inviteToken)}` : "/dashboard/inbox")}`,
      );

    if (error) {
      const safe = publicAuthError(error);
      if (safe.code === "ACCOUNT_EXISTS") return authJson({ success: false, code: safe.code, error: safe.message }, safe.status);

      console.warn("[TENH] Registration rejected by auth service", {
        code: safe.code,
        status: safe.status,
      });

      return NextResponse.json(
        {
          success: false,
          code: safe.code,
          error: safe.message,
        },
        {
          status: safe.status,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (!data.user) {
      return NextResponse.json(
        {
          success: false,
          code: "REGISTER_FAILED",
          error:
            "Unable to create your account right now. Please try again.",
        },
        {
          status: 502,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (data.session) await clearAuthSessionCookies();
    return authJson({ success: true, message: "If registration can be completed, check your email." }, 202);
  } catch (error) {
    const safe = publicAuthError(error);
    if (safe.code === "ACCOUNT_EXISTS") return authJson({ success: false, code: safe.code, error: safe.message }, safe.status);

    console.warn("[TENH] Registration request failed safely", {
      status: safe.status,
      code: safe.code,
      type:
        error && typeof error === "object" && "name" in error
          ? String(error.name)
          : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        code: safe.code,
        error: safe.message,
      },
      {
        status: safe.status,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
