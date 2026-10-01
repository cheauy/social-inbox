import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const guard = await requirePermission("channels", "manage");
  if (!guard.success) return guard.response;
  try {
    const body = await request.json();
    if (!body || typeof body.hold !== "boolean" || typeof body.conversationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.conversationId)) return NextResponse.json({ error: "Invalid conversation hold." }, { status: 400 });
    const access = await getInboxConversationAccess(body.conversationId);
    if (!access.success || access.businessId !== guard.context.member.business_id) return NextResponse.json({ error: "Conversation unavailable." }, { status: 404 });
    const result = await db.rpc("tenh_bot_set_human_hold", { p_business: access.businessId, p_conversation: body.conversationId, p_hold: body.hold });
    if (result.error || result.data !== true) return NextResponse.json({ error: "Bot hold storage unavailable." }, { status: 503 });
    return NextResponse.json({ success: true, hold: body.hold, note: "Old jobs remain cancelled. This does not activate a Bot." }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Invalid conversation hold." }, { status: 400 }); }
}
