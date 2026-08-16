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
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  syncTelegramContactProfilePhoto,
} from "@/lib/telegram/telegram-profile-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

type TelegramContactRow = {
  id: string;
  business_id: string;
  platform: string;
  platform_user_id: string;
  profile_picture_url:
    | string
    | null;
};

type ConversationRow = {
  social_account_id:
    | string
    | null;
};

type TelegramAccountRow = {
  id: string;
  business_id: string;
  telegram_bot_token_encrypted:
    | string
    | null;
  telegram_token_status:
    | string
    | null;
  is_active:
    | boolean
    | null;
};

export async function POST(
  _request: NextRequest,
  context: RouteContext,
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

  const { contactId } =
    await context.params;

  const {
    data: contactData,
    error: contactError,
  } =
    await supabaseAdmin
      .from("contacts")
      .select(
        [
          "id",
          "business_id",
          "platform",
          "platform_user_id",
          "profile_picture_url",
        ].join(","),
      )
      .eq(
        "id",
        contactId,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .eq(
        "platform",
        "telegram",
      )
      .maybeSingle();

  if (contactError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load Telegram customer.",
        details:
          contactError.message,
      },
      { status: 500 },
    );
  }

  const contact =
    contactData as unknown as
      TelegramContactRow | null;

  if (!contact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram customer was not found.",
      },
      { status: 404 },
    );
  }

  const telegramUserId =
    Number(
      contact.platform_user_id,
    );

  if (
    !Number.isSafeInteger(
      telegramUserId,
    ) ||
    telegramUserId <= 0
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram customer ID is invalid.",
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
        "social_account_id",
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .eq(
        "contact_id",
        contact.id,
      )
      .eq(
        "platform",
        "telegram",
      )
      .order(
        "updated_at",
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (conversationError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to resolve Telegram conversation.",
        details:
          conversationError.message,
      },
      { status: 500 },
    );
  }

  const conversation =
    conversationData as unknown as
      ConversationRow | null;

  let accountQuery =
    supabaseAdmin
      .from("social_accounts")
      .select(
        [
          "id",
          "business_id",
          "telegram_bot_token_encrypted",
          "telegram_token_status",
          "is_active",
        ].join(","),
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .eq(
        "platform",
        "telegram",
      )
      .eq(
        "is_active",
        true,
      )
      .eq(
        "telegram_token_status",
        "verified",
      );

  if (
    conversation
      ?.social_account_id
  ) {
    accountQuery =
      accountQuery.eq(
        "id",
        conversation
          .social_account_id,
      );
  }

  const {
    data: accountData,
    error: accountError,
  } =
    await accountQuery
      .order(
        "created_at",
        {
          ascending: true,
        },
      )
      .limit(1)
      .maybeSingle();

  if (accountError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load Telegram Bot connection.",
        details:
          accountError.message,
      },
      { status: 500 },
    );
  }

  const account =
    accountData as unknown as
      TelegramAccountRow | null;

  if (
    !account ||
    !account.telegram_bot_token_encrypted
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "A verified Telegram Bot connection is required.",
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
          "TENH could not decrypt the Telegram Bot credential. Verify the production encryption key.",
      },
      { status: 500 },
    );
  }

  try {
    const result =
      await syncTelegramContactProfilePhoto({
        token,
        userId:
          telegramUserId,
        businessId:
          authResult.member
            .business_id,
        contactId:
          contact.id,
      });

    return NextResponse.json({
      success: true,
      contactId:
        contact.id,
      platformUserId:
        contact.platform_user_id,
      ...result,
    });
  } catch (error) {
    console.error(
      "[Tenh Telegram] Manual customer avatar sync failed:",
      error instanceof Error
        ? error.message
        : "Unknown avatar error",
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram avatar sync failed.",
        details:
          error instanceof Error
            ? error.message
            : "Unknown avatar error",
      },
      { status: 500 },
    );
  }
}
