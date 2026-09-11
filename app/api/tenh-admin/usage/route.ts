import { NextRequest, NextResponse } from "next/server";
import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getTenhAdminUser();
  if (!admin.success) return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return NextResponse.json({ success: false, error: "Invalid page." }, { status: 400 });
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0,10);
  const end = now.toISOString().slice(0,10);
  const { data, error } = await supabaseAdmin.rpc("tenh_usage_report", { p_start: start, p_end: end, p_offset: offset });
  if (error) return NextResponse.json({ success: false, error: "Usage reporting is not ready. Apply the tenant usage migration and enable database monitoring on the server." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const rows = Array.isArray(data) ? data : [];
  return NextResponse.json({ success: true, start, end, mode: process.env.TENH_USAGE_MODE ?? "log", rows: rows.slice(0,50).map(row => ({ ...row, enforced: row.enforced && process.env.TENH_ENFORCE_READ_BUDGETS === "true" })), hasMore: rows.length > 50 }, { headers: { "Cache-Control": "private, no-store" } });
}
