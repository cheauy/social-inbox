import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  TENH_ACTIVE_BUSINESS_COOKIE,
} from "@/lib/auth/get-current-member";
import {
  createClient,
} from "@/lib/supabase/server";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MembershipRow = {
  business_id: string;
  is_active: boolean;
};

type SubscriptionRow = {
  id: string;
  business_id: string;
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
};

type ChannelRow = {
  id: string;
  business_id: string;
  platform: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean | null;
  facebook_token_status: string | null;
  telegram_token_status: string | null;
  telegram_bot_username: string | null;
  telegram_bot_name: string | null;
};

const OPERATIONAL_STATUSES = new Set(["active", "trialing"]);

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperationalSubscription(subscription: SubscriptionRow | null) {
  if (!subscription) {
    // Legacy/unmanaged workspaces stay operational until migrated.
    return true;
  }

  if (!OPERATIONAL_STATUSES.has(subscription.status)) {
    return false;
  }

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized.",
      },
      {
        status: 401,
        headers: noStoreHeaders(),
      },
    );
  }

  try {
    /*
     * Keep historical memberships visible in the selector only so TENH can
     * explain removed access. They never become operational Inbox access.
     */
    const {
      data: membershipData,
      error: membershipError,
    } = await supabaseAdmin
      .from("team_members")
      .select("business_id,is_active")
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: true,
      });

    if (membershipError) {
      throw new Error(
        membershipError.message,
      );
    }

    const memberships =
      (membershipData ?? []) as MembershipRow[];

    const membershipAccessByBusiness =
      new Map<string, boolean>();

    for (const membership of memberships) {
      membershipAccessByBusiness.set(
        membership.business_id,
        membershipAccessByBusiness.get(membership.business_id) === true ||
          membership.is_active === true,
      );
    }

    const businessIds =
      Array.from(membershipAccessByBusiness.keys());

    const subscriptionByBusiness =
      new Map<string, SubscriptionRow>();

    if (businessIds.length > 0) {
      const {
        data: subscriptionData,
        error: subscriptionError,
      } = await supabaseAdmin
        .from("business_subscriptions")
        .select(
          "id,business_id,status,current_period_end,trial_ends_at,created_at",
        )
        .in("business_id", businessIds)
        .order("created_at", { ascending: false });

      if (subscriptionError) {
        throw new Error(subscriptionError.message);
      }

      for (const row of (subscriptionData ?? []) as SubscriptionRow[]) {
        if (!subscriptionByBusiness.has(row.business_id)) {
          subscriptionByBusiness.set(row.business_id, row);
        }
      }
    }

    const subscriptionAccessByBusiness =
      new Map<string, boolean>();

    for (const businessId of businessIds) {
      subscriptionAccessByBusiness.set(
        businessId,
        membershipAccessByBusiness.get(businessId) === true &&
          isOperationalSubscription(
            subscriptionByBusiness.get(businessId) ?? null,
          ),
      );
    }

    const accessibleBusinessIds =
      businessIds.filter(
        (businessId) =>
          subscriptionAccessByBusiness.get(businessId) === true,
      );

    const cookieStore = await cookies();

    const currentBusinessId =
      cookieStore
        .get(TENH_ACTIVE_BUSINESS_COOKIE)
        ?.value?.trim() ?? null;

    const currentBusinessAccess =
      currentBusinessId
        ? subscriptionAccessByBusiness.get(currentBusinessId) === true
        : true;

    if (accessibleBusinessIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          currentBusinessId,
          currentBusinessAccess,
          channels: [],
        },
        {
          headers: noStoreHeaders(),
        },
      );
    }

    const { data, error } =
      await supabaseAdmin
        .from("social_accounts")
        .select(
          [
            "id",
            "business_id",
            "platform",
            "platform_account_id",
            "account_name",
            "is_active",
            "facebook_token_status",
            "telegram_token_status",
            "telegram_bot_username",
            "telegram_bot_name",
          ].join(","),
        )
        .in("business_id", accessibleBusinessIds)
        .in("platform", [
          "facebook",
          "telegram",
        ])
        .order("created_at", {
          ascending: true,
        });

    if (error) {
      throw new Error(error.message);
    }

    const rows =
      (data ?? []) as unknown as ChannelRow[];

    /*
     * The Inbox selector is operational UI, so expose only channels the
     * signed-in user can currently use. Removed memberships, expired
     * subscriptions and Owner-disabled channels stay preserved elsewhere but
     * must not leak names/usernames into another user's Inbox selector.
     */
    const visibleRows = rows.filter((row) => {
      if (row.is_active !== true) {
        return false;
      }

      if (row.platform === "facebook") {
        return row.facebook_token_status !== "disconnected";
      }

      if (row.platform === "telegram") {
        return row.telegram_token_status === "verified";
      }

      return false;
    });

    const channels = visibleRows.map((row) => {
      const subscription =
        subscriptionByBusiness.get(row.business_id) ?? null;

      return {
        id: row.id,
        businessId: row.business_id,
        subscriptionId: subscription?.id ?? null,
        subscriptionStatus: subscription?.status ?? null,
        subscriptionOperational: true,
        membershipAccessAllowed: true,
        subscriptionAccessAllowed: true,
        channelEnabled: true,
        accessAllowed: true,
        platform:
          row.platform === "telegram"
            ? "telegram"
            : "facebook",
        platformAccountId:
          row.platform_account_id,
        name:
          row.platform === "telegram"
            ? row.telegram_bot_name ??
              row.account_name ??
              "Telegram Bot"
            : row.account_name ??
              "Facebook Page",
        username:
          row.platform === "telegram"
            ? row.telegram_bot_username
            : null,
      };
    });

    return NextResponse.json(
      {
        success: true,
        currentBusinessId,
        currentBusinessAccess,
        channels,
      },
      {
        headers: noStoreHeaders(),
      },
    );
  } catch (error) {
    console.error(
      "[TENH Inbox] Unable to load channels:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Inbox channels.",
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      },
    );
  }
}
