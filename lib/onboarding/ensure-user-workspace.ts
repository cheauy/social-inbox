import "server-only";

import type { User } from "@supabase/supabase-js";

import type { AuthenticatedMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

function normalizeText(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function getMetadata(user: User) {
  return (user.user_metadata ?? {}) as Record<
    string,
    unknown
  >;
}

function getFullName(user: User) {
  const metadata = getMetadata(user);

  const candidates = [
    metadata.full_name,
    metadata.name,
    metadata.display_name,
  ];

  for (const candidate of candidates) {
    const value = normalizeText(candidate);

    if (value) {
      return value.slice(0, 120);
    }
  }

  const emailName =
    user.email?.split("@")[0]?.trim() ?? "";

  return (emailName || "TENH Owner").slice(
    0,
    120,
  );
}

function getBusinessName(user: User) {
  const metadata = getMetadata(user);

  const candidates = [
    metadata.business_name,
    metadata.workspace_name,
    metadata.company_name,
  ];

  for (const candidate of candidates) {
    const value = normalizeText(candidate);

    if (value) {
      return value.slice(0, 120);
    }
  }

  return `${getFullName(user)}'s Workspace`.slice(
    0,
    120,
  );
}

/**
 * Production TENH self-serve onboarding.
 *
 * The PostgreSQL RPC is atomic and idempotent. It will:
 * - return an existing active member when one already exists;
 * - link a matching pending member row when applicable;
 * - refuse to reactivate an intentionally inactive member;
 * - otherwise create a new business + owner + 14-day trial.
 */
export async function ensureUserWorkspace(
  user: User,
): Promise<AuthenticatedMember | null> {
  const email = user.email?.trim().toLowerCase();

  if (!email) {
    return null;
  }

  const { data, error } = await supabaseAdmin.rpc(
    "tenh_ensure_user_workspace",
    {
      p_user_id: user.id,
      p_full_name: getFullName(user),
      p_email: email,
      p_business_name: getBusinessName(user),
    },
  );

  if (error) {
    console.error(
      "Unable to provision TENH workspace:",
      {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
    );

    return null;
  }

  const member = Array.isArray(data)
    ? data[0]
    : data;

  if (!member) {
    return null;
  }

  return member as AuthenticatedMember;
}
