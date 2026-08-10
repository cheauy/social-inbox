import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select(`
      id,
      full_name,
      email,
      role,
      profile_picture_url
    `)
    .eq("business_id", currentMember.business_id)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load team members.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    members: data ?? [],
    currentMemberId: currentMember.id,
  });
}
