import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { revokeAdvertiserGrant } from "@/lib/tiktok/advertiser-api";
import {
  ADVERTISER_TABLE, advertiserAccess, advertiserConfig, advertiserEnabled, advertiserHash, advertiserJson, sameAdvertiserOrigin,
} from "@/lib/tiktok/advertiser-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ connectionId: string }> };

async function connectionAccess(context: Context) {
  if (!advertiserEnabled()) return { response: advertiserJson("integration_disabled", 503) };
  // Revocation remains available to an authorized member whose subscription expired.
  const access = await advertiserAccess(false);
  if (!access.success) return { response: advertiserJson(access.reason, access.status) };
  const { connectionId } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(connectionId)) return { response: advertiserJson("not_found", 404) };
  return { businessId: access.member.business_id, connectionId };
}

export async function GET(_request: NextRequest, context: Context) {
  const access = await connectionAccess(context);
  if (access.response) return access.response;
  try {
    const { data, error } = await supabaseAdmin.from(ADVERTISER_TABLE)
      .select("id,app_id,status,advertiser_ids,scopes,connected_at,disconnected_at")
      .eq("id", access.connectionId).eq("business_id", access.businessId).maybeSingle();
    if (error) return advertiserJson("storage_unavailable", 503);
    if (!data) return advertiserJson("not_found", 404);
    // Explicit allowlist also protects against accidental expansion of the database select.
    return NextResponse.json({ success: true, connection: { id: data.id, appId: data.app_id, status: data.status,
      advertiserIds: data.advertiser_ids, scopes: data.scopes, connectedAt: data.connected_at, disconnectedAt: data.disconnected_at } },
    { headers: { "Cache-Control": "no-store" } });
  } catch { return advertiserJson("storage_unavailable", 503); }
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!advertiserEnabled()) return advertiserJson("integration_disabled", 503);
  if (!sameAdvertiserOrigin(request)) return advertiserJson("origin_denied", 403);
  const access = await connectionAccess(context);
  if (access.response) return access.response;
  try {
    const config = advertiserConfig(request);
    const operationId = randomUUID();
    const claimed = await supabaseAdmin.rpc("tenh_claim_tiktok_advertiser_disconnect", {
      p_id: access.connectionId, p_business_id: access.businessId, p_app_id: config.appId, p_operation_id: operationId,
    });
    if (claimed.error || !claimed.data) return advertiserJson("storage_unavailable", 503);
    const claim = claimed.data;
    const success = () => NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    if (claim.outcome === "disconnected") return success();
    if (claim.outcome === "not_found") return advertiserJson("not_found", 404);
    if (claim.outcome === "busy") return advertiserJson("reconciliation_required", 409);
    if (!["claimed", "confirmed"].includes(claim.outcome)) return advertiserJson("connection_not_ready", 409);
    if (typeof claim.operation_id !== "string" || !/^[a-f0-9-]{36}$/.test(claim.operation_id) ||
        typeof claim.token_hash !== "string" || !/^[a-f0-9]{64}$/.test(claim.token_hash)) {
      return advertiserJson("storage_unavailable", 503);
    }
    const scopedRow = (patch: Record<string, unknown>) => supabaseAdmin.from(ADVERTISER_TABLE).update(patch)
      .eq("id", access.connectionId).eq("business_id", access.businessId).eq("app_id", config.appId)
      .eq("token_hash", claim.token_hash).eq("revoke_operation_id", claim.operation_id);
    if (claim.outcome === "claimed") {
      // No lease stealing: an owner may still be executing TikTok's non-transactional request.
      if (claim.operation_id !== operationId) return advertiserJson("storage_unavailable", 503);
      const token = decryptChannelCredential(claim.access_token_encrypted);
      if (advertiserHash(token) !== claim.token_hash) return advertiserJson("reconciliation_required", 503);
      await revokeAdvertiserGrant(config, token);
      // Persist a receipt separately from credential clearing. Retry ONLY this idempotent local write.
      let recorded = false;
      const confirmedAt = new Date().toISOString();
      for (let retry = 0; retry < 2 && !recorded; retry++) {
        try {
          const receipt = await scopedRow({ revoke_confirmed_at: confirmedAt })
            .eq("status", "revocation_pending").select("id").maybeSingle();
          recorded = !receipt.error && Boolean(receipt.data);
        } catch { /* A lost storage response is not permission to repeat the provider request. */ }
      }
      if (!recorded) return advertiserJson("reconciliation_required", 503);
    }
    // A retry with a durable code-0 receipt performs storage cleanup without contacting TikTok.
    const cleared = await scopedRow({ status: "disconnected", access_token_encrypted: null,
      disconnected_at: new Date().toISOString() }).eq("status", "revocation_pending")
      .not("revoke_confirmed_at", "is", null).select("id").maybeSingle();
    if (cleared.error || !cleared.data) {
      const current = await supabaseAdmin.from(ADVERTISER_TABLE).select("status")
        .eq("id", access.connectionId).eq("business_id", access.businessId).eq("app_id", config.appId)
        .eq("token_hash", claim.token_hash).eq("revoke_operation_id", claim.operation_id).maybeSingle();
      if (current.error || current.data?.status !== "disconnected") return advertiserJson("storage_cleanup_required", 503);
    }
    return success();
  } catch { return advertiserJson("reconciliation_required", 503); }
}
