import { NextRequest, NextResponse } from "next/server";

import { processSubscriptionExpiryReminders } from "@/lib/subscription/process-subscription-expiry-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  // Fail closed. Never allow the billing sweep to become a public endpoint just
  // because CRON_SECRET was accidentally omitted from an environment.
  if (
    !cronSecret ||
    authorization !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized.",
      },
      {
        status: 401,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const result = await processSubscriptionExpiryReminders();

    return NextResponse.json(
      {
        success: true,
        lifecycleRowsSynced: result.lifecycleRowsSynced,
        notificationsCreated: result.notificationsCreated,
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    console.error(
      "[TENH Billing Reminder Cron] Sweep failed:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to process subscription expiry reminders.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
