import { createHash } from "node:crypto";
import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getInboxConversationAccess,
} from "@/lib/inbox/get-inbox-resource-access";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  decryptChannelCredential,
} from "@/lib/channels/channel-token-crypto";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  sendTelegramLocation,
} from "@/lib/telegram/telegram-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendTelegramLocationBody = {
  conversationId?: string;
  latitude?: number;
  longitude?: number;
  message?: string;
  requestId?: string;
  reconcileOnly?: boolean;
};

type ConversationRow = {
  id: string;
  business_id: string;
  platform: string | null;
  social_account_id: string | null;
  contact_id: string | null;
};

type ContactRow = {
  id: string;
  business_id: string;
  platform: string | null;
  platform_user_id: string;
};

type TelegramAccountRow = {
  id: string;
  business_id: string;
  platform: string;
  platform_account_id: string | null;
  is_active: boolean | null;
  telegram_token_status: string | null;
  telegram_bot_token_encrypted:
    | string
    | null;
};

function telegramMessageTime(
  timestamp: number | undefined,
) {
  if (
    typeof timestamp === "number" &&
    Number.isFinite(timestamp) &&
    timestamp > 0
  ) {
    return new Date(
      timestamp * 1000,
    ).toISOString();
  }

  return new Date().toISOString();
}

async function handleLocation(
  request: Pick<NextRequest, "json">,
) {
  let body: SendTelegramLocationBody;

  try {
    body =
      (await request.json()) as
        SendTelegramLocationBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const requestId = body.requestId?.trim();
  if ((body.requestId !== undefined && (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))) || (body.reconcileOnly && !requestId)) {
    return NextResponse.json({ success: false, error: "A valid location request ID is required." }, { status: 400 });
  }

  const conversationId =
    body.conversationId?.trim();
  const latitude =
    typeof body.latitude ===
      "number"
      ? body.latitude
      : Number.NaN;
  const longitude =
    typeof body.longitude ===
      "number"
      ? body.longitude
      : Number.NaN;

  const message =
    body.message?.trim() ||
    (
      Number.isFinite(
        latitude,
      ) &&
      Number.isFinite(
        longitude,
      )
        ? `📍 Location: https://www.google.com/maps?q=${latitude},${longitude}`
        : ""
    );

  if (!conversationId) {
    return NextResponse.json(
      {
        success: false,
        error: "Conversation ID is required.",
      },
      { status: 400 },
    );
  }

  const inboxAccess =
    await getInboxConversationAccess(conversationId);

  if (!inboxAccess.success) {
    return NextResponse.json(
      { success: false, error: inboxAccess.error },
      { status: inboxAccess.status },
    );
  }

  const currentMember = inboxAccess.member;

  if (
    !(await memberHasPermission(currentMember, "conversations", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to reply in this workspace.",
    );
  }

  if (
    !Number.isFinite(
      latitude,
    ) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(
      longitude,
    ) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Valid latitude and longitude are required.",
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
        [
          "id",
          "business_id",
          "platform",
          "social_account_id",
          "contact_id",
        ].join(","),
      )
      .eq(
        "id",
        conversationId,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle();

  if (conversationError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Telegram conversation.",
        details:
          conversationError.message,
      },
      { status: 500 },
    );
  }

  const conversation =
    conversationData as unknown as
      ConversationRow | null;

  if (!conversation) {
    return NextResponse.json(
      {
        success: false,
        error: "Conversation was not found.",
      },
      { status: 404 },
    );
  }

  if (
    conversation.platform !==
    "telegram"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This conversation is not a Telegram conversation.",
      },
      { status: 400 },
    );
  }

  if (
    !conversation.contact_id ||
    !conversation.social_account_id
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram conversation routing information is incomplete.",
      },
      { status: 409 },
    );
  }

  const [
    contactResult,
    accountResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("contacts")
      .select(
        "id,business_id,platform,platform_user_id",
      )
      .eq(
        "id",
        conversation.contact_id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle(),

    supabaseAdmin
      .from("social_accounts")
      .select(
        [
          "id",
          "business_id",
          "platform",
          "platform_account_id",
          "is_active",
          "telegram_token_status",
          "telegram_bot_token_encrypted",
        ].join(","),
      )
      .eq(
        "id",
        conversation.social_account_id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle(),
  ]);

  if (contactResult.error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Telegram customer.",
        details:
          contactResult.error.message,
      },
      { status: 500 },
    );
  }

  if (accountResult.error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Telegram Bot connection.",
        details:
          accountResult.error.message,
      },
      { status: 500 },
    );
  }

  const contact =
    contactResult.data as unknown as
      ContactRow | null;
  const socialAccount =
    accountResult.data as unknown as
      TelegramAccountRow | null;

  if (
    !contact ||
    contact.platform !== "telegram"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram customer routing information was not found.",
      },
      { status: 404 },
    );
  }

  if (
    !socialAccount ||
    socialAccount.platform !==
      "telegram" ||
    socialAccount.is_active !== true ||
    socialAccount.telegram_token_status !==
      "verified" ||
    !socialAccount.telegram_bot_token_encrypted
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "A verified active Telegram Bot connection is required.",
      },
      { status: 409 },
    );
  }

  const chatId =
    contact.platform_user_id?.trim();

  if (!chatId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram customer chat ID is missing.",
      },
      { status: 409 },
    );
  }

  // The existing receipt table has a platform-independent atomic primary key.
  // A request ID fences one dispatch attempt, not exactly-once delivery.
  const fingerprint = createHash("sha256").update(JSON.stringify([
    "telegram-location-v1", currentMember.business_id, currentMember.id,
    conversation.id, socialAccount.id, chatId, latitude, longitude, message,
  ])).digest("hex");
  const updateReceipt = (values: Record<string, unknown>) => supabaseAdmin.from("facebook_sticker_sends").update(values)
    .eq("business_id", currentMember.business_id).eq("request_id", requestId!);
  if (requestId) {
    const existing = await supabaseAdmin.from("facebook_sticker_sends").select("fingerprint,status,result,http_status").eq("business_id", currentMember.business_id).eq("request_id", requestId).maybeSingle();
    if (existing.error) return NextResponse.json({ success: false, error: "Location delivery tracking is unavailable. No location was sent." }, { status: 503 });
    if (existing.data) {
      if (existing.data.fingerprint !== fingerprint) return NextResponse.json({ success: false, error: "This request ID belongs to a different location send." }, { status: 409 });
      if (existing.data.status === "completed" && existing.data.result) return NextResponse.json(existing.data.result, { status: existing.data.http_status ?? 200 });
      return NextResponse.json({ success: false, delivery: "unknown", error: "The earlier location may have been delivered. Check delivery later or verify in Telegram; do not resend it." }, { status: 409 });
    }
    if (body.reconcileOnly) return NextResponse.json({ success: true, delivery: "not_found", locationTracking: "v1" });
  }

  let botToken: string;

  try {
    botToken =
      decryptChannelCredential(
        socialAccount.telegram_bot_token_encrypted,
      );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "TENH could not decrypt the Telegram Bot credential.",
      },
      { status: 500 },
    );
  }

  if (requestId) {
    const claim = await supabaseAdmin.from("facebook_sticker_sends").insert({
      business_id: currentMember.business_id, request_id: requestId,
      conversation_id: conversation.id, member_id: currentMember.id,
      fingerprint, status: "pending",
    });
    if (claim.error) return NextResponse.json({ success: false, delivery: "unknown", error: "The location request could not be claimed. Check delivery before trying again." }, { status: 409 });
  }
  const uncertain = async () => {
    if (!requestId) return;
    // Never remove a claim after dispatch, even if saving its outcome fails.
    try { await updateReceipt({ status: "uncertain", updated_at: new Date().toISOString() }); } catch { /* pending still fences retries */ }
  };

  let telegramMessage;

  try {
    telegramMessage =
      await sendTelegramLocation({
        token: botToken,
        chatId,
        latitude,
        longitude,
      });
  } catch (error) {
    await uncertain();
    console.error(
      "[Tenh Telegram] Outgoing location send failed:",
      error instanceof Error
        ? error.message
        : "Unknown Telegram send error",
    );

    return NextResponse.json(
      {
        success: false,
        ...(requestId ? { delivery: "unknown" } : {}),
        error:
          error instanceof Error
            ? error.message
            : "Telegram rejected the message.",
      },
      { status: 502 },
    );
  }

  const messageId =
    telegramMessage.message_id;

  if (
    !Number.isFinite(messageId)
  ) {
    await uncertain();
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram accepted the send request but returned no message ID.",
      },
      { status: 502 },
    );
  }

  const platformMessageId =
    `telegram:${chatId}:${messageId}`;

  const sentAt =
    telegramMessageTime(
      telegramMessage.date,
    );

  const senderPlatformId =
    socialAccount
      .platform_account_id ??
    (telegramMessage.from?.id
      ? String(
          telegramMessage.from.id,
        )
      : "telegram-bot");

  let saveWarning:
    | string
    | null = null;

  // If persistence throws, the durable pending claim still prevents redispatch.
  try {
  const {
    error: insertError,
  } =
    await supabaseAdmin
      .from("messages")
      .insert({
        business_id:
          currentMember.business_id,
        conversation_id:
          conversation.id,
        platform_message_id:
          platformMessageId,
        sender_platform_id:
          senderPlatformId,
        recipient_platform_id:
          chatId,
        direction: "outgoing",
        message_type: "text",
        message_text: message,
        sent_by_member_id:
          currentMember.id,
        delivery_status: "sent",
        delivered_at: null,
        seen_at: null,
        attachment_url: null,
        is_echo: false,
        raw_payload: {
          ...telegramMessage,
          tenh_location: {
            latitude,
            longitude,
            horizontal_accuracy:
              telegramMessage.location
                ?.horizontal_accuracy ??
              null,
            live_period:
              telegramMessage.location
                ?.live_period ??
              null,
            heading:
              telegramMessage.location
                ?.heading ??
              null,
            proximity_alert_radius:
              telegramMessage.location
                ?.proximity_alert_radius ??
              null,
            source:
              "tenh",
          },
        },
        platform_created_at:
          sentAt,
      });

  if (insertError) {
    console.error(
      "[Tenh Telegram] Message was sent but local message save failed:",
      insertError,
    );

    /*
     * Telegram already received the message. Return success so the agent does
     * not retry and accidentally send the customer a duplicate message.
     */
    saveWarning =
      "Telegram sent the message, but TENH could not save the local message row.";
  }

  const {
    error: conversationUpdateError,
  } =
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_text:
          message,
        last_message_at:
          sentAt,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        conversation.id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      );

  if (
    conversationUpdateError
  ) {
    console.error(
      "[Tenh Telegram] Message was sent but conversation preview update failed:",
      conversationUpdateError,
    );

    saveWarning =
      saveWarning ??
      "Telegram sent the message, but TENH could not update the conversation preview.";
  }

  } catch {
    saveWarning = "Telegram sent the location, but TENH could not save its local history.";
  }

  console.info(
    "[Tenh Telegram] Outgoing location sent.",
    {
      conversationId:
        conversation.id,
      messageId:
        platformMessageId,
      sentByMemberId:
        currentMember.id,
    },
  );

  const result = {
    success: true,
    ...(requestId ? { delivery: "confirmed", locationTracking: "v1" } : {}),
    platform: "telegram",
    messageId:
      platformMessageId,
    warning:
      saveWarning,
  };
  if (requestId) {
    try {
      await updateReceipt({ status: "completed", result, http_status: 200, updated_at: new Date().toISOString() });
    } catch { /* Pending claim remains safe; client has the confirmed result. */ }
  }
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  return handleLocation(request);
}

// GET never claims or dispatches. Older deployments return 405 here, so native
// clients can verify tracking support before making their first send.
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  return handleLocation({ json: async () => ({
    conversationId: params.get("conversationId") ?? "",
    requestId: params.get("requestId") ?? "",
    latitude: params.has("latitude") ? Number(params.get("latitude")) : Number.NaN,
    longitude: params.has("longitude") ? Number(params.get("longitude")) : Number.NaN,
    reconcileOnly: true,
  }) });
}
