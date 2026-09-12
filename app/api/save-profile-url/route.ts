import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice, recordExtensionEvent } from "@/lib/extension/device-auth";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { businessSubscriptionIsOperational } from "@/lib/subscription/is-operational-subscription";
import { normalizeCustomerProfileLink, getFacebookCustomerProfileUrl } from "@/lib/facebook/customer-profile-url";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** TENH profile synchronization. Reuses the existing Supabase contacts,
 * device credentials and member permissions. A browser observation is not
 * a public-ID conversion or independent Meta identity verification. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const failure = (error: string, status: number, code = "profile_sync_failed") =>
  NextResponse.json({ success: false, error, code }, { status, headers: { "Cache-Control": "no-store" } });
const validId = (value: unknown): value is string => typeof value === "string" && /^\d{1,30}$/.test(value);

export async function POST(request: NextRequest) {
  let businessId: string;
  let member: { id: string; role: string; full_name: string | null };
  let deviceId: string | null = null;
  let userId: string | null = null;
  if (request.headers.get("authorization")?.toLowerCase().startsWith("bearer ")) {
    const auth = await authenticateDevice(request);
    if (!auth.success) return failure(auth.error, auth.status, "device_unauthorized");
    businessId = auth.device.business_id;
    member = auth.member;
    deviceId = auth.device.id;
    userId = auth.device.user_id;
  } else {
    // Cookie writes require an explicit same-origin browser request.
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return failure("A same-origin signed-in TENH request is required.", 403, "invalid_origin");
    const auth = await getCurrentMember();
    if (!auth.success) return failure(auth.error, auth.status, "unauthorized");
    businessId = auth.member.business_id;
    member = auth.member;
    userId = auth.member.user_id;
    if (!(await businessSubscriptionIsOperational(businessId))) return failure("This subscription is not active.", 409);
  }
  if (!(await memberHasPermission(member, "customers", "manage")))
    return failure("You do not have permission to update customer profiles.", 403, "permission_denied");

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return failure("Request too large.", 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return failure("A JSON object is required.", 400);
    body = parsed;
  } catch { return failure("Invalid JSON request.", 400); }
  if (!validId(body.psid) || typeof body.publicProfileUrl !== "string")
    return failure("psid must be a numeric string and publicProfileUrl must be a string.", 400);
  if (body.pageId !== undefined && !validId(body.pageId)) return failure("Invalid pageId.", 400);
  if (body.businessId !== undefined && body.businessId !== businessId) return failure("Workspace mismatch.", 403);
  if (body.conversationId !== undefined && (typeof body.conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.conversationId)))
    return failure("Invalid conversationId.", 400);

  const { data: contacts, error: contactsError } = await supabaseAdmin.from("contacts")
    .select("id,platform_user_id,facebook_profile_id,facebook_profile_url,updated_at")
    .eq("business_id", businessId).eq("platform", "facebook").eq("platform_user_id", body.psid).limit(25);
  if (contactsError) return failure("Profile storage is unavailable. Verify the existing profile-field migration.", 503);
  if (!contacts?.length) return failure("Customer is not yet present in this workspace. Retry after the conversation has synchronized.", 404, "customer_not_found");
  let query = supabaseAdmin.from("conversations").select("id,contact_id,social_account_id")
    .eq("business_id", businessId).in("contact_id", contacts.map(c => c.id)).limit(100);
  if (typeof body.conversationId === "string") query = query.eq("id", body.conversationId);
  const { data: conversations, error: conversationError } = await query;
  if (conversationError) return failure("Unable to verify the customer conversation.", 503);
  if (contacts.length >= 25 || conversations?.length === 100) return failure("Too many matching records. Supply the exact conversationId.", 409, "profile_context_ambiguous");
  if (!conversations?.length) return failure("A matching conversation is required.", 404, "conversation_not_found");
  const accountIds = [...new Set(conversations.map(c => c.social_account_id).filter((x): x is string => typeof x === "string"))];
  if (!accountIds.length) return failure("A connected Facebook Page is required.", 409);
  const { data: accounts, error: pageError } = await supabaseAdmin.from("social_accounts")
    .select("id,platform_account_id").eq("business_id", businessId).eq("platform", "facebook").eq("is_active", true).in("id", accountIds);
  if (pageError) return failure("Unable to verify connected Pages.", 503);
  const tuples = new Map<string, { contactId: string; accountId: string; pageId: string; conversationId: string }>();
  for (const conversation of conversations) {
    const page = accounts?.find(a => a.id === conversation.social_account_id);
    if (!page || !validId(page.platform_account_id) || !conversation.contact_id ||
      (body.pageId !== undefined && body.pageId !== page.platform_account_id)) continue;
    tuples.set(`${page.platform_account_id}:${conversation.contact_id}`, {
      contactId: conversation.contact_id, accountId: page.id, pageId: page.platform_account_id, conversationId: conversation.id,
    });
  }
  if (tuples.size !== 1) return failure(tuples.size ? "More than one Page/customer matches. Supply pageId or conversationId." : "Page/customer context does not match.", tuples.size ? 409 : 403, "profile_context_ambiguous");
  const matched = [...tuples.values()][0];
  const contact = contacts.find(c => c.id === matched.contactId)!;
  const profileUrl = normalizeCustomerProfileLink(body.publicProfileUrl, body.psid);
  if (!profileUrl || new URL(profileUrl).pathname === "/me" || new URL(profileUrl).searchParams.get("id") === matched.pageId)
    return failure("Use the actual public Facebook profile link, not a Messenger PSID or Page ID.", 400, "invalid_profile_url");
  if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== contact.updated_at)
    return failure("Customer changed while the profile was being saved. Retry using the current context.", 409, "profile_conflict");
  const oldUrl = normalizeCustomerProfileLink(contact.facebook_profile_url || getFacebookCustomerProfileUrl(contact), body.psid);
  if (oldUrl && oldUrl !== profileUrl && new URL(oldUrl).searchParams.get("id") !== matched.pageId)
    return failure("A different public profile is already saved for this customer. An authorized agent must review it; automatic sync will not overwrite it.", 409, "profile_conflict");
  if (contact.facebook_profile_url === profileUrl)
    return NextResponse.json({ success: true, psid: body.psid, pageId: matched.pageId, publicProfileUrl: profileUrl, conversationId: matched.conversationId, businessId, unchanged: true }, { headers: { "Cache-Control": "no-store" } });
  let update = supabaseAdmin.from("contacts").update({
    facebook_profile_url: profileUrl, facebook_profile_id: new URL(profileUrl).searchParams.get("id"), updated_at: new Date().toISOString(),
  }).eq("business_id", businessId).eq("id", contact.id);
  update = contact.updated_at ? update.eq("updated_at", contact.updated_at) : update.is("updated_at", null);
  const { data: saved, error: saveError } = await update.select("id,updated_at").maybeSingle();
  if (saveError) return failure("Unable to save the profile link.", 500);
  if (!saved) return failure("Customer changed during synchronization. Retry the observation.", 409, "profile_conflict");
  await recordExtensionEvent({ businessId, deviceId, memberId: member.id, userId,
    socialAccountId: matched.accountId, conversationId: matched.conversationId,
    eventType: "customer_profile_url_synced", status: "saved", metadata: { source: deviceId ? "extension_reported" : "agent_reported", identityVerifiedByMeta: false } });
  return NextResponse.json({ success: true, psid: body.psid, pageId: matched.pageId, publicProfileUrl: profileUrl,
    conversationId: matched.conversationId, businessId, updatedAt: saved.updated_at, source: deviceId ? "extension_reported" : "agent_reported", identityVerifiedByMeta: false }, { headers: { "Cache-Control": "no-store" } });
}
