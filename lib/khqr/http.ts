import "server-only";
import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { KhqrError, type KhqrSelection } from "./contracts";
import { getKhqrRuntime } from "./runtime";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
function invalid(): never { throw new KhqrError("KHQR_INVALID_REQUEST", 400, "Invalid KHQR request."); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function selection(body: Record<string, unknown>): KhqrSelection {
  const allowed = new Set(["purchaseBusinessId", "planCode", "billingCycle", "connections", "users", "renewSame", "customUpgrade", "extensionBillingCycle"]);
  if (Object.keys(body).some(key => !allowed.has(key))) return invalid();
  if (!["mini", "standard", "pro", "custom"].includes(String(body.planCode)) ||
      !["monthly", "3-months", "6-months", "12-months"].includes(String(body.billingCycle))) return invalid();
  for (const field of ["renewSame", "customUpgrade"]) if (body[field] !== undefined && typeof body[field] !== "boolean") return invalid();
  for (const [field, max] of [["connections", 30], ["users", 100]] as const) {
    if (body[field] !== undefined && (typeof body[field] !== "number" || !Number.isInteger(body[field]) || Number(body[field]) < (field === "connections" ? 3 : 1) || Number(body[field]) > max)) return invalid();
  }
  if (body.extensionBillingCycle !== undefined && !["none", "monthly", "3-months", "6-months", "12-months"].includes(String(body.extensionBillingCycle))) return invalid();
  return { planCode: body.planCode as KhqrSelection["planCode"], billingCycle: body.billingCycle as KhqrSelection["billingCycle"],
    connections: body.connections as number | undefined, users: body.users as number | undefined,
    renewSame: body.renewSame === true, customUpgrade: body.customUpgrade === true,
    extensionBillingCycle: body.extensionBillingCycle as KhqrSelection["extensionBillingCycle"] };
}

export async function handleKhqrRequest(request: Request, action: "readiness" | "checkout" | "status") {
  try {
    const auth = await getCurrentMember(true);
    if (!auth.success) return json({ success: false, error: auth.error }, auth.status);
    if (!await memberHasPermission(auth.member, "billing", "manage")) return json({ success: false, error: "Billing Manage permission is required." }, 403);
    const runtime = getKhqrRuntime();
    if (action === "readiness") return json({ success: true, ...runtime.readiness });
    if (!runtime.service) return json({ success: false, code: "KHQR_DISABLED", error: "KHQR is not available yet.", ...runtime.readiness }, 503);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return invalid();
    const text = await request.text();
    if (text.length > 4096) return invalid();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return invalid(); }
    const body = record(parsed);
    if (body.purchaseBusinessId !== auth.member.business_id) throw new KhqrError("KHQR_WORKSPACE_MISMATCH", 409, "The selected workspace has changed.");
    const context = { businessId: auth.member.business_id, memberId: auth.member.id };
    if (action === "checkout") {
      const key = request.headers.get("idempotency-key");
      if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return invalid();
      return json({ success: true, payment: await runtime.service.checkout(context, selection(body), key) });
    }
    if (Object.keys(body).some(key => !["purchaseBusinessId", "intentId"].includes(key)) ||
        typeof body.intentId !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(body.intentId)) return invalid();
    return json({ success: true, payment: await runtime.service.status(context, body.intentId) });
  } catch (error) {
    if (error instanceof KhqrError) return json({ success: false, code: error.code, error: error.message }, error.status);
    // Never expose transport/DB internals, receiver details or provider payloads.
    return json({ success: false, code: "KHQR_UNAVAILABLE", error: "Unable to process the KHQR request." }, 503);
  }
}
