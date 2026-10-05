import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const TIKTOK_OAUTH_STATE_COOKIE =
  "tenh_tiktok_account_holder_oauth_state";
export const TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS =
  10 * 60;

type StatePayload = {
  version: 1;
  state: string;
  memberId: string;
  businessId: string;
  issuedAt: number;
  expiresAt: number;
};

type StateBinding = {
  memberId: string;
  businessId: string;
};

type VerifyInput = StateBinding & {
  cookieValue: string | null | undefined;
  returnedState: string | null | undefined;
  secret: string;
  now?: number;
};

export type TikTokOAuthStateFailure =
  | "missing"
  | "invalid"
  | "expired"
  | "identity_mismatch";

function signature(value: string, secret: string) {
  return createHmac("sha256", secret)
    .update(value)
    .digest("base64url");
}

function safelyEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function validSecret(secret: string) {
  return Buffer.byteLength(secret, "utf8") >= 32;
}

export function createTikTokOAuthState(
  binding: StateBinding,
  secret: string,
  now = Date.now(),
) {
  if (!validSecret(secret)) {
    throw new Error(
      "TIKTOK_OAUTH_STATE_SECRET must be at least 32 bytes.",
    );
  }

  const payload: StatePayload = {
    version: 1,
    state: randomBytes(32).toString("base64url"),
    memberId: binding.memberId,
    businessId: binding.businessId,
    issuedAt: now,
    expiresAt:
      now + TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS * 1000,
  };
  const encoded = Buffer.from(
    JSON.stringify(payload),
  ).toString("base64url");

  return {
    state: payload.state,
    cookieValue: `${encoded}.${signature(encoded, secret)}`,
  };
}

export function verifyTikTokOAuthState(
  input: VerifyInput,
):
  | { success: true }
  | {
      success: false;
      reason: TikTokOAuthStateFailure;
    } {
  if (!input.cookieValue || !input.returnedState) {
    return { success: false, reason: "missing" };
  }

  if (!validSecret(input.secret)) {
    return { success: false, reason: "invalid" };
  }

  try {
    const parts = input.cookieValue.split(".");

    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !safelyEqual(
        signature(parts[0], input.secret),
        parts[1],
      )
    ) {
      return { success: false, reason: "invalid" };
    }

    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString(
        "utf8",
      ),
    ) as Partial<StatePayload>;
    const now = input.now ?? Date.now();
    const maximumLifetime =
      TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS * 1000;

    if (
      payload.version !== 1 ||
      typeof payload.state !== "string" ||
      typeof payload.memberId !== "string" ||
      typeof payload.businessId !== "string" ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.state.length < 32 ||
      payload.state.length > 128 ||
      payload.issuedAt > now + 60_000 ||
      payload.expiresAt - payload.issuedAt !==
        maximumLifetime
    ) {
      return { success: false, reason: "invalid" };
    }

    if (payload.expiresAt <= now) {
      return { success: false, reason: "expired" };
    }

    if (
      !safelyEqual(payload.state, input.returnedState) ||
      !safelyEqual(payload.memberId, input.memberId) ||
      !safelyEqual(
        payload.businessId,
        input.businessId,
      )
    ) {
      return {
        success: false,
        reason: "identity_mismatch",
      };
    }

    return { success: true };
  } catch {
    return { success: false, reason: "invalid" };
  }
}
