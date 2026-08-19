import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { provisionUserWorkspace } from "@/lib/onboarding/ensure-user-workspace";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  if (!user.email_confirmed_at) {
    return NextResponse.json(
      {
        success: false,
        error: "Verify your email before starting a TENH free trial.",
      },
      { status: 403 },
    );
  }

  const result = await provisionUserWorkspace(user, request);

  if (!result.success) {
    return NextResponse.json(result, {
      status: result.code === "TRIAL_SECURITY_UNAVAILABLE" ? 503 : 500,
    });
  }

  const cookieStore = await cookies();
  cookieStore.set(
    TENH_ACTIVE_BUSINESS_COOKIE,
    result.member.business_id,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    },
  );

  return NextResponse.json({
    success: true,
    businessId: result.member.business_id,
    trialGranted: result.trialGranted,
    trialDays: result.trialDays,
    channelLimit: result.channelLimit,
    memberLimit: result.memberLimit,
  });
}
