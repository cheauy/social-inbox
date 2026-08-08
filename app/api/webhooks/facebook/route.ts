import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  processFacebookComment,
} from "@/lib/facebook/process-comment";

import {
  processFacebookMessage,
} from "@/lib/facebook/process-message";

import {
  processFacebookMessageStatus,
  type FacebookMessageStatusEvent,
} from "@/lib/facebook/process-message-status";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

import type {
  FacebookWebhookPayload,
} from "@/types/facebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
) {
  const mode =
    request.nextUrl.searchParams.get(
      "hub.mode",
    );

  const token =
    request.nextUrl.searchParams.get(
      "hub.verify_token",
    );

  const challenge =
    request.nextUrl.searchParams.get(
      "hub.challenge",
    );

  if (
    mode === "subscribe" &&
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

export async function POST(
  request: NextRequest,
) {
  let payload:
    FacebookWebhookPayload;

  try {
    payload =
      (await request.json()) as FacebookWebhookPayload;
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

  console.log(
    "Facebook webhook:",
    JSON.stringify(payload),
  );

  const {
    data: webhookEvent,
    error: webhookError,
  } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      platform: "facebook",

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
      "Unable to save webhook event:",
      webhookError,
    );
  }

  if (
    payload.object !== "page"
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
            new Date().toISOString(),
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
       * =========================================================
       * 1. MESSENGER EVENTS
       * =========================================================
       *
       * IMPORTANT:
       * delivery/read webhook events do NOT have message.mid.
       * Therefore status events must be checked before the normal
       * message guard.
       */
      for (
        const event of
        entry.messaging ?? []
      ) {
        const statusEvent =
          event as FacebookMessageStatusEvent;

        if (
          statusEvent.delivery ||
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
       * =========================================================
       * 2. FACEBOOK PAGE FEED / COMMENT EVENTS
       * =========================================================
       *
       * KEEP THIS LOOP.
       * Tenh Chat needs it for:
       * - new comments
       * - deleted comments
       */
   for (
  const change of
  entry.changes ?? []
) {
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
    continue;
  }

  if (
    value.verb !== "add" &&
    value.verb !== "remove"
  ) {
    continue;
  }

  /*
   * Facebook Page webhook entries
   * should contain the Page ID.
   *
   * Guard it anyway so TypeScript
   * and runtime are both safe.
   */
  if (!entry.id) {
    console.error(
      "Facebook feed webhook missing entry.id:",
      entry,
    );

    continue;
  }

  await processFacebookComment({
    pageId:
      entry.id,

    value,
  });
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
            new Date().toISOString(),
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
      "Facebook webhook processing failed:",
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
            new Date().toISOString(),
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