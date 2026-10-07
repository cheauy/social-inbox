import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { AdvertiserGrantError, exchangeAdvertiserCode } from "@/lib/tiktok/advertiser-api";
import {
  ADVERTISER_STATE_COOKIE, ADVERTISER_TABLE, advertiserAccess, advertiserConfig, advertiserEnabled,
  advertiserHash, finishAdvertiser, verifyAdvertiserAttempt,
} from "@/lib/tiktok/advertiser-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!advertiserEnabled()) return finishAdvertiser(request, "integration_disabled");
  const access = await advertiserAccess();
  if (!access.success) return finishAdvertiser(request, access.reason);
  let config: ReturnType<typeof advertiserConfig>;
  try { config = advertiserConfig(request); } catch { return finishAdvertiser(request, "configuration_missing"); }
  const states = request.nextUrl.searchParams.getAll("state");
  const attempt = verifyAdvertiserAttempt(request.cookies.get(ADVERTISER_STATE_COOKIE)?.value,
    states.length === 1 ? states[0] : null, { userId: access.userId, memberId: access.member.id,
      businessId: access.member.business_id, appId: config.appId, callback: config.callback });
  if (!attempt) return finishAdvertiser(request, "invalid_state");
  const scopedRow = (patch: Record<string, unknown>) => supabaseAdmin.from(ADVERTISER_TABLE).update(patch)
    .eq("id", attempt.id).eq("business_id", attempt.businessId).eq("member_id", attempt.memberId)
    .eq("user_id", attempt.userId).eq("app_id", attempt.appId);
  try {
    const { data, error } = await scopedRow({ status: "exchanging", state_hash: null, state_expires_at: null })
      .eq("status", "pending").eq("state_hash", advertiserHash(attempt.nonce))
      .gt("state_expires_at", new Date().toISOString()).select("id").maybeSingle();
    if (error) return finishAdvertiser(request, "storage_unavailable");
    if (!data) return finishAdvertiser(request, "invalid_state");
  } catch { return finishAdvertiser(request, "storage_unavailable"); }

  let token: string | null = null;
  let tokenIsExisting = false;
  try {
    const denied = ["error", "error_code", "error_description", "error_message"].some(key => request.nextUrl.searchParams.has(key));
    const codes = request.nextUrl.searchParams.getAll("auth_code");
    if (denied || codes.length !== 1 || !codes[0].trim() || codes[0].length > 4096 || /\s/.test(codes[0])) {
      await scopedRow({ status: "failed" }).eq("status", "exchanging");
      return finishAdvertiser(request, denied ? "authorization_denied" : "malformed_callback");
    }
    const grant = await exchangeAdvertiserCode(config, codes[0]);
    token = grant.accessToken;
    // The SQL proposal serializes saves and disconnect claims by app/token fingerprint.
    // Disconnected fingerprints remain reserved, so a late exchange cannot resurrect a revoked grant.
    const saved = await supabaseAdmin.rpc("tenh_save_tiktok_advertiser_grant", {
      p_id: attempt.id, p_business_id: attempt.businessId, p_member_id: attempt.memberId,
      p_user_id: attempt.userId, p_app_id: config.appId, p_token_hash: advertiserHash(token),
      p_encrypted: encryptChannelCredential(token), p_advertiser_ids: grant.advertiserIds, p_scopes: grant.scopes,
    });
    tokenIsExisting = saved.data === "conflict";
    if (saved.error || saved.data !== "connected") throw new Error("Grant persistence failed.");
    return finishAdvertiser(request, "authorized", true, attempt.id);
  } catch (error) {
    if (error instanceof AdvertiserGrantError) token = error.accessToken;
    let reason = tokenIsExisting ? "grant_already_connected" : "authorization_failed";
    if (token && !tokenIsExisting) {
      try {
        // Reconcile an ambiguous save for reporting only. No lookup can authorize revocation:
        // another exchange may return/save this same provider token after this snapshot.
        const existing = await supabaseAdmin.from(ADVERTISER_TABLE).select("id,status")
          .eq("app_id", config.appId).eq("token_hash", advertiserHash(token))
          .limit(1);
        if (existing.error) throw new Error("Unable to verify compensation.");
        if (existing.data?.some(row => row.id === attempt.id && row.status === "connected")) {
          return finishAdvertiser(request, "authorized", true, attempt.id);
        }
        if (existing.data?.length) reason = "grant_already_connected";
        else reason = "provider_cleanup_required";
      } catch { reason = "provider_cleanup_required"; }
    }
    try { await scopedRow({ status: "failed" }).eq("status", "exchanging"); } catch { /* No raw errors or credentials are logged. */ }
    return finishAdvertiser(request, reason);
  }
}
