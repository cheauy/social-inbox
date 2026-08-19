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

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}

export async function GET() {
  const supabase =
    await createClient();

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
     * Load both active and inactive memberships.
     *
     * Inactive memberships are intentionally kept in the channel selector so
     * TENH can explain why an old Page/Bot can no longer be opened. They are
     * never used to load conversations.
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
      (membershipData ?? []) as
        MembershipRow[];

    const accessByBusiness =
      new Map<string, boolean>();

    for (const membership of memberships) {
      const existing =
        accessByBusiness.get(
          membership.business_id,
        );

      /*
       * If historical duplicate membership rows ever exist, an active row
       * wins. This avoids incorrectly blocking a valid subscription.
       */
      accessByBusiness.set(
        membership.business_id,
        Boolean(existing) ||
          membership.is_active === true,
      );
    }

    const businessIds =
      Array.from(
        accessByBusiness.keys(),
      );

    const cookieStore =
      await cookies();

    const currentBusinessId =
      cookieStore
        .get(
          TENH_ACTIVE_BUSINESS_COOKIE,
        )
        ?.value?.trim() ?? null;

    const currentBusinessAccess =
      currentBusinessId
        ? accessByBusiness.get(
            currentBusinessId,
          ) === true
        : true;

    if (
      businessIds.length === 0
    ) {
      return NextResponse.json(
        {
          success: true,
          currentBusinessId,
          currentBusinessAccess,
          channels: [],
        },
        {
          headers:
            noStoreHeaders(),
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
        .in(
          "business_id",
          businessIds,
        )
        .in("platform", [
          "facebook",
          "telegram",
        ])
        .order("created_at", {
          ascending: true,
        });

    if (error) {
      throw new Error(
        error.message,
      );
    }

    const rows =
      (data ?? []) as unknown as
        ChannelRow[];

    /*
     * Keep Owner-disabled channels visible so the selector can explain why
     * they cannot be opened. Fully disconnected channels stay hidden.
     */
    const visibleRows = rows.filter(
      (row) => {
        if (row.is_active === true) {
          return true;
        }

        if (row.platform === "facebook") {
          return row.facebook_token_status !== "disconnected";
        }

        if (row.platform === "telegram") {
          return row.telegram_token_status === "verified";
        }

        return false;
      },
    );

    const channels = visibleRows.map(
      (row) => {
        const subscriptionAccessAllowed =
          accessByBusiness.get(
            row.business_id,
          ) === true;
        const channelEnabled =
          row.is_active === true;

        return {
          id: row.id,
          businessId:
            row.business_id,
          subscriptionAccessAllowed,
          channelEnabled,
          accessAllowed:
            subscriptionAccessAllowed &&
            channelEnabled,
          platform:
            row.platform ===
            "telegram"
              ? "telegram"
              : "facebook",
          platformAccountId:
            row.platform_account_id,
          name:
            row.platform ===
            "telegram"
              ? row.telegram_bot_name ??
                row.account_name ??
                "Telegram Bot"
              : row.account_name ??
                "Facebook Page",
          username:
            row.platform ===
            "telegram"
              ? row.telegram_bot_username
              : null,
        };
      },
    );

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
