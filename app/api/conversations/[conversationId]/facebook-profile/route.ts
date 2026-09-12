import { NextRequest, NextResponse } from "next/server";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeCustomerProfileLink, getFacebookCustomerProfileUrl } from "@/lib/facebook/customer-profile-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ conversationId: string }> };
const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });
async function load(conversationId: string) {
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return { response: fail(access.error, access.status) };
  const { conversation, businessId, member } = access;
  const [{ data: contact, error: contactError }, { data: page, error: pageError }] = await Promise.all([
    supabaseAdmin.from("contacts").select("id,platform,platform_user_id,facebook_profile_id,facebook_profile_url,updated_at")
      .eq("business_id", businessId).eq("id", conversation.contact_id).maybeSingle(),
    supabaseAdmin.from("social_accounts").select("id,platform,platform_account_id")
      .eq("business_id", businessId).eq("id", conversation.social_account_id).maybeSingle(),
  ]);
  if (contactError || pageError) return { response: fail("Profile storage is unavailable. Apply the seven-updates database migration first.", 503) };
  if (!contact || !page || page.platform !== "facebook" || contact.platform !== "facebook") return { response: fail("A Facebook customer is required.", 400) };
  return { access, contact, page, member };
}
function savedUrl(contact: { facebook_profile_url?: unknown; facebook_profile_id?: string | null; platform_user_id?: string | null }, pageId: string) {
  const url = normalizeCustomerProfileLink(contact.facebook_profile_url ?? getFacebookCustomerProfileUrl(contact), contact.platform_user_id);
  return url && new URL(url).searchParams.get("id") !== pageId ? url : null;
}
export async function GET(_request: NextRequest, context: Context) {
  const loaded = await load((await context.params).conversationId);
  if (loaded.response) return loaded.response;
  return NextResponse.json({ success: true, profileUrl: savedUrl(loaded.contact!, loaded.page!.platform_account_id), updatedAt: loaded.contact!.updated_at });
}
export async function PATCH(request: NextRequest, context: Context) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Invalid request origin.", 403);
  let body: Record<string, unknown>;
  try { const value = await request.json(); if (!value || typeof value !== "object" || Array.isArray(value)) return fail("Invalid request.", 400); body = value; }
  catch { return fail("Invalid request.", 400); }
  const loaded = await load((await context.params).conversationId);
  if (loaded.response) return loaded.response;
  const { access, contact, page } = loaded;
  if (!(await memberHasPermission(access!.member, "customers", "manage"))) return fail("You do not have permission to manage this customer.", 403);
  const removing = body.profileUrl === null || body.profileUrl === "";
  if (!removing && body.confirmed !== true) return fail("Confirm this is the selected customer's public Facebook profile.", 400);
  const supplied = typeof body.profileUrl === "string" ? body.profileUrl.trim() : "";
  const asUrl = /^\d{1,30}$/.test(supplied) ? `https://www.facebook.com/profile.php?id=${supplied}` : supplied;
  const url = removing ? null : normalizeCustomerProfileLink(asUrl, contact!.platform_user_id);
  if (!removing && (!url || new URL(url).searchParams.get("id") === page!.platform_account_id)) return fail("Enter the customer's real public Facebook profile link, not the Page or Messenger customer ID.", 400);
  if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== contact!.updated_at) return fail("Customer details changed. Close this form and try again.", 409);
  let query = supabaseAdmin.from("contacts").update({
    facebook_profile_id: url ? new URL(url).searchParams.get("id") : null,
    facebook_profile_url: url,
    updated_at: new Date().toISOString(),
  }).eq("id", contact!.id).eq("business_id", access!.businessId);
  query = contact!.updated_at ? query.eq("updated_at", contact!.updated_at) : query.is("updated_at", null);
  const { data, error } = await query.select("id,updated_at").maybeSingle();
  if (error) return fail("Unable to save the public profile link.", 500);
  if (!data) return fail("Customer details changed. Reload and try again.", 409);
  return NextResponse.json({ success: true, profileUrl: url, updatedAt: data.updated_at });
}
