import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  processFacebookComment,
  type FacebookFeedCommentValue,
} from "@/lib/facebook/process-comment";
import {
  processFacebookMessage,
} from "@/lib/facebook/process-message";
import {
  markFacebookCommentThreadDeleted,
} from "@/lib/facebook/mark-comment-thread-deleted";
import {
  processFacebookMessageStatus,
  type FacebookMessageStatusEvent,
} from "@/lib/facebook/process-message-status";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import type {
  FacebookMessagingEvent,
} from "@/types/facebook";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type FacebookFeedChange = {
  field?: string;
  value?:
    FacebookFeedCommentValue;
};

type FacebookWebhookEntry = {
  id?: string;
  time?: number;
  messaging?:
    FacebookMessagingEvent[];
  changes?:
    FacebookFeedChange[];
};

type FacebookWebhookPayloadV3110 = {
  object?: string;
  entry?:
    FacebookWebhookEntry[];
};

export async function GET(
  request: NextRequest,
) {
  const mode =
    request.nextUrl
      .searchParams.get(
        "hub.mode",
      );

  const token =
    request.nextUrl
      .searchParams.get(
        "hub.verify_token",
      );

  const challenge =
    request.nextUrl
      .searchParams.get(
        "hub.challenge",
      );

  if (
    mode ===
      "subscribe" &&
    token ===
      process.env
        .FACEBOOK_WEBHOOK_VERIFY_TOKEN &&
    challenge
  ) {
    return new NextResponse(
      challenge,
      {
        status: 200,
        headers: {
          "Content-Type":
            "text/plain",
        },
      },
    );
  }

  return NextResponse.json(
    {
      error:
        "Facebook webhook verification failed.",
    },
    {
      status: 403,
    },
  );
}

function isValidFacebookSignature({
  rawBody,
  signature,
  appSecret,
}: {
  rawBody: string;
  signature: string;
  appSecret: string;
}) {
  const expected =
    `sha256=${createHmac(
      "sha256",
      appSecret,
    )
      .update(rawBody, "utf8")
      .digest("hex")}`;

  const actualBuffer =
    Buffer.from(
      signature,
      "utf8",
    );
  const expectedBuffer =
    Buffer.from(
      expected,
      "utf8",
    );

  if (
    actualBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    actualBuffer,
    expectedBuffer,
  );
}

export async function POST(
  request: NextRequest,
) {
  const appSecret =
    process.env
      .FACEBOOK_APP_SECRET
      ?.trim();

  if (!appSecret) {
    console.error(
      "[Tenh Facebook Webhook] FACEBOOK_APP_SECRET is missing; refusing unsigned webhook processing.",
    );

    return NextResponse.json(
      {
        received: false,
        error:
          "Facebook webhook security configuration is incomplete.",
      },
      {
        status: 503,
      },
    );
  }

  const rawBody =
    await request.text();
  const signature =
    request.headers.get(
      "x-hub-signature-256",
    ) ?? "";

  if (
    !signature ||
    !isValidFacebookSignature({
      rawBody,
      signature,
      appSecret,
    })
  ) {
    return NextResponse.json(
      {
        received: false,
        error:
          "Invalid Facebook webhook signature.",
      },
      {
        status: 401,
      },
    );
  }

  let payload:
    FacebookWebhookPayloadV3110;

  try {
    payload =
      JSON.parse(
        rawBody,
      ) as FacebookWebhookPayloadV3110;
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid JSON payload.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data:
      webhookEvent,
    error:
      webhookError,
  } =
    await supabaseAdmin
      .from(
        "webhook_events",
      )
      .insert({
        platform:
          "facebook",
        event_type:
          payload.object ??
          "unknown",
        payload,
        processing_status:
          "pending",
      })
      .select("id")
      .single();

  if (webhookError) {
    console.error(
      "[Tenh Facebook Webhook] Unable to save webhook event:",
      webhookError,
    );
  }

  if (
    payload.object !==
    "page"
  ) {
    if (webhookEvent) {
      await supabaseAdmin
        .from(
          "webhook_events",
        )
        .update({
          processing_status:
            "ignored",
          processed_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          webhookEvent.id,
        );
    }

    return NextResponse.json({
      received: true,
      ignored: true,
    });
  }

  try {
    for (
      const entry of
      payload.entry ?? []
    ) {
      /*
       * Messenger message, delivery and read events.
       */
      for (
        const event of
        entry.messaging ?? []
      ) {
        const statusEvent =
          event as
            FacebookMessageStatusEvent;

        if (
          statusEvent
            .delivery ||
          statusEvent.read
        ) {
          await processFacebookMessageStatus(
            statusEvent,
          );
          continue;
        }

        if (
          event.message?.mid
        ) {
          await processFacebookMessage(
            event,
          );
        }
      }

      /*
       * Page feed comments.
       * This loop was present when TENH comments worked and must not be
       * removed when Messenger webhook/status code is changed.
       */
      for (
        const change of
        entry.changes ?? []
      ) {
        console.log(
          "[Tenh Facebook Webhook] Page change received.",
          {
            pageId:
              entry.id ?? null,
            field:
              change.field ?? null,
            item:
              change.value?.item ?? null,
            verb:
              change.value?.verb ?? null,
            commentId:
              change.value?.comment_id ?? null,
          },
        );

        if (
          change.field !==
          "feed"
        ) {
          continue;
        }

        const value =
          change.value;

        if (
          !value ||
          value.item !==
            "comment"
        ) {
          console.log(
            "[Tenh Facebook Comment] Feed event ignored because it is not a comment.",
            {
              item:
                value?.item ?? null,
              verb:
                value?.verb ?? null,
            },
          );
          continue;
        }

        if (
          value.verb !==
            "add" &&
          value.verb !==
            "remove"
        ) {
          continue;
        }

        const pageId =
          entry.id?.trim();

        if (!pageId) {
          console.warn(
            "[Tenh Facebook Comment] Feed event has no Page ID.",
          );
          continue;
        }

        console.log(
          "[Tenh Facebook Comment] Feed event received.",
          {
            pageId,
            verb:
              value.verb,
            commentId:
              value.comment_id,
            authorName:
              value.from
                ?.name,
          },
        );

        const commentId =
          value.comment_id?.trim();

        if (
          value.verb === "remove" &&
          commentId
        ) {
          const actorId =
            value.from?.id?.trim() ??
            null;

          await markFacebookCommentThreadDeleted({
            pageId,
            commentId,
            deletedBy:
              actorId === pageId
                ? "page"
                : "customer",
          });

          continue;
        }

        await processFacebookComment(
          {
            pageId,
            value,
          },
        );
      }
    }

    if (webhookEvent) {
      await supabaseAdmin
        .from(
          "webhook_events",
        )
        .update({
          processing_status:
            "processed",
          processed_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          webhookEvent.id,
        );
    }

    return NextResponse.json({
      received: true,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown processing error.";

    console.error(
      "[Tenh Facebook Webhook] Processing failed:",
      error,
    );

    if (webhookEvent) {
      await supabaseAdmin
        .from(
          "webhook_events",
        )
        .update({
          processing_status:
            "failed",
          processing_error:
            message,
          processed_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          webhookEvent.id,
        );
    }

    return NextResponse.json(
      {
        received: false,
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
