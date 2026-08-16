import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

type AdminFailureCode =
  | "unauthenticated"
  | "config_missing"
  | "identity_mismatch"
  | "email_unverified"
  | "mfa_required";

type AdminFailure = {
  success: false;
  status: 401 | 403 | 503;
  code: AdminFailureCode;
  error: string;
};

type AdminSuccess = {
  success: true;
  user: User;
};

export type TenhAdminAuthResult = AdminSuccess | AdminFailure;

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeUuid(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isTenhAdminMfaRequired() {
  return (
    process.env.TENH_ADMIN_REQUIRE_MFA?.trim().toLowerCase() ===
    "true"
  );
}

function getTenhAdminConfig() {
  const userId = normalizeUuid(process.env.TENH_ADMIN_USER_ID);
  const email = normalizeEmail(process.env.TENH_ADMIN_EMAIL);

  if (!userId || !isUuid(userId) || !email) {
    return null;
  }

  return {
    userId,
    email,
  };
}

/**
 * Identity-only TENH admin check.
 *
 * This deliberately does NOT enforce AAL2. It is used for:
 * - showing the Admin navigation item to the real admin;
 * - allowing the dedicated /dashboard/admin/mfa challenge page.
 *
 * Sensitive admin pages/APIs use getTenhAdminUser(), which adds the MFA gate.
 */
export async function getTenhAdminIdentityUser(): Promise<TenhAdminAuthResult> {
  const config = getTenhAdminConfig();

  if (!config) {
    return {
      success: false,
      status: 503,
      code: "config_missing",
      error:
        "TENH Administration is not configured. Set TENH_ADMIN_USER_ID and TENH_ADMIN_EMAIL on the server.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      success: false,
      status: 401,
      code: "unauthenticated",
      error: "Unauthorized.",
    };
  }

  const userId = normalizeUuid(user.id);
  const email = normalizeEmail(user.email);

  // Both immutable-ish account id and expected email must match.
  if (userId !== config.userId || email !== config.email) {
    return {
      success: false,
      status: 403,
      code: "identity_mismatch",
      error: "This account is not authorized for TENH Administration.",
    };
  }

  if (!user.email_confirmed_at) {
    return {
      success: false,
      status: 403,
      code: "email_unverified",
      error: "The TENH administrator email must be verified.",
    };
  }

  return {
    success: true,
    user,
  };
}

/**
 * Full TENH admin authorization.
 *
 * Security boundary:
 * 1) server-validated Supabase user;
 * 2) exact Supabase user UUID match;
 * 3) exact normalized email match;
 * 4) confirmed email;
 * 5) optional AAL2 when TENH_ADMIN_REQUIRE_MFA=true.
 */
export async function getTenhAdminUser(): Promise<TenhAdminAuthResult> {
  const identity = await getTenhAdminIdentityUser();

  if (!identity.success) {
    return identity;
  }

  if (!isTenhAdminMfaRequired()) {
    return identity;
  }

  const supabase = await createClient();
  const {
    data: assurance,
    error: assuranceError,
  } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (
    assuranceError ||
    !assurance ||
    assurance.currentLevel !== "aal2"
  ) {
    return {
      success: false,
      status: 403,
      code: "mfa_required",
      error:
        "TENH Administration requires multi-factor authentication for this session.",
    };
  }

  return identity;
}

/**
 * Header visibility only. This is not the authorization boundary.
 * We intentionally use the identity-only check so the admin can still see the
 * Admin entry point when an MFA challenge is required.
 */
export async function isCurrentUserTenhAdminIdentity() {
  const result = await getTenhAdminIdentityUser();
  return result.success;
}

export async function requireTenhAdminIdentityPage() {
  const result = await getTenhAdminIdentityUser();

  if (!result.success) {
    if (result.status === 401) {
      redirect("/login?next=/dashboard/admin/mfa");
    }

    redirect("/dashboard");
  }

  return result.user;
}

export async function requireTenhAdminPage() {
  const result = await getTenhAdminUser();

  if (!result.success) {
    if (result.status === 401) {
      redirect("/login?next=/dashboard/admin");
    }

    if (result.code === "mfa_required") {
      redirect("/dashboard/admin/mfa");
    }

    redirect("/dashboard");
  }

  return result.user;
}

function safeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF / cross-origin protection for state-changing TENH admin APIs.
 */
export function validateTenhAdminMutationRequest(
  request: Request,
): { success: true } | AdminFailure {
  const originHeader = request.headers.get("origin");
  const requestOrigin = safeOrigin(request.url);
  const suppliedOrigin = originHeader
    ? safeOrigin(originHeader)
    : null;

  if (
    !requestOrigin ||
    !suppliedOrigin ||
    suppliedOrigin !== requestOrigin
  ) {
    return {
      success: false,
      status: 403,
      code: "identity_mismatch",
      error: "Forbidden admin request origin.",
    };
  }

  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite && fetchSite !== "same-origin") {
    return {
      success: false,
      status: 403,
      code: "identity_mismatch",
      error: "Cross-site admin requests are not allowed.",
    };
  }

  const contentType =
    request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    return {
      success: false,
      status: 403,
      code: "identity_mismatch",
      error: "Admin mutations require application/json.",
    };
  }

  return { success: true };
}

export async function getTenhAdminMutationUser(
  request: Request,
): Promise<TenhAdminAuthResult> {
  const requestCheck = validateTenhAdminMutationRequest(request);

  if (!requestCheck.success) {
    return requestCheck;
  }

  return getTenhAdminUser();
}
