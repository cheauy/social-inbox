import "server-only";

import type { User } from "@supabase/supabase-js";

import type { AuthenticatedMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureWorkspaceDefaultContent } from "@/lib/settings/ensure-workspace-default-content";
import {
  completeFreeTrialClaim,
  getTrialClaimForUser,
  reserveFreeTrial,
  type TrialDeniedReason,
} from "@/lib/onboarding/trial-security";

const TRIAL_DAYS = 7;
const TRIAL_CHANNEL_LIMIT = 3;
const TRIAL_MEMBER_LIMIT = 1;

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

async function hasExistingMembership(userId: string, email: string) {
  const [{ data: byUser, error: byUserError }, { data: byEmail, error: byEmailError }] =
    await Promise.all([
      supabaseAdmin
        .from("team_members")
        .select("id")
        .eq("user_id", userId)
        .limit(1),
      supabaseAdmin
        .from("team_members")
        .select("id")
        .ilike("email", email)
        .limit(1),
    ]);

  if (byUserError || byEmailError) {
    throw byUserError ?? byEmailError;
  }

  return (byUser?.length ?? 0) > 0 || (byEmail?.length ?? 0) > 0;
}

async function callWorkspaceRpc(user: User, email: string) {
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
    throw error;
  }

  const member = Array.isArray(data)
    ? data[0]
    : data;

  return member
    ? (member as AuthenticatedMember)
    : null;
}

async function applySevenDayTrial(businessId: string) {
  const startedAt = new Date();
  const endsAt = new Date(
    startedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  );

  const { error } = await supabaseAdmin
    .from("business_subscriptions")
    .update({
      plan_code: "trial",
      status: "trialing",
      trial_started_at: startedAt.toISOString(),
      trial_ends_at: endsAt.toISOString(),
      current_period_start: startedAt.toISOString(),
      current_period_end: endsAt.toISOString(),
      member_limit: TRIAL_MEMBER_LIMIT,
      channel_limit: TRIAL_CHANNEL_LIMIT,
    })
    .eq("business_id", businessId)
    .eq("status", "trialing");

  if (error) {
    throw error;
  }
}

async function lockWorkspaceWithoutTrial(businessId: string) {
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("business_subscriptions")
    .update({
      plan_code: "trial",
      status: "expired",
      trial_started_at: null,
      trial_ends_at: null,
      current_period_start: now,
      current_period_end: now,
      member_limit: TRIAL_MEMBER_LIMIT,
      channel_limit: TRIAL_CHANNEL_LIMIT,
    })
    .eq("business_id", businessId)
    .eq("status", "trialing");

  if (error) {
    throw error;
  }
}

async function getTrialSubscription(businessId: string) {
  const { data, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select("id,business_id,plan_code,status,trial_started_at,trial_ends_at")
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.plan_code !== "trial" || data.status !== "trialing") {
    return null;
  }

  return data;
}

export type ProvisionWorkspaceResult =
  | {
      success: true;
      member: AuthenticatedMember;
      trialGranted: boolean | null;
      trialDays: number | null;
      channelLimit: number | null;
      memberLimit: number | null;
      trialDeniedReason?: TrialDeniedReason;
    }
  | {
      success: false;
      error: string;
      code: "NO_EMAIL" | "PROVISION_FAILED" | "TRIAL_SECURITY_UNAVAILABLE";
    };

/**
 * Production TENH self-serve onboarding.
 *
 * The existing PostgreSQL RPC remains the source of truth for creating/linking
 * the business and owner membership. TENH then applies the current free-trial
 * policy on the server:
 * - 7 days;
 * - 3 channel connections;
 * - 1 user seat;
 * - anti-abuse reservation before a brand-new self-serve trial is granted.
 *
 * Existing/invited members are never treated as a new free-trial request.
 */
export async function provisionUserWorkspace(
  user: User,
  request: Request,
): Promise<ProvisionWorkspaceResult> {
  const email = user.email?.trim().toLowerCase();

  if (!email) {
    return {
      success: false,
      error: "A verified email address is required.",
      code: "NO_EMAIL",
    };
  }

  try {
    const existingMembership = await hasExistingMembership(user.id, email);

    if (existingMembership) {
      const member = await callWorkspaceRpc(user, email);

      if (!member) {
        return {
          success: false,
          error: "Unable to connect this login to its TENH workspace.",
          code: "PROVISION_FAILED",
        };
      }

      // Some TENH databases provision the first trial inside PostgreSQL before
      // this application route runs. If this is that brand-new trial, attach
      // the anti-abuse claim and normalize it to the current 7-day / 3-channel
      // / 1-user policy. Existing trials are backfilled by the SQL migration,
      // so they are preserved instead of being shortened retroactively.
      const trialSubscription = await getTrialSubscription(member.business_id);

      if (trialSubscription) {
        const existingClaim = await getTrialClaimForUser(user.id);

        if (
          existingClaim?.trial_granted &&
          existingClaim.business_id === member.business_id
        ) {
          return {
            success: true,
            member,
            trialGranted: null,
            trialDays: null,
            channelLimit: null,
            memberLimit: null,
          };
        }

        const reservation = await reserveFreeTrial(user.id, email, request);

        if (!reservation.eligible && reservation.reason === "trial_security_unavailable") {
          return {
            success: false,
            error:
              "TENH could not safely verify free-trial eligibility. Run the trial-security SQL migration and try again.",
            code: "TRIAL_SECURITY_UNAVAILABLE",
          };
        }

        if (reservation.eligible) {
          await applySevenDayTrial(member.business_id);
          await completeFreeTrialClaim(reservation.claimId, member.business_id);

          return {
            success: true,
            member,
            trialGranted: true,
            trialDays: TRIAL_DAYS,
            channelLimit: TRIAL_CHANNEL_LIMIT,
            memberLimit: TRIAL_MEMBER_LIMIT,
          };
        }

        await lockWorkspaceWithoutTrial(member.business_id);

        return {
          success: true,
          member,
          trialGranted: false,
          trialDays: 0,
          channelLimit: 0,
          memberLimit: 1,
          trialDeniedReason: reservation.reason,
        };
      }

      return {
        success: true,
        member,
        trialGranted: null,
        trialDays: null,
        channelLimit: null,
        memberLimit: null,
      };
    }

    const reservation = await reserveFreeTrial(user.id, email, request);

    if (!reservation.eligible && reservation.reason === "trial_security_unavailable") {
      return {
        success: false,
        error:
          "TENH could not safely verify free-trial eligibility. Run the trial-security SQL migration and try again.",
        code: "TRIAL_SECURITY_UNAVAILABLE",
      };
    }

    const member = await callWorkspaceRpc(user, email);

    if (!member) {
      return {
        success: false,
        error: "Unable to create your TENH workspace.",
        code: "PROVISION_FAILED",
      };
    }

    // Every newly-created TENH workspace receives its own starter tags and
    // quick replies. These are ordinary workspace rows and can be edited or
    // deleted without changing any other subscription/workspace.
    try {
      await ensureWorkspaceDefaultContent(member.business_id);
    } catch (seedError) {
      console.error(
        "Unable to initialize TENH workspace starter content:",
        seedError,
      );
    }

    if (reservation.eligible) {
      await applySevenDayTrial(member.business_id);
      await completeFreeTrialClaim(reservation.claimId, member.business_id);

      return {
        success: true,
        member,
        trialGranted: true,
        trialDays: TRIAL_DAYS,
        channelLimit: TRIAL_CHANNEL_LIMIT,
        memberLimit: TRIAL_MEMBER_LIMIT,
      };
    }

    // The account may still exist and buy a subscription, but it receives no
    // additional free access when TENH detects a prior trial claim.
    await lockWorkspaceWithoutTrial(member.business_id);

    return {
      success: true,
      member,
      trialGranted: false,
      trialDays: 0,
      channelLimit: 0,
      memberLimit: 1,
      trialDeniedReason: reservation.reason,
    };
  } catch (error) {
    console.error(
      "Unable to provision TENH workspace:",
      {
        code:
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : undefined,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    );

    return {
      success: false,
      error: "Unable to provision your TENH workspace.",
      code: "PROVISION_FAILED",
    };
  }
}

/** Backwards-compatible helper for any older TENH call sites. */
export async function ensureUserWorkspace(
  user: User,
  request: Request,
): Promise<AuthenticatedMember | null> {
  const result = await provisionUserWorkspace(user, request);
  return result.success ? result.member : null;
}
