import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { supabaseAdmin } from "@/lib/supabase/admin";

const TRIAL_DEVICE_COOKIE = "tenh_trial_device";
const IP_WINDOW_DAYS = 30;
const MAX_TRIALS_PER_IP_WINDOW = 2;

type TrialClaimRow = {
  id: string;
  user_id: string;
  email_hash: string;
  device_hash: string;
  ip_hash: string | null;
  business_id: string | null;
  trial_granted: boolean;
  claimed_at: string;
};

export type TrialReservation =
  | {
      eligible: true;
      claimId: string;
      reason: "reserved" | "retry_pending_claim";
    }
  | {
      eligible: false;
      reason:
        | "account_already_used_trial"
        | "email_already_used_trial"
        | "device_already_used_trial"
        | "network_trial_limit_reached"
        | "trial_security_unavailable";
    };

export type TrialDeniedReason = Extract<
  TrialReservation,
  { eligible: false }
>["reason"];

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");

  if (at <= 0) {
    return normalized;
  }

  let local = normalized.slice(0, at);
  let domain = normalized.slice(at + 1);

  // Gmail/Googlemail aliases point to the same mailbox. Canonicalizing them
  // prevents repeated trials through dots or +aliases on the same account.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    domain = "gmail.com";
    local = local.split("+")[0]?.replace(/\./g, "") ?? local;
  }

  return `${local}@${domain}`;
}

function getSecuritySecret() {
  const secret =
    process.env.TENH_TRIAL_SECURITY_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();

  if (!secret) {
    throw new Error(
      "TENH trial security is not configured. Set TENH_TRIAL_SECURITY_SECRET or SUPABASE_SECRET_KEY.",
    );
  }

  return secret;
}

function hashValue(value: string) {
  return createHmac("sha256", getSecuritySecret())
    .update(value)
    .digest("hex");
}

function getRequestIp(request: Request) {
  const direct =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim();

  if (direct) {
    return direct;
  }

  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "";
}

async function getOrCreateTrialDeviceId() {
  const cookieStore = await cookies();
  const existing = cookieStore.get(TRIAL_DEVICE_COOKIE)?.value?.trim();

  if (existing) {
    return existing;
  }

  const value = randomUUID();

  cookieStore.set(TRIAL_DEVICE_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 2,
  });

  return value;
}

function isMissingTrialSecurityTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;

  return (
    error.code === "42P01" ||
    /tenh_trial_claims/i.test(error.message ?? "")
  );
}

async function loadSingleClaim(
  column: "user_id" | "email_hash" | "device_hash",
  value: string,
) {
  const { data, error } = await supabaseAdmin
    .from("tenh_trial_claims")
    .select(
      "id,user_id,email_hash,device_hash,ip_hash,business_id,trial_granted,claimed_at",
    )
    .eq(column, value)
    .maybeSingle();

  if (error) {
    if (isMissingTrialSecurityTable(error)) {
      throw new Error(
        "TENH trial security database is not installed. Run supabase/20260819_v3_11_31_40_trial_security.sql first.",
      );
    }

    throw error;
  }

  return (data ?? null) as TrialClaimRow | null;
}

export async function getTrialClaimForUser(userId: string) {
  try {
    return await loadSingleClaim("user_id", userId);
  } catch (error) {
    console.error("[TENH] Unable to read existing trial claim", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return null;
  }
}

/**
 * Reserves a free-trial claim before a new self-serve workspace is created.
 *
 * Protection layers:
 * - one trial per Supabase user id;
 * - one trial per normalized email;
 * - one trial per TENH browser/device cookie;
 * - at most two trial claims from the same public IP in a rolling 30-day window.
 *
 * Raw email addresses, device ids, IP addresses, and user agents are never
 * written to the trial-security table; only HMAC hashes are stored.
 */
export async function reserveFreeTrial(
  userId: string,
  email: string,
  request: Request,
): Promise<TrialReservation> {
  try {
    const normalizedEmail = normalizeEmail(email);
    const deviceId = await getOrCreateTrialDeviceId();
    const ip = getRequestIp(request);
    const userAgent = request.headers.get("user-agent")?.trim() ?? "";

    const emailHash = hashValue(`email:${normalizedEmail}`);
    const deviceHash = hashValue(`device:${deviceId}`);
    const ipHash = ip ? hashValue(`ip:${ip}`) : null;
    const userAgentHash = userAgent
      ? hashValue(`ua:${userAgent}`)
      : null;

    const existingUserClaim = await loadSingleClaim("user_id", userId);

    if (existingUserClaim) {
      if (!existingUserClaim.business_id && !existingUserClaim.trial_granted) {
        return {
          eligible: true,
          claimId: existingUserClaim.id,
          reason: "retry_pending_claim",
        };
      }

      return {
        eligible: false,
        reason: "account_already_used_trial",
      };
    }

    const existingEmailClaim = await loadSingleClaim("email_hash", emailHash);

    if (existingEmailClaim) {
      return {
        eligible: false,
        reason: "email_already_used_trial",
      };
    }

    const existingDeviceClaim = await loadSingleClaim("device_hash", deviceHash);

    if (existingDeviceClaim) {
      return {
        eligible: false,
        reason: "device_already_used_trial",
      };
    }

    if (ipHash) {
      const cutoff = new Date(
        Date.now() - IP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { count, error: ipCountError } = await supabaseAdmin
        .from("tenh_trial_claims")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("claimed_at", cutoff);

      if (ipCountError) {
        if (isMissingTrialSecurityTable(ipCountError)) {
          throw new Error(
            "TENH trial security database is not installed. Run supabase/20260819_v3_11_31_40_trial_security.sql first.",
          );
        }

        throw ipCountError;
      }

      if ((count ?? 0) >= MAX_TRIALS_PER_IP_WINDOW) {
        return {
          eligible: false,
          reason: "network_trial_limit_reached",
        };
      }
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("tenh_trial_claims")
      .insert({
        user_id: userId,
        email_hash: emailHash,
        device_hash: deviceHash,
        ip_hash: ipHash,
        user_agent_hash: userAgentHash,
        business_id: null,
        trial_granted: false,
      })
      .select("id")
      .single();

    if (insertError) {
      if (isMissingTrialSecurityTable(insertError)) {
        throw new Error(
          "TENH trial security database is not installed. Run supabase/20260819_v3_11_31_40_trial_security.sql first.",
        );
      }

      // Unique constraints close the race where two registrations reach this
      // point at the same time with the same account/email/device.
      if (insertError.code === "23505") {
        const [userClaim, emailClaim, deviceClaim] = await Promise.all([
          loadSingleClaim("user_id", userId),
          loadSingleClaim("email_hash", emailHash),
          loadSingleClaim("device_hash", deviceHash),
        ]);

        if (userClaim && !userClaim.business_id && !userClaim.trial_granted) {
          return {
            eligible: true,
            claimId: userClaim.id,
            reason: "retry_pending_claim",
          };
        }

        if (userClaim) {
          return { eligible: false, reason: "account_already_used_trial" };
        }

        if (emailClaim) {
          return { eligible: false, reason: "email_already_used_trial" };
        }

        if (deviceClaim) {
          return { eligible: false, reason: "device_already_used_trial" };
        }
      }

      throw insertError;
    }

    return {
      eligible: true,
      claimId: inserted.id as string,
      reason: "reserved",
    };
  } catch (error) {
    console.error("[TENH] Trial security check failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      eligible: false,
      reason: "trial_security_unavailable",
    };
  }
}

export async function completeFreeTrialClaim(
  claimId: string,
  businessId: string,
) {
  const { error } = await supabaseAdmin
    .from("tenh_trial_claims")
    .update({
      business_id: businessId,
      trial_granted: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", claimId);

  if (error) {
    console.error("[TENH] Unable to complete free-trial claim", {
      code: error.code,
      message: error.message,
    });

    throw error;
  }
}
