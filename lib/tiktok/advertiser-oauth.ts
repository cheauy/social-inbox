import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { encryptChannelCredential, decryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { getBusinessSubscriptionAccess } from "@/lib/subscription/get-business-subscription-access";

export const ADVERTISER_CALLBACK_PATH = "/api/tiktok/advertiser/oauth/callback";
export const ADVERTISER_STATE_COOKIE = "tenh_tiktok_advertiser_oauth_state";
export const ADVERTISER_STATE_SECONDS = 600;
export const ADVERTISER_TABLE = "tiktok_advertiser_connections";
const PRODUCTION_ORIGIN = "https://app.tenhchat.com";

export function advertiserEnabled() {
  return process.env.TIKTOK_ADVERTISER_OAUTH_ENABLED === "true";
}

export function advertiserOrigin(request: NextRequest) {
  const url = request.nextUrl;
  if (process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol)) return url.origin;
  return PRODUCTION_ORIGIN;
}

export function sameAdvertiserOrigin(request: NextRequest) {
  const origin = advertiserOrigin(request);
  const site = request.headers.get("sec-fetch-site");
  return request.nextUrl.origin === origin && request.headers.get("origin") === origin &&
    (!site || site === "same-origin");
}

export function advertiserConfig(request: NextRequest) {
  const appId = process.env.TIKTOK_ADVERTISER_APP_ID?.trim() ?? "";
  const secret = process.env.TIKTOK_ADVERTISER_APP_SECRET?.trim() ?? "";
  const callback = new URL(ADVERTISER_CALLBACK_PATH, advertiserOrigin(request)).toString();
  const authorization = new URL(process.env.TIKTOK_ADVERTISER_AUTHORIZATION_URL ?? "");
  // Refuse a runtime that could round TikTok's large numeric scope IDs before any grant is requested.
  const losslessJson = JSON.parse("9007199254740993", (_key: string, value: unknown, context?: { source?: string }) => context?.source ?? value);
  // Only an actual portal-generated advertiser link is accepted; no URL is fabricated.
  if (!/^\d{1,32}$/.test(appId) || !secret || secret.length > 4096 ||
      process.env.TIKTOK_ADVERTISER_TOKEN_MODE !== "long_term" ||
      losslessJson !== "9007199254740993" ||
      authorization.origin !== "https://business-api.tiktok.com" ||
      authorization.pathname !== "/portal/auth" || authorization.username || authorization.password || authorization.hash ||
      [...authorization.searchParams.keys()].some(key => !["app_id", "redirect_uri", "state"].includes(key)) ||
      authorization.searchParams.getAll("app_id").length !== 1 || authorization.searchParams.get("app_id") !== appId ||
      authorization.searchParams.getAll("redirect_uri").length !== 1 || authorization.searchParams.get("redirect_uri") !== callback) {
    throw new Error("Advertiser configuration unavailable.");
  }
  return { appId, secret, callback, authorization };
}

export async function advertiserAccess(checkSubscription = true) {
  try {
    const auth = await getCurrentMember(true);
    if (!auth.success) return { success: false as const, reason: "unauthorized", status: 401 };
    if (!(await memberHasPermission(auth.member, "channels", "manage"))) {
      return { success: false as const, reason: "permission_denied", status: 403 };
    }
    if (checkSubscription && (await getBusinessSubscriptionAccess(auth.member.business_id)).locked) {
      return { success: false as const, reason: "subscription_inactive", status: 403 };
    }
    return { success: true as const, userId: auth.user.id, member: auth.member };
  } catch {
    return { success: false as const, reason: "access_check_failed", status: 503 };
  }
}

type Binding = { userId: string; memberId: string; businessId: string; appId: string; callback: string };
type Attempt = Binding & { type: "tenh-tiktok-advertiser-state-v1"; id: string; nonce: string; issuedAt: number; expiresAt: number };

export function advertiserHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createAdvertiserAttempt(binding: Binding, now = Date.now()) {
  const attempt: Attempt = { ...binding, type: "tenh-tiktok-advertiser-state-v1", id: randomUUID(),
    nonce: randomBytes(32).toString("base64url"), issuedAt: now, expiresAt: now + ADVERTISER_STATE_SECONDS * 1000 };
  return { attempt, cookie: encryptChannelCredential(JSON.stringify(attempt)) };
}

export function verifyAdvertiserAttempt(cookie: string | undefined, state: string | null, binding: Binding, now = Date.now()): Attempt | null {
  if (!cookie || cookie.length > 8192 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
  try {
    const parsed = JSON.parse(decryptChannelCredential(cookie)) as Partial<Attempt>;
    if (parsed.type !== "tenh-tiktok-advertiser-state-v1" ||
        typeof parsed.id !== "string" || !/^[a-f0-9-]{36}$/.test(parsed.id) ||
        typeof parsed.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(parsed.nonce) ||
        !Number.isSafeInteger(parsed.issuedAt) || !Number.isSafeInteger(parsed.expiresAt) ||
        parsed.issuedAt! > now + 30_000 || parsed.expiresAt! <= now ||
        parsed.expiresAt! - parsed.issuedAt! !== ADVERTISER_STATE_SECONDS * 1000 ||
        !Object.entries(binding).every(([key, value]) => parsed[key as keyof Binding] === value) ||
        !timingSafeEqual(Buffer.from(parsed.nonce), Buffer.from(state))) return null;
    return parsed as Attempt;
  } catch { return null; }
}

export function advertiserCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const,
    path: ADVERTISER_CALLBACK_PATH, maxAge: ADVERTISER_STATE_SECONDS };
}

export function advertiserJson(reason: string, status: number) {
  return NextResponse.json({ success: false, reason }, { status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export function finishAdvertiser(request: NextRequest, reason: string, connected = false, connectionId?: string) {
  const url = new URL("/dashboard/integrations", advertiserOrigin(request));
  url.searchParams.set("tiktok_advertiser", connected ? "connected" : "error");
  url.searchParams.set("reason", reason);
  if (connected && connectionId) url.searchParams.set("connection_id", connectionId);
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(ADVERTISER_STATE_COOKIE, "", { ...advertiserCookieOptions(), maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
