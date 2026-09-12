import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/extension/device-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCustomerConversationLink } from "@/lib/facebook/customer-conversation-link";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const auth = await authenticateDevice(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  let body: Record<string, unknown>;
  try { const value = await request.json(); if (!value || typeof value !== "object") throw new Error(); body = value; }
  catch { return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 }); }
  const deny = () => NextResponse.json({ success: false, reason: "conversation_context_mismatch" }, { status: 403 });
  if (typeof body.conversationId !== "string" || body.conversationId.length > 100 ||
      typeof body.pageId !== "string" || !/^\d+$/.test(body.pageId) ||
      typeof body.threadId !== "string" || !/^\d+$/.test(body.threadId) ||
      (body.businessId !== undefined && body.businessId !== auth.device.business_id)) return deny();
  const { data: conversation, error } = await supabaseAdmin.from("conversations")
    .select("id,business_id,social_account_id,contact_id,source_type").eq("id", body.conversationId).eq("business_id", auth.device.business_id).maybeSingle();
  if (error) return NextResponse.json({ success: false, error: "Unable to verify conversation." }, { status: 503 });
  if (!conversation) return deny();
  const [{ data: page, error: pageError }, { data: contact, error: contactError }] = await Promise.all([
    supabaseAdmin.from("social_accounts").select("id,platform,platform_account_id,is_active").eq("id", conversation.social_account_id).eq("business_id", auth.device.business_id).maybeSingle(),
    supabaseAdmin.from("contacts").select("id,platform,platform_user_id,full_name").eq("id", conversation.contact_id).eq("business_id", auth.device.business_id).maybeSingle(),
  ]);
  if (pageError || contactError) return NextResponse.json({ success: false, error: "Unable to verify Page/customer." }, { status: 503 });
  if (!page || !contact || !page.is_active || page.platform !== "facebook" || contact.platform !== "facebook" ||
      page.platform_account_id !== body.pageId || contact.platform_user_id !== body.threadId) return deny();
  if (body.profileLookup === true && conversation.source_type !== "messenger") return deny();
  let profileContext = {};
  if (body.profileLookup === true) {
    const link = await getCustomerConversationLink(page.platform_account_id, contact.platform_user_id);
    if ("reason" in link) return NextResponse.json({ success: false, reason: link.reason }, { status: 424 });
    profileContext = { ...link, sourceType: conversation.source_type };
  }
  return NextResponse.json({ success: true, verified: true, businessId: auth.device.business_id, conversationId: conversation.id, pageId: page.platform_account_id, threadId: contact.platform_user_id,
    ...profileContext });
}
