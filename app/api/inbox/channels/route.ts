import { NextResponse } from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelRow = {
  id: string;
  platform: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean | null;
  telegram_bot_username: string | null;
  telegram_bot_name: string | null;
};

export async function GET() {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  }

  try {
    const { data, error } =
      await supabaseAdmin
        .from("social_accounts")
        .select(
          [
            "id",
            "platform",
            "platform_account_id",
            "account_name",
            "is_active",
            "telegram_bot_username",
            "telegram_bot_name",
          ].join(","),
        )
        .eq(
          "business_id",
          authResult.member.business_id,
        )
        .eq("is_active", true)
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

    const channels = rows.map(
      (row) => ({
        id: row.id,
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
      }),
    );

    return NextResponse.json(
      {
        success: true,
        channels,
      },
      {
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
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
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  }
}
