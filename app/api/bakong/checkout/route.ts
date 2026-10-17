import { validateAuthMutationRequest } from "@/lib/auth/mutation-request";
import { bakongActor, bakongFailure, bakongJson, bakongReadiness, pendingBakong, resumeBakongIntent } from "@/lib/bakong/payments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const actor = await bakongActor(params.get("purchase_business") ?? "");
    const [readiness, pending, resume] = await Promise.all([bakongReadiness(), pendingBakong(actor.businessId), resumeBakongIntent(actor, params.get("purchase_intent"))]);
    return bakongJson({ success: true, ...readiness, pendingAttemptId: pending ?? null, resumeAttemptId: resume.attemptId, intentClosed: resume.closed,
      businessId: actor.businessId, userId: actor.userId, memberId: actor.memberId });
  } catch (error) { return bakongFailure(error); }
}
export async function POST(request: Request) {
  const validation = validateAuthMutationRequest(request);
  if (!validation.success) return bakongJson(validation, validation.status);
  try {
    const body = await request.json();
    const keys = new Set(["businessId", "purchaseIntent", "planCode", "billingCycle", "connections", "users", "renewSame", "customUpgrade", "extensionBillingCycle"]);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !keys.has(key))) return bakongJson({ success: false, error: "Check your payment selection." }, 400);
    await bakongActor(typeof body.businessId === "string" ? body.businessId : "");
    return bakongJson({ success: false, code: "BAKONG_CHECKOUT_RETIRED",
      error: "Direct Bakong checkout is no longer available. Use ABA PayWay or manual bank transfer." }, 410);
  } catch (error) { return bakongFailure(error); }
}
