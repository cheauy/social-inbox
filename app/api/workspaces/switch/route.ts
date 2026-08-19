import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: { businessId?: unknown };
  try {
    body = (await request.json()) as { businessId?: unknown };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  if (!businessId) {
    return NextResponse.json({ success: false, error: "Workspace is required." }, { status: 400 });
  }

  const { data: member, error } = await supabaseAdmin
    .from("team_members")
    .select("id,business_id")
    .eq("user_id", user.id)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: "Unable to verify workspace access.", details: error.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json({ success: false, error: "You are not an active member of this subscription." }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ success: true, businessId });
}
