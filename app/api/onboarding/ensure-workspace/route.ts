import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  resolveActiveWorkspaceSelection,
  TENH_ACTIVE_BUSINESS_COOKIE,
} from "@/lib/auth/get-current-member";
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

  /*
   * Every sign-in comes through here, so this cookie decides which workspace
   * the user lands in. It used to be stamped with whatever the provisioning RPC
   * returned -- their first workspace -- which sent anyone who had trialled
   * before buying or joining straight back to the expired trial and its locked
   * screen, every single time they logged in.
   *
   * A workspace just created for a granted trial is the right target and is
   * used as-is. Otherwise the choice is deferred to the same resolver the
   * dashboard uses: keep a still-valid saved selection, and failing that prefer
   * a workspace that can actually be opened.
   */
  const savedBusinessId =
    cookieStore
      .get(TENH_ACTIVE_BUSINESS_COOKIE)
      ?.value?.trim() ?? "";

  const activeBusinessId = result.trialGranted
    ? result.member.business_id
    : ((await resolveActiveWorkspaceSelection(
        user.id,
        savedBusinessId,
      )) ?? result.member.business_id);

  cookieStore.set(
    TENH_ACTIVE_BUSINESS_COOKIE,
    activeBusinessId,
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
    businessId: activeBusinessId,
    trialGranted: result.trialGranted,
    trialDays: result.trialDays,
    channelLimit: result.channelLimit,
    memberLimit: result.memberLimit,
  });
}
