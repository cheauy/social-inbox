import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ADVERTISER_STATE_COOKIE, ADVERTISER_TABLE, advertiserAccess, advertiserConfig, advertiserCookieOptions,
  advertiserEnabled, advertiserHash, advertiserJson, createAdvertiserAttempt, sameAdvertiserOrigin,
} from "@/lib/tiktok/advertiser-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!advertiserEnabled()) return advertiserJson("integration_disabled", 503);
  if (!sameAdvertiserOrigin(request)) return advertiserJson("origin_denied", 403);
  const access = await advertiserAccess();
  if (!access.success) return advertiserJson(access.reason, access.status);
  try {
    const config = advertiserConfig(request);
    const { attempt, cookie } = createAdvertiserAttempt({ userId: access.userId, memberId: access.member.id,
      businessId: access.member.business_id, appId: config.appId, callback: config.callback });
    const { error } = await supabaseAdmin.from(ADVERTISER_TABLE).insert({
      id: attempt.id, business_id: attempt.businessId, member_id: attempt.memberId, user_id: attempt.userId,
      app_id: attempt.appId, status: "pending", state_hash: advertiserHash(attempt.nonce),
      state_expires_at: new Date(attempt.expiresAt).toISOString(),
    });
    if (error) return advertiserJson("storage_unavailable", 503);
    config.authorization.searchParams.set("state", attempt.nonce);
    const response = NextResponse.redirect(config.authorization, 303);
    response.cookies.set(ADVERTISER_STATE_COOKIE, cookie, advertiserCookieOptions());
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return advertiserJson("configuration_or_storage_unavailable", 503);
  }
}
