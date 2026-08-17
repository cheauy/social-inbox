import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  decryptChannelCredential,
} from "@/lib/channels/channel-token-crypto";
import {
  sendTelegramChatAction,
} from "@/lib/telegram/telegram-api";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  let body: {
    conversationId?: string;
  };

  try {
    body =
      (await request.json()) as {
        conversationId?: string;
      };
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const conversationId =
    body.conversationId
      ?.trim();

  if (!conversationId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation ID is required.",
      },
      { status: 400 },
    );
  }

  const {
    data: conversationData,
    error: conversationError,
  } =
    await supabaseAdmin
      .from("conversations")
      .select(
        "id,platform,social_account_id,contact_id",
      )
      .eq(
        "id",
        conversationId,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .maybeSingle();

  if (conversationError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load Telegram conversation.",
      },
      { status: 500 },
    );
  }

  const conversation =
    conversationData as unknown as
      | {
          platform:
            | string
            | null;
          social_account_id:
            | string
            | null;
          contact_id:
            | string
            | null;
        }
      | null;

  if (
    !conversation ||
    conversation.platform !==
      "telegram" ||
    !conversation.social_account_id ||
    !conversation.contact_id
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram conversation routing is unavailable.",
      },
      { status: 404 },
    );
  }

  const [
    contactResult,
    accountResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("contacts")
      .select(
        "platform,platform_user_id",
      )
      .eq(
        "id",
        conversation.contact_id,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .maybeSingle(),

    supabaseAdmin
      .from("social_accounts")
      .select(
        "platform,is_active,telegram_token_status,telegram_bot_token_encrypted",
      )
      .eq(
        "id",
        conversation.social_account_id,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .maybeSingle(),
  ]);

  if (
    contactResult.error ||
    accountResult.error
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to resolve Telegram typing route.",
      },
      { status: 500 },
    );
  }

  const contact =
    contactResult.data as unknown as
      | {
          platform:
            | string
            | null;
          platform_user_id:
            | string
            | null;
        }
      | null;

  const account =
    accountResult.data as unknown as
      | {
          platform: string;
          is_active:
            | boolean
            | null;
          telegram_token_status:
            | string
            | null;
          telegram_bot_token_encrypted:
            | string
            | null;
        }
      | null;

  if (
    !contact ||
    contact.platform !==
      "telegram" ||
    !contact.platform_user_id ||
    !account ||
    account.platform !==
      "telegram" ||
    account.is_active !== true ||
    account.telegram_token_status !==
      "verified" ||
    !account.telegram_bot_token_encrypted
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Verified Telegram routing is required.",
      },
      { status: 409 },
    );
  }

  let token: string;

  try {
    token =
      decryptChannelCredential(
        account.telegram_bot_token_encrypted,
      );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to decrypt Telegram Bot credential.",
      },
      { status: 500 },
    );
  }

  try {
    await sendTelegramChatAction({
      token,
      chatId:
        contact.platform_user_id,
    });
  } catch (error) {
    console.warn(
      "[Tenh Telegram] Typing action failed:",
      error instanceof Error
        ? error.message
        : "Unknown Telegram typing error",
    );

    return NextResponse.json({
      success: false,
      ignored: true,
    });
  }

  return NextResponse.json({
    success: true,
  });
}
