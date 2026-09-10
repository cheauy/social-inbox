import { NextResponse } from "next/server";

import {
  authenticateDevice,
  recordExtensionEvent,
} from "@/lib/extension/device-auth";
import {
  normalizeMessageText,
  resolveThread,
} from "@/lib/extension/facebook-thread";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * A message somebody sent from Facebook itself, as the browser saw it.
 *
 * This route deliberately does NOT write to `messages`. Meta's webhook is the
 * only thing allowed to say a message exists: it carries the message id, the
 * timestamp Meta recorded, and the delivery receipts that follow. A row
 * invented from a browser's DOM would have none of those, and when the webhook
 * arrived a minute later the customer would be looking at their own message
 * twice.
 *
 * What this does instead is remember the observation and immediately ask
 * whether TENH already has it. Matched, it is a confirmation and nothing more.
 * Unmatched, it is the useful case: a workspace whose Page webhook is being
 * held by another app can see, in TENH, exactly which replies never arrived --
 * which is the difference between "Messenger feels broken" and a list.
 *
 * The text it stores is the workspace's own outgoing reply, truncated, so the
 * list is readable. Customers' incoming messages are never reported here.
 */

/* Meta is usually a second or two behind. Ten minutes is generous enough to
   cover a slow webhook and short enough that two identical replies on the same
   day are not confused for one. */
const MATCH_WINDOW_MS = 10 * 60_000;
const PREVIEW_CHARS = 160;

type Body = {
  pageId?: unknown;
  threadId?: unknown;
  text?: unknown;
  observedAt?: unknown;
};

export async function POST(request: Request) {
  const auth = await authenticateDevice(request);

  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { device, member } = auth;

  let body: Body;

  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }

  const normalized = normalizeMessageText(body.text);

  if (!normalized) {
    return NextResponse.json(
      { success: false, error: "Nothing to record." },
      { status: 400 },
    );
  }

  const observedAtMs = Number.isFinite(Number(body.observedAt))
    ? Number(body.observedAt)
    : Date.now();

  const observedAt = new Date(observedAtMs).toISOString();

  const thread = await resolveThread(
    device.business_id,
    body.pageId,
    body.threadId,
  );

  if (!thread) {
    /* Reported anyway. "The browser saw a reply on a Page or thread TENH does
       not recognize" is itself worth knowing when Pages are being connected. */
    void recordExtensionEvent({
      businessId: device.business_id,
      deviceId: device.id,
      memberId: member.id,
      userId: device.user_id,
      eventType: "outgoing_message_observed",
      status: "unmatched_thread",
      metadata: {
        observedAt,
        preview: String(body.text ?? "").slice(0, PREVIEW_CHARS),
      },
    });

    return NextResponse.json({
      success: true,
      matched: false,
      reason: "no_matching_conversation",
    });
  }

  const since = new Date(observedAtMs - MATCH_WINDOW_MS).toISOString();
  const until = new Date(observedAtMs + MATCH_WINDOW_MS).toISOString();

  const { data: candidates } = await supabaseAdmin
    .from("messages")
    .select("id,message_text,created_at,platform_created_at")
    .eq("conversation_id", thread.conversationId)
    .eq("direction", "outgoing")
    .gte("created_at", since)
    .lte("created_at", until)
    .limit(50);

  const match = (candidates ?? []).find(
    (row) => normalizeMessageText(row.message_text) === normalized,
  );

  void recordExtensionEvent({
    businessId: device.business_id,
    deviceId: device.id,
    memberId: member.id,
    userId: device.user_id,
    socialAccountId: thread.page.socialAccountId,
    conversationId: thread.conversationId,
    eventType: "outgoing_message_observed",
    status: match ? "matched" : "pending",
    metadata: {
      observedAt,
      preview: String(body.text ?? "").slice(0, PREVIEW_CHARS),
      textHash: normalized.length > 0 ? hash(normalized) : null,
      matchedMessageId: match?.id ?? null,
      source: "facebook_browser",
    },
  });

  return NextResponse.json({
    success: true,
    matched: true,
    conversationId: thread.conversationId,
    alreadyInTenh: Boolean(match),
    messageId: match?.id ?? null,
  });
}

/* Short, stable, and enough to tell two observations apart without keeping a
   second copy of the text. */
function hash(value: string) {
  let result = 0;

  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }

  return `h${(result >>> 0).toString(36)}`;
}
