import { validateAuthMutationRequest } from "@/lib/auth/mutation-request";
import { bakongActor, bakongFailure, bakongJson, bakongPaymentView, checkBakongPayment, loadBakongAttempt } from "@/lib/bakong/payments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ attemptId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await bakongActor(new URL(request.url).searchParams.get("purchase_business") ?? "");
    const attempt = await loadBakongAttempt((await context.params).attemptId, actor.businessId);
    return bakongJson({ success: true, attempt: await bakongPaymentView(attempt, actor) });
  } catch (error) { return bakongFailure(error); }
}
export async function POST(request: Request, context: Context) {
  const validation = validateAuthMutationRequest(request);
  if (!validation.success) return bakongJson(validation, validation.status);
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["businessId", "action"].includes(key)) || body.action !== "check") return bakongJson({ success: false, error: "Invalid payment action." }, 400);
    const actor = await bakongActor(typeof body.businessId === "string" ? body.businessId : "");
    const attempt = await loadBakongAttempt((await context.params).attemptId, actor.businessId);
    const saved = await checkBakongPayment(attempt, actor.userId);
    return bakongJson({ success: true, attempt: await bakongPaymentView(saved, actor) });
  } catch (error) { return bakongFailure(error); }
}
