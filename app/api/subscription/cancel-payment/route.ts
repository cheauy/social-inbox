import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { cancelPayment } from "@/lib/billing/cancel-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Origin" };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function POST(request: Request) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ success: false }, 403);
  try {
    const body = await request.json();
    const { kind, paymentId, businessId, action, confirmed } = body ?? {};
    if (!["manual", "payway", "bakong"].includes(kind) || typeof paymentId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(paymentId) || typeof businessId !== "string" || !uuid.test(businessId) ||
      !["cancel", "withdraw"].includes(action) || confirmed !== true || (action === "withdraw" && kind !== "manual")) {
      return reply({ success: false, error: "A confirmed payment cancellation or proof withdrawal is required." }, 400);
    }
    const auth = await (await createClient()).auth.getUser();
    if (auth.error || !auth.data.user) return reply({ success: false }, (auth.error?.status ?? 0) >= 500 ? 503 : 401);
    const member = await supabaseAdmin.from("team_members").select("id,role,business_id")
      .eq("user_id", auth.data.user.id).eq("business_id", businessId).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (member.error) return reply({ success: false }, 503);
    if (!member.data || !(await memberHasPermission(member.data, "billing", "manage"))) return reply({ success: false }, 403);
    const outcome = await cancelPayment({ kind, paymentId, businessId, actorId: auth.data.user.id,
      memberId: member.data.id, withdraw: action === "withdraw" });
    return reply({ success: true, outcome });
  } catch (error) {
    return reply({ success: false, error: error instanceof SyntaxError ? "Invalid cancellation request." :
      "Unable to confirm cancellation. Refresh the saved payment status. Do not pay again while its status is uncertain." }, error instanceof SyntaxError ? 400 : 409);
  }
}
