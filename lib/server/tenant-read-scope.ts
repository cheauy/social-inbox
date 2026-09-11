import "server-only";
import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { withRequestScope } from "@/lib/server/request-scope";

export function withTenantReadScope<A extends unknown[]>(handler: (...args: A) => Promise<NextResponse>) {
  return withRequestScope(async (...args: A) => {
    const auth = await getCurrentMember();
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    // Disabled by default. Enforcement requires both this switch AND a
    // measured per-business policy. This is never used around message sends.
    if (process.env.TENH_ENFORCE_READ_BUDGETS === "true") {
      const { data, error } = await supabaseAdmin.rpc("tenh_check_read_budget", { p_business_id: auth.member.business_id });
      if (error || !data || typeof data.allowed !== "boolean") {
        return NextResponse.json({ success: false, error: "Usage protection is temporarily unavailable. Please retry." }, { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } });
      }
      if (!data.allowed) return NextResponse.json({ success: false, error: "Too many refreshes. Please wait a moment." }, {
        status: 429, headers: { "Retry-After": String(Math.max(1, Math.min(60, Number(data.retryAfter) || 60))), "Cache-Control": "no-store" },
      });
    }
    return handler(...args);
  });
}
