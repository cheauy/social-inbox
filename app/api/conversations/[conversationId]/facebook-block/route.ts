import { facebookModerationFailure } from "@/lib/facebook/moderation-error";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getFacebookPageAccessToken, refreshFacebookPageAccessToken, isFacebookAccessTokenError } from "@/lib/facebook/get-facebook-page-access-token";
import { readFacebookBlock, type FacebookBlockMode, type FacebookBlockScope } from "@/lib/facebook/customer-block";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ conversationId: string }> };
const fail = (error: string, status: number, extra = {}) => NextResponse.json({ success: false, error, ...extra }, { status });
async function load(conversationId: string) {
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return { response: fail(access.error, access.status) };
  const { conversation, businessId } = access;
  const [{ data: contact, error: contactError }, { data: page, error: pageError }] = await Promise.all([
    supabaseAdmin.from("contacts").select("id,full_name,platform,platform_user_id").eq("business_id", businessId).eq("id", conversation.contact_id).maybeSingle(),
    supabaseAdmin.from("social_accounts").select("id,platform,platform_account_id,is_active").eq("business_id", businessId).eq("id", conversation.social_account_id).maybeSingle(),
  ]);
  if (contactError || pageError) return { response: fail("Unable to load the Facebook conversation.", 500) };
  if (!contact || !page || contact.platform !== "facebook" || page.platform !== "facebook" || !page.is_active || !/^\d+$/.test(contact.platform_user_id || "") || !/^\d+$/.test(page.platform_account_id || "")) return { response: fail("An active Facebook Page/customer conversation is required.", 400) };
  const scope: FacebookBlockScope = { businessId, socialAccountId: page.id, contactId: contact.id };
  return { access, page, contact, scope };
}
export async function GET(_request: NextRequest, context: Context) {
  try {
    const loaded = await load((await context.params).conversationId);
    if (loaded.response) return loaded.response;
    const result = await readFacebookBlock(loaded.scope!); return NextResponse.json({ success: true, ...result });
  }
  catch { return fail("Unable to check Facebook block status.", 503); }
}
export async function POST(request: NextRequest, context: Context) {
  try { return await updateBlock(request, context); }
  catch { return fail("Unable to prepare the Facebook block change. Please retry.", 503); }
}
async function updateBlock(request: NextRequest, context: Context) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Invalid request origin.", 403);
  let body: { blocked: boolean; mode?: FacebookBlockMode };
  try {
    const value = await request.json();
    if (!value || typeof value.blocked !== "boolean") return fail("Specify whether to block or unblock.", 400);
    if (value.mode !== undefined && !["messages", "page"].includes(value.mode)) return fail("Choose messages or page as the block mode.", 400);
    body = { blocked: value.blocked, mode: value.mode };
  }
  catch { return fail("Invalid request.", 400); }
  const { conversationId } = await context.params;
  const loaded = await load(conversationId); if (loaded.response) return loaded.response;
  const { access, page, contact, scope } = loaded;
  if (!(await memberHasPermission(access!.member, "customers", "manage"))) return fail("You do not have permission to manage this customer.", 403);
  let storage;
  try { storage = await readFacebookBlock(scope!); } catch { return fail("Unable to check Facebook block status.", 503); }
  if (!storage.available || !storage.modesAvailable) return fail("Apply 20260913_facebook_block_modes.sql before changing customer blocks.", 503);
  const base = { business_id: scope!.businessId, social_account_id: scope!.socialAccountId, contact_id: scope!.contactId };
  const initial = await supabaseAdmin.from("facebook_customer_blocks").upsert({ ...base, page_id: page!.platform_account_id, recipient_id: contact!.platform_user_id }, { onConflict: "business_id,social_account_id,contact_id", ignoreDuplicates: true });
  if (initial.error) return fail("Unable to prepare the block operation.", 503);
  const operationId = randomUUID(); const started = new Date().toISOString(); const expiry = new Date(Date.now() - 90000).toISOString();
  const scoped = () => supabaseAdmin.from("facebook_customer_blocks");
  const claim = await scoped().update({ operation_id: operationId, operation_started_at: started, requested_blocked: body.blocked })
    .eq("business_id", base.business_id).eq("social_account_id", base.social_account_id).eq("contact_id", base.contact_id)
    .or(`operation_id.is.null,operation_started_at.lt.${expiry}`).select("contact_id").maybeSingle();
  if (claim.error) return fail("Unable to reserve the block operation.", 503);
  if (!claim.data) return fail("Another agent is updating this customer's block. Please wait and retry.", 409);
  let providerConfirmed = false;
  let mode: FacebookBlockMode = body.mode ?? "messages";
  try {
    // Read again while holding the lease so another agent's completed ban
    // cannot be accidentally treated as a messages-only block.
    const latest = await readFacebookBlock(scope!);
    if (!latest.available || !latest.modesAvailable) return fail("The customer block storage is unavailable.", 503);
    const previousMode = latest.state?.block_mode ?? "messages";
    mode = body.mode ?? (body.blocked ? "messages" : previousMode);
    if (latest.state?.is_blocked && previousMode === "page" && mode === "messages") {
      return fail("This customer is banned from the Page. Remove the Page ban first.", 409);
    }
    const actions = body.blocked
      ? [mode === "page" ? "BAN_USER" : "BLOCK_USER"]
      : mode === "page" ? ["UNBAN_USER", "UNBLOCK_USER"] : ["UNBLOCK_USER"];
    let token = await getFacebookPageAccessToken(page!.platform_account_id);
    const version = process.env.FACEBOOK_GRAPH_VERSION?.trim() || "v26.0";
    const call = (pageToken: string) => fetch(`https://graph.facebook.com/${version}/${page!.platform_account_id}/moderate_conversations`, {
      method: "POST", headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: [{ id: contact!.platform_user_id }], actions }),
      signal: AbortSignal.timeout(12000),
    });
    let response = await call(token); let result = await response.json();
    if (result.error && isFacebookAccessTokenError(result.error)) {
      token = await refreshFacebookPageAccessToken(page!.platform_account_id); response = await call(token); result = await response.json();
    }
    if (!response.ok || result.success !== true) {
      const failure = facebookModerationFailure(result.error, [token]);
      return fail(failure.error, 502, failure);
    }
    providerConfirmed = true;
    const saved = await scoped().update({ is_blocked: body.blocked, block_mode: body.blocked ? mode : "messages", provider_confirmed_at: new Date().toISOString(), updated_by_member_id: access!.member.id, updated_by_name: access!.member.full_name, updated_at: new Date().toISOString(), operation_id: null, operation_started_at: null, requested_blocked: null })
      .eq("business_id", base.business_id).eq("social_account_id", base.social_account_id).eq("contact_id", base.contact_id).eq("operation_id", operationId).select("is_blocked,block_mode,updated_by_name,provider_confirmed_at").maybeSingle();
    if (saved.error || !saved.data) return fail("Facebook applied the change, but TENH could not save the status. Retry the same action to synchronize.", 503, { providerConfirmed: true, requestedBlocked: body.blocked, requestedMode: mode });
    const title = mode === "page" ? (body.blocked ? "Customer banned from Facebook Page and Messenger" : "Customer Page ban and message block removed") : (body.blocked ? "Customer messages blocked on Facebook Page" : "Customer messages unblocked on Facebook Page");
    try { await createConversationActivity({ businessId: scope!.businessId, conversationId, contactId: contact!.id, actorMemberId: access!.member.id, actorName: access!.member.full_name, customerName: contact!.full_name, activityType: "customer_updated", title, metadata: { action: body.blocked ? "facebook_block" : "facebook_unblock", mode, socialAccountId: page!.id, providerConfirmed: true } }); } catch { /* Provider status is already saved. */ }
    return NextResponse.json({ success: true, state: { ...saved.data, operation_id: null, requested_blocked: null }, available: true, modesAvailable: true });
  } catch {
    return fail(providerConfirmed ? "Facebook applied the change but TENH status needs synchronization. Retry the same action." : "Facebook could not confirm the change. Check the customer in Business Suite before retrying.", 502, { providerConfirmed, requestedBlocked: body.blocked, requestedMode: mode });
  } finally {
    // A crash leaves a short lease; another agent may retry after it expires.
    try {
      await scoped().update({ operation_id: null, operation_started_at: null, requested_blocked: null })
        .eq("business_id", base.business_id).eq("social_account_id", base.social_account_id).eq("contact_id", base.contact_id).eq("operation_id", operationId);
    } catch { /* The lease expires; preserve the provider result above. */ }
  }
}
