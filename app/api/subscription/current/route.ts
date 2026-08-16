import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { syncBusinessSubscriptionLifecycle } from "@/lib/subscription/sync-subscription-lifecycle";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionRow = {
  id: string;
  business_id: string;
  plan_code: string;
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  member_limit: number | null;
  channel_limit: number | null;
  storage_limit_bytes: number | null;
  monthly_message_limit: number | null;
  payment_provider: string | null;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
};

function noStoreJson(
  body: Record<string, unknown>,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET() {
  try {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return noStoreJson(
        { success: false, error: authResult.error },
        { status: authResult.status },
      );
    }

    const member = authResult.member;

    await syncBusinessSubscriptionLifecycle(
      member.business_id,
    );

    const [
      subscriptionResult,
      membersResult,
      channelsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("business_subscriptions")
        .select(
          [
            "id",
            "business_id",
            "plan_code",
            "status",
            "trial_started_at",
            "trial_ends_at",
            "current_period_start",
            "current_period_end",
            "member_limit",
            "channel_limit",
            "storage_limit_bytes",
            "monthly_message_limit",
            "payment_provider",
            "suspended_at",
            "created_at",
            "updated_at",
          ].join(","),
        )
        .eq(
          "business_id",
          member.business_id,
        )
        .maybeSingle(),

      supabaseAdmin
        .from("team_members")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq(
          "business_id",
          member.business_id,
        )
        .eq("is_active", true),

      supabaseAdmin
        .from("social_accounts")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq(
          "business_id",
          member.business_id,
        )
        .eq("is_active", true),
    ]);

    if (subscriptionResult.error) {
      throw new Error(
        subscriptionResult.error.message,
      );
    }

    if (membersResult.error) {
      throw new Error(
        membersResult.error.message,
      );
    }

    if (channelsResult.error) {
      throw new Error(
        channelsResult.error.message,
      );
    }

    /*
     * Supabase cannot infer the selected row type from the dynamic
     * array.join(",") select string above. Runtime data is still one
     * business_subscriptions row because maybeSingle() is used.
     *
     * Give TypeScript the explicit row shape before spreading it.
     */
    const subscriptionData =
      subscriptionResult.data as unknown as
        | SubscriptionRow
        | null;

    const subscription =
      subscriptionData
        ? {
            ...subscriptionData,

            // Historical V3.10.3 cancellation rows are presented
            // as expired under TENH's prepaid subscription model.
            status:
              subscriptionData.status ===
              "cancelled"
                ? "expired"
                : subscriptionData.status,
          }
        : null;

    return noStoreJson({
      success: true,
      subscription,
      usage: {
        members:
          membersResult.count ?? 0,
        channels:
          channelsResult.count ?? 0,
      },
    });
  } catch (error) {
    console.error(
      "[TENH] Unable to load subscription:",
      error,
    );

    return noStoreJson(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load subscription.",
      },
      { status: 500 },
    );
  }
}
