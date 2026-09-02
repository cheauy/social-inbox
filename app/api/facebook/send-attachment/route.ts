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
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";

import {
  getConversationMessagePreview,
} from "@/lib/inbox/conversation-preview";
import {
  getFacebookMessengerReplyPolicy,
} from "@/lib/facebook/messenger-reply-policy";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "file";

type GraphError = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

type AttachmentUploadResponse =
  GraphError & {
    attachment_id?: string;
  };

type SendMessageResponse =
  GraphError & {
    recipient_id?: string;
    message_id?: string;
  };

const TENH_ATTACHMENT_LIMITS = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 25 * 1024 * 1024,
} satisfies Record<AttachmentKind, number>;

function isAttachmentKind(
  value: string,
): value is AttachmentKind {
  return (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "file"
  );
}

function getExpectedKind(
  file: File,
): AttachmentKind {
  if (
    file.type.startsWith(
      "image/",
    )
  ) {
    return "image";
  }

  if (
    file.type.startsWith(
      "video/",
    )
  ) {
    return "video";
  }

  if (
    file.type.startsWith(
      "audio/",
    ) ||
    /\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(
      file.name,
    )
  ) {
    return "audio";
  }

  return "file";
}

function getMessageText(
  kind: AttachmentKind,
  fileName: string,
) {
  if (kind === "image") {
    return "Sent a photo";
  }

  if (kind === "video") {
    return "Sent a video";
  }

  if (kind === "audio") {
    return "Sent a voice message";
  }

  return fileName.trim()
    ? `Sent a file: ${fileName}`
    : "Sent a file";
}

function graphErrorMessage(
  payload: GraphError,
  fallback: string,
) {
  return (
    payload.error?.message?.trim() ||
    fallback
  );
}

export async function POST(
  request: NextRequest,
) {
  let formData: FormData;

  try {
    formData =
      await request.formData();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid attachment request.",
      },
      {
        status: 400,
      },
    );
  }

  const conversationId =
    String(
      formData.get(
        "conversationId",
      ) ?? "",
    ).trim();

  const recipientId =
    String(
      formData.get(
        "recipientId",
      ) ?? "",
    ).trim();

  const requestedKind =
    String(
      formData.get("kind") ??
        "",
    ).trim();

  const fileValue =
    formData.get("file");

  if (!conversationId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation ID is required.",
      },
      {
        status: 400,
      },
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

  if (!recipientId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Facebook recipient ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    !fileValue ||
    typeof fileValue ===
      "string"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "An attachment file is required.",
      },
      {
        status: 400,
      },
    );
  }

  const file =
    fileValue as File;

  const detectedKind =
    getExpectedKind(file);

  const kind =
    isAttachmentKind(
      requestedKind,
    )
      ? requestedKind
      : detectedKind;

  if (
    kind !== detectedKind &&
    !(
      kind === "file" &&
      detectedKind === "file"
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The selected attachment type does not match the uploaded file.",
      },
      {
        status: 400,
      },
    );
  }

  const maximumSize =
    TENH_ATTACHMENT_LIMITS[kind];

  if (file.size <= 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The selected file is empty.",
      },
      {
        status: 400,
      },
    );
  }

  if (file.size > maximumSize) {
    const limit =
      kind === "image"
        ? "10 MB"
        : kind === "video"
          ? "50 MB"
          : "25 MB";

    return NextResponse.json(
      {
        success: false,
        error:
          `The selected ${kind} is larger than the Tenh Chat ${limit} upload limit.`,
      },
      {
        status: 413,
      },
    );
  }

  /*
   * Verify that the active team member owns this conversation
   * and load the Facebook Page used by the conversation.
   */
  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      social_account_id,
      contact_id,
      source_type
    `)
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
          "Unable to load the conversation.",
        details:
          conversationError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!conversation) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  if (
    conversation.source_type ===
    "comment"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "V2.4 attachment sending is currently available for Messenger conversations only.",
      },
      {
        status: 400,
      },
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
          "The conversation is missing its Facebook customer or Page connection.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      platform,
      platform_user_id
    `)
    .eq(
      "id",
      conversation.contact_id,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (contactError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Facebook customer.",
        details:
          contactError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (
    !contact ||
    contact.platform !==
      "facebook" ||
    contact.platform_user_id !==
      recipientId
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The Facebook recipient does not match this conversation.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: socialAccount,
    error: socialAccountError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      platform,
      platform_account_id,
      is_active
    `)
    .eq(
      "id",
      conversation.social_account_id,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (socialAccountError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the connected Facebook Page.",
        details:
          socialAccountError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (
    !socialAccount ||
    socialAccount.platform !==
      "facebook" ||
    !socialAccount.is_active ||
    !socialAccount.platform_account_id
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The Facebook Page connection is not active.",
      },
      {
        status: 400,
      },
    );
  }

  const pageId =
    socialAccount.platform_account_id;

  /*
   * Keep attachment sending under the same Facebook reply-window policy as
   * text. This prevents photo/file/voice messages from bypassing either the
   * one-private-reply lock or Meta's 7-day Human Agent ceiling.
   */
  let messengerPolicy;

  try {
    messengerPolicy =
      await getFacebookMessengerReplyPolicy(
        conversationId,
      );

    if (
      messengerPolicy.windowState ===
        "waiting_for_customer_reply"
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "WAITING_FOR_CUSTOMER_REPLY",
          error:
            "Waiting for customer reply. Meta allows only one private Messenger reply after a Facebook comment. You can send again as soon as the customer replies in Messenger.",
          waitingForCustomerReply: true,
        },
        { status: 409 },
      );
    }

    if (
      messengerPolicy.windowState ===
        "expired"
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "MESSENGER_WINDOW_EXPIRED",
          error:
            "The 7-day Messenger support window has expired. Wait for the customer to message again before sending another reply.",
          latestDirectIncomingAt:
            messengerPolicy.latestDirectIncomingAt,
        },
        { status: 409 },
      );
    }

    if (
      messengerPolicy.windowState ===
        "unknown"
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "MESSENGER_POLICY_UNKNOWN",
          error:
            "TENH could not safely verify this Messenger conversation yet. Refresh the conversation and try again after the latest customer activity is loaded.",
        },
        { status: 409 },
      );
    }
  } catch (policyError) {
    console.warn(
      "Unable to inspect the Facebook Messenger reply policy before attachment send:",
      policyError,
    );

    return NextResponse.json(
      {
        success: false,
        code: "MESSENGER_POLICY_CHECK_FAILED",
        error:
          "TENH could not safely verify whether Facebook allows another message. Please try again.",
      },
      { status: 503 },
    );
  }

  const shouldUseHumanAgent =
    messengerPolicy.windowState ===
    "human_agent";

  let pageAccessToken: string;

  try {
    pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );
  } catch (tokenError) {
    return NextResponse.json(
      {
        success: false,
        error:
          tokenError instanceof Error
            ? tokenError.message
            : "Unable to load the Facebook Page access token.",
      },
      {
        status: 500,
      },
    );
  }

  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION ??
    "v26.0";

  /*
   * 1. Upload the binary to Meta's Attachment Upload API.
   *    We ask Meta for a reusable attachment_id.
   */
  const uploadForm =
    new FormData();

  uploadForm.set(
    "message",
    JSON.stringify({
      attachment: {
        type: kind,
        payload: {
          is_reusable: true,
        },
      },
    }),
  );

  uploadForm.set(
    "filedata",
    file,
    file.name ||
      `tenh-${kind}`,
  );

  const uploadUrl =
    new URL(
      `https://graph.facebook.com/${graphVersion}/${pageId}/message_attachments`,
    );

  uploadUrl.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  async function uploadAttachment() {
    const response =
      await fetch(
        uploadUrl,
        {
          method: "POST",
          body: uploadForm,
          cache: "no-store",
        },
      );

    let payload:
      AttachmentUploadResponse = {};

    try {
      payload =
        (await response.json()) as
          AttachmentUploadResponse;
    } catch {
      // handled below
    }

    return {
      response,
      payload,
    };
  }

  let uploadAttempt: {
    response: Response;
    payload: AttachmentUploadResponse;
  };

  try {
    uploadAttempt =
      await uploadAttachment();

    if (
      (!uploadAttempt.response.ok ||
        uploadAttempt.payload.error) &&
      isFacebookAccessTokenError(
        uploadAttempt.payload.error,
      )
    ) {
      pageAccessToken =
        await refreshFacebookPageAccessToken(
          pageId,
        );

      uploadUrl.searchParams.set(
        "access_token",
        pageAccessToken,
      );

      uploadAttempt =
        await uploadAttachment();
    }
  } catch (uploadError) {
    console.error(
      "Facebook attachment upload request failed:",
      uploadError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          uploadError instanceof Error
            ? uploadError.message
            : "Unable to upload the attachment to Facebook.",
      },
      {
        status: 502,
      },
    );
  }

  const uploadResponse =
    uploadAttempt.response;
  const uploadPayload =
    uploadAttempt.payload;

  const attachmentId =
    uploadPayload.attachment_id
      ?.trim();

  if (
    !uploadResponse.ok ||
    !attachmentId
  ) {
    const errorMessage =
      graphErrorMessage(
        uploadPayload,
        "Facebook did not accept the attachment upload.",
      );

    console.error(
      "Facebook attachment upload failed:",
      uploadPayload,
    );

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      {
        status: 502,
      },
    );
  }

  /*
   * 2. Send the reusable attachment to the customer's PSID.
   */
  const sendUrl =
    new URL(
      `https://graph.facebook.com/${graphVersion}/${pageId}/messages`,
    );

  sendUrl.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  async function sendAttachment() {
    const response =
      await fetch(
        sendUrl,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            recipient: {
              id: recipientId,
            },
            ...(shouldUseHumanAgent
              ? {
                  messaging_type:
                    "MESSAGE_TAG",
                  tag: "HUMAN_AGENT",
                }
              : {
                  messaging_type:
                    "RESPONSE",
                }),
            message: {
              attachment: {
                type: kind,
                payload: {
                  attachment_id:
                    attachmentId,
                },
              },
            },
          }),
          cache: "no-store",
        },
      );

    let payload:
      SendMessageResponse = {};

    try {
      payload =
        (await response.json()) as
          SendMessageResponse;
    } catch {
      // handled below
    }

    return {
      response,
      payload,
    };
  }

  let sendAttempt: {
    response: Response;
    payload: SendMessageResponse;
  };

  try {
    sendAttempt =
      await sendAttachment();

    if (
      (!sendAttempt.response.ok ||
        sendAttempt.payload.error) &&
      isFacebookAccessTokenError(
        sendAttempt.payload.error,
      )
    ) {
      pageAccessToken =
        await refreshFacebookPageAccessToken(
          pageId,
        );

      sendUrl.searchParams.set(
        "access_token",
        pageAccessToken,
      );

      sendAttempt =
        await sendAttachment();
    }
  } catch (sendError) {
    console.error(
      "Facebook attachment send request failed:",
      sendError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          sendError instanceof Error
            ? sendError.message
            : "The attachment was uploaded, but Facebook could not send it to the customer.",
      },
      {
        status: 502,
      },
    );
  }

  const sendResponse =
    sendAttempt.response;
  const sendPayload =
    sendAttempt.payload;

  const facebookMessageId =
    sendPayload.message_id
      ?.trim();

  if (
    !sendResponse.ok ||
    !facebookMessageId
  ) {
    const errorMessage =
      graphErrorMessage(
        sendPayload,
        "Facebook did not accept the attachment message.",
      );
    const errorMessageLower =
      errorMessage.toLowerCase();
    const humanAgentApprovalRequired =
      shouldUseHumanAgent &&
      errorMessageLower.includes(
        "human_agent",
      ) &&
      (errorMessageLower.includes(
        "prior approval",
      ) ||
        errorMessageLower.includes(
          "approval",
        ));

    console.error(
      "Facebook attachment send failed:",
      sendPayload,
    );

    return NextResponse.json(
      {
        success: false,
        code: humanAgentApprovalRequired
          ? "HUMAN_AGENT_APPROVAL_REQUIRED"
          : undefined,
        error: humanAgentApprovalRequired
          ? "Extended messaging access is not available for this Facebook Page yet. Ask an administrator to finish the required Meta approval, or wait for the customer to message again."
          : shouldUseHumanAgent
            ? `Meta rejected this extended support attachment reply. ${errorMessage}`
            : errorMessage,
      },
      {
        status: sendResponse.status || 502,
      },
    );
  }

  const now =
    new Date().toISOString();

  const messageText =
    getMessageText(
      kind,
      file.name,
    );

  /*
   * A message echo can race this route. Reuse that row when it
   * already exists; otherwise create the outgoing row ourselves.
   */
  const {
    data: existingMessage,
    error: existingMessageError,
  } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq(
      "platform_message_id",
      facebookMessageId,
    )
    .maybeSingle();

  if (existingMessageError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Facebook sent the attachment, but Tenh Chat could not check the saved message.",
        details:
          existingMessageError.message,
      },
      {
        status: 500,
      },
    );
  }

  let savedMessage =
    existingMessage;

  if (savedMessage) {
    const {
      data: updatedMessage,
      error: updateMessageError,
    } = await supabaseAdmin
      .from("messages")
      .update({
        // V2.14.1 — verified Tenh Chat sender attribution.
        sent_by_member_id:
          currentMember.id,
        delivery_status:
          "sent",
        delivered_at: null,
        seen_at: null,
      })
      .eq(
        "id",
        savedMessage.id,
      )
      .select("*")
      .single();

    if (updateMessageError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Facebook sent the attachment, but Tenh Chat could not update its message status.",
          details:
            updateMessageError.message,
        },
        {
          status: 500,
        },
      );
    }

    savedMessage =
      updatedMessage;
  } else {
    const {
      data: insertedMessage,
      error: insertMessageError,
    } = await supabaseAdmin
      .from("messages")
      .insert({
        business_id:
          currentMember.business_id,
        conversation_id:
          conversation.id,
        platform_message_id:
          facebookMessageId,
        sender_platform_id:
          pageId,
        recipient_platform_id:
          recipientId,
        direction:
          "outgoing",
        message_type:
          kind,
        message_text:
          messageText,
        attachment_url:
          null,
        is_echo:
          false,
        raw_payload: {
          source:
            "tenh-chat-v2.4",
          tenh_attachment: {
            type: kind,
            name:
              file.name || null,
            mime_type:
              file.type || null,
            size:
              file.size,
            attachment_id:
              attachmentId,
          },
          facebook_response:
            sendPayload,
        },
        platform_created_at:
          now,
        // V2.14.1 — verified Tenh Chat sender attribution.
        sent_by_member_id:
          currentMember.id,
        delivery_status:
          "sent",
        delivered_at:
          null,
        seen_at:
          null,
      })
      .select("*")
      .single();

    if (insertMessageError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Facebook sent the attachment, but Tenh Chat could not save the outgoing message.",
          details:
            insertMessageError.message,
        },
        {
          status: 500,
        },
      );
    }

    savedMessage =
      insertedMessage;
  }

  const {
    error: conversationUpdateError,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      last_message_text:
        getConversationMessagePreview({
          direction: "outgoing",
          messageType: kind,
          messageText,
        }),
      last_message_at:
        now,
      updated_at:
        now,
    })
    .eq(
      "id",
      conversation.id,
    );

  if (conversationUpdateError) {
    console.warn(
      "Attachment sent, but conversation preview could not be updated:",
      conversationUpdateError,
    );
  }

  return NextResponse.json({
    success: true,
    attachmentId,
    messageId:
      facebookMessageId,
    message:
      savedMessage,
  });
}
