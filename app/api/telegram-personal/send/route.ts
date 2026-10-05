import { NextRequest, NextResponse } from "next/server";

import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isTelegramPersonalSendEnabled } from "@/lib/telegram-personal/feature-flag";
import {
  authorizeSendConversation,
  enqueueErrorResponse,
  enqueuePersonalSend,
  ENQUEUE_ERRORS,
  NO_STORE,
  presentSendState,
  readSendState,
  replyStatus,
  UUID,
  waitForSendOutcome,
} from "@/lib/telegram-personal/send-server";
import { jsonError } from "@/lib/telegram-personal/server";
import { TELEGRAM_MESSAGE_MEDIA_BUCKET } from "@/lib/telegram/telegram-message-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Replies from TENH through a Telegram Personal account (D2).
 *
 * Only the account holder may reply; teammates who can see the chat read only.
 * Every send carries a client request id: the queue accepts each id once, so a
 * repeated request can never send twice. The worker reports the outcome; when
 * Telegram does not confirm it the send becomes "uncertain" and is never
 * retried automatically. The holder checks Telegram and decides.
 *
 * Text:  JSON { conversationId, clientRequestId, text, replyToMessageId? }
 * File:  multipart form with the same fields plus "file" (caption = text).
 *        The file is staged privately under <business>/tgp-outbox/<request id>/
 *        and the worker removes it after sending.
 */

const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;
// Vercel caps request bodies at 4.5 MB; keep a margin for the form overhead.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * ?conversationId=...                       whether this member may reply
 * ?conversationId=...&clientRequestId=...   the outcome of one send
 */
export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  const result = await authorizeSendConversation(conversationId);
  if ("response" in result) return result.response;
  const { access } = result;

  try {
    const clientRequestId = request.nextUrl.searchParams.get("clientRequestId");
    if (clientRequestId) {
      if (!UUID.test(clientRequestId)) return jsonError("Invalid request.", 400, "INVALID_REQUEST");
      const state = await readSendState(access.conversation.id, access.conversation.business_id, access.user.id, clientRequestId);
      return NextResponse.json({ success: true, ...presentSendState(state) }, { headers: NO_STORE });
    }
    const allowed = await memberHasPermission(access.member, "conversations", "manage");
    const status = !isTelegramPersonalSendEnabled(process.env, access.conversation.business_id)
      ? { canReply: false, reason: "SEND_DISABLED" }
      : allowed
      ? await replyStatus(access.conversation.id, access.conversation.social_account_id, access.user.id)
      : { canReply: false, reason: "NO_PERMISSION" };
    return NextResponse.json({ success: true, ...status, maxFileBytes: MAX_FILE_BYTES }, { headers: NO_STORE });
  } catch {
    return jsonError("Unable to load Telegram Personal reply status.", 500, "LOAD_FAILED");
  }
}

function mediaKind(mime: string, name: string) {
  if (/^image\/(jpeg|png|webp)$/.test(mime)) return "photo";
  if (mime === "video/mp4" || /\.mp4$/i.test(name)) return "video";
  // TENH microphone recordings (any container; the worker converts WebM to OGG) and OGG files are voice messages.
  if (/^voice-message-/.test(name) && mime.startsWith("audio/")) return "voice";
  if (mime === "audio/ogg") return "voice";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-100);
  return cleaned || "file";
}

type Parsed = { conversationId: string | null; clientRequestId: string; text: string; replyTo: string | null; file: File | null };

async function parseBody(request: NextRequest): Promise<Parsed | { error: NextResponse }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 64 * 1024) {
      return { error: jsonError("Files can be up to 4 MB.", 413, "FILE_TOO_LARGE") };
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { error: jsonError("Invalid upload.", 400, "INVALID_REQUEST") };
    }
    const value = (key: string) => (typeof form.get(key) === "string" ? (form.get(key) as string) : "");
    const file = form.get("file");
    return {
      conversationId: value("conversationId") || null,
      clientRequestId: value("clientRequestId"),
      text: value("text"),
      replyTo: value("replyToMessageId") || null,
      file: file instanceof File ? file : null,
    };
  }
  try {
    const raw = await request.text();
    if (raw.length > 32_768) return { error: jsonError("Request too large.", 413, "INVALID_REQUEST") };
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return {
      conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
      clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : "",
      text: typeof body.text === "string" ? body.text : "",
      replyTo: typeof body.replyToMessageId === "string" ? body.replyToMessageId : null,
      file: null,
    };
  } catch {
    return { error: jsonError("Invalid JSON request.", 400, "INVALID_REQUEST") };
  }
}

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request);
  if ("error" in parsed) return parsed.error;

  const result = await authorizeSendConversation(parsed.conversationId);
  if ("response" in result) return result.response;
  const { access } = result;

  if (!isTelegramPersonalSendEnabled(process.env, access.conversation.business_id)) {
    return jsonError("Replies from TENH are not switched on for Telegram Personal yet.", 403, "SEND_DISABLED");
  }

  const { clientRequestId, text, replyTo, file } = parsed;
  if (!UUID.test(clientRequestId)) return jsonError("Invalid request.", 400, "INVALID_REQUEST");
  if (replyTo !== null && !UUID.test(replyTo)) return jsonError("Invalid request.", 400, "INVALID_REQUEST");
  if (file) {
    if (text.length > MAX_CAPTION) return jsonError(ENQUEUE_ERRORS.CAPTION_TOO_LONG[0], 400, "CAPTION_TOO_LONG");
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) return jsonError("Files can be up to 4 MB.", 413, "FILE_TOO_LARGE");
  } else if (!text.trim() || text.length > MAX_TEXT) {
    return jsonError(ENQUEUE_ERRORS.INVALID_TEXT[0], 400, "INVALID_TEXT");
  }
  if (!(await memberHasPermission(access.member, "conversations", "manage"))) {
    return jsonError("You do not have permission to reply in this workspace.", 403, "NO_PERMISSION");
  }

  // Stage the file privately; only the worker reads it, then removes it.
  let media: Record<string, unknown> | null = null;
  let stagedPath: string | null = null;
  if (file) {
    const name = safeFileName(file.name || "file");
    const mime = (file.type || "application/octet-stream").split(";")[0].trim().toLowerCase().slice(0, 100);
    stagedPath = `${access.conversation.business_id}/tgp-outbox/${clientRequestId}/${name}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(TELEGRAM_MESSAGE_MEDIA_BUCKET)
      .upload(stagedPath, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: true });
    if (uploadError) return jsonError("Unable to upload the file. Nothing was sent.", 500, "UPLOAD_FAILED");
    media = { kind: mediaKind(mime, name), storage_path: stagedPath, size: file.size, mime_type: mime.length >= 3 ? mime : "application/octet-stream", name };
  }

  const queued = await enqueuePersonalSend({
    conversationId: access.conversation.id,
    businessId: access.conversation.business_id,
    userId: access.user.id,
    memberId: access.member.id,
    clientRequestId,
    text,
    media,
    replyTo,
  });
  if (!queued.ok) {
    if (stagedPath) await supabaseAdmin.storage.from(TELEGRAM_MESSAGE_MEDIA_BUCKET).remove([stagedPath]).catch(() => undefined);
    return enqueueErrorResponse(queued.code, queued.failed);
  }

  const state = await waitForSendOutcome(access.conversation.id, access.conversation.business_id, access.user.id, clientRequestId);
  return NextResponse.json({ success: true, clientRequestId, ...state }, { status: state.state === "pending" ? 202 : 200, headers: NO_STORE });
}
