import { NextRequest, NextResponse } from "next/server";

import { processFacebookMessage } from "@/lib/facebook/process-message";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FacebookWebhookPayload } from "@/types/facebook";
import {
  processFacebookComment,
  type FacebookFeedCommentValue,
} from "@/lib/facebook/process-comment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get(
    "hub.verify_token",
  );
  const challenge = request.nextUrl.searchParams.get(
    "hub.challenge",
  );

  if (
    mode === "subscribe" &&
    token === process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN &&
    challenge
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  return NextResponse.json(
    {
      error: "Facebook webhook verification failed.",
    },
    {
      status: 403,
    },
  );
}

export async function POST(request: NextRequest) {
  let payload: FacebookWebhookPayload;

  try {
    payload =
      (await request.json()) as FacebookWebhookPayload;
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON payload.",
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

  const { data: webhookEvent, error: webhookError } =
    await supabaseAdmin
      .from("webhook_events")
      .insert({
        platform: "facebook",
        event_type: payload.object ?? "unknown",
        payload,
        processing_status: "pending",
      })
      .select("id")
      .single();

  if (webhookError) {
    console.error(
      "Unable to save webhook event:",
      webhookError,
    );
  }

  if (payload.object !== "page") {
    if (webhookEvent) {
      await supabaseAdmin
        .from("webhook_events")
        .update({
          processing_status: "ignored",
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEvent.id);
    }

    return NextResponse.json({
      received: true,
      ignored: true,
    });
  }

  try {
   for (const entry of payload.entry ?? []) {
  // Messenger
  for (const event of entry.messaging ?? []) {
    if (!event.message?.mid) {
      continue;
    }

    await processFacebookMessage(event);
  }

  // Facebook Page feed / comment events
  const entryWithChanges =
    entry as typeof entry & {
      id?: string;
      changes?: Array<{
        field?: string;
        value?: unknown;
      }>;
    };

  const pageId =
    entryWithChanges.id?.trim();

  if (!pageId) {
    continue;
  }

  for (
    const change of
      entryWithChanges.changes ?? []
  ) {
    if (change.field !== "feed") {
      continue;
    }

    const value =
      change.value as FacebookFeedCommentValue;

    // Ignore post/status events.
    // Process comments only.
    if (
      value.item !== "comment" ||
      value.verb !== "add"
    ) {
      continue;
    }

    await processFacebookComment({
      pageId,
      value,
    });
  }
}

    if (webhookEvent) {
      await supabaseAdmin
        .from("webhook_events")
        .update({
          processing_status: "processed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEvent.id);
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
        .from("webhook_events")
        .update({
          processing_status: "failed",
          processing_error: message,
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEvent.id);
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