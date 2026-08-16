import { NextResponse } from "next/server";

import { getBusinessSubscriptionAccess } from "@/lib/subscription/get-business-subscription-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await getBusinessSubscriptionAccess();

    return NextResponse.json(
      {
        success: true,
        access: {
          hasSubscription: access.hasSubscription,
          locked: access.locked,
          reason: access.reason,
          status: access.status,
          planCode: access.planCode,
          trialEndsAt: access.trialEndsAt,
          currentPeriodEnd: access.currentPeriodEnd,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to check subscription access.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
