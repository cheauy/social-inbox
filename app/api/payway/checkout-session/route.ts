import { NextResponse } from "next/server";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { payWayCheckoutSessionClosedAt } from "@/lib/payway/checkout-lifetime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers });

// This closes only TENH's checkout UI session. It never calls provider Close,
// changes financial status, releases a pending payment, or edits access/history.
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ success: false }, 403);
    const body = await request.json() as { transactionId?: unknown; businessId?: unknown; confirmed?: unknown };
    if (body.confirmed !== true || typeof body.transactionId !== "string" || !/^[A-Za-z0-9_-]{1,20}$/.test(body.transactionId) ||
        typeof body.businessId !== "string" || !uuid.test(body.businessId)) return json({ success: false }, 400);
    const auth = await (await createClient()).auth.getUser();
    if (auth.error || !auth.data.user) return json({ success: false }, 401);
    const member = await supabaseAdmin.from("team_members").select("id,role")
      .eq("business_id", body.businessId).eq("user_id", auth.data.user.id).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (member.error) throw new Error();
    if (!member.data || !(await memberHasPermission(member.data, "billing", "manage"))) return json({ success: false }, 404);
    const identity = { transactionId: body.transactionId, businessId: body.businessId };
    // Compare-and-swap the original metadata and status. A concurrent provider
    // observation/approval wins or forces a bounded reread; no evidence is lost.
    for (let retry = 0; retry < 3; retry++) {
      const saved = await supabaseAdmin.from("billing_transactions").select("id,status,metadata")
        .eq("provider", "payway").eq("provider_transaction_id", body.transactionId).eq("business_id", body.businessId).maybeSingle();
      if (saved.error) throw new Error();
      if (!saved.data) return json({ success: false }, 404);
      if (saved.data.status === "approved") return json({ success: true, outcome: "paid", ...identity });
      const closedAt = payWayCheckoutSessionClosedAt(saved.data.metadata);
      if (closedAt) return json({ success: true, outcome: "closed", closedAt, ...identity });
      if (!["pending", "processing", "draft", "created"].includes(saved.data.status)) return json({ success: false, error: "Refresh this payment before closing checkout." }, 409);
      const metadata = saved.data.metadata;
      if (metadata !== null && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) return json({ success: false }, 409);
      if (metadata?.checkout_session !== undefined) return json({ success: false, error: "This checkout session requires review." }, 409);
      const now = new Date().toISOString();
      let update = supabaseAdmin.from("billing_transactions").update({ metadata: { ...metadata,
        checkout_session: { version: 1, state: "closed", closed_at: now, closed_by_member_id: member.data.id } } })
        .eq("id", saved.data.id).eq("business_id", body.businessId).eq("provider", "payway").eq("status", saved.data.status);
      update = metadata === null ? update.is("metadata", null) : update.eq("metadata", JSON.stringify(metadata));
      const changed = await update.select("id").maybeSingle();
      if (changed.error) throw new Error();
      if (changed.data) return json({ success: true, outcome: "closed", closedAt: now, ...identity });
    }
    return json({ success: false, error: "Payment changed while closing checkout. Refresh its status." }, 409);
  } catch {
    return json({ success: false, error: "Unable to end checkout. Your saved payment is unchanged." }, 503);
  }
}
