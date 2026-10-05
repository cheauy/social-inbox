import { NextRequest, NextResponse } from "next/server";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { isMessageDeleted } from "@/lib/inbox/message-actions";
import { cachedSignedUrls } from "@/lib/media/signed-urls";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TELEGRAM_MESSAGE_MEDIA_BUCKET, telegramMessageMediaStoragePath } from "@/lib/telegram/telegram-message-media";
import type { InboxMessage } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (status: number) => new NextResponse(null, {
  status,
  headers: { "Cache-Control": "private, no-store" },
});

type GraphAttachment = {
  type?: string | null;
  mime_type?: string | null;
  audio_data?: { url?: string | null } | null;
  file_url?: string | null;
  payload?: { url?: string | null } | null;
  subattachments?: { data?: GraphAttachment[] | null } | null;
};

function allowedFacebookAudioUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const trusted = ["fbcdn.net", "fbsbx.com"].some(domain =>
      host === domain || host.endsWith(`.${domain}`),
    );
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") && trusted ? url.href : null;
  } catch {
    return null;
  }
}

function facebookAudioUrl(attachments: GraphAttachment[]) {
  const pending = [...attachments];
  for (let checked = 0; pending.length && checked < 100; checked += 1) {
    const attachment = pending.shift()!;
    const type = attachment.type?.trim().toLowerCase();
    const mime = attachment.mime_type?.trim().toLowerCase();
    const candidate = attachment.audio_data?.url ??
      (type === "audio" || mime?.startsWith("audio/")
        ? attachment.file_url ?? attachment.payload?.url
        : null);
    const allowed = allowedFacebookAudioUrl(candidate);
    if (allowed) return allowed;
    pending.push(...(attachment.subattachments?.data ?? []));
  }
  return null;
}

function redirect(url: string) {
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: url,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Resolve one authorized audio message; never accepts a provider URL from the browser. */
export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() ?? "";
  const messageId = request.nextUrl.searchParams.get("messageId")?.trim() ?? "";
  if (!conversationId || conversationId.length > 100 || !messageId || messageId.length > 100) {
    return fail(400);
  }

  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return fail(access.status);
  if (!await memberHasPermission(access.member, "conversations", "view")) return fail(403);

  const { data, error } = await supabaseAdmin.from("messages")
    .select("id,business_id,conversation_id,platform_message_id,message_type,raw_payload")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .eq("business_id", access.businessId)
    .maybeSingle();
  if (error) return fail(503);
  if (!data || !["audio", "voice"].includes(data.message_type) || isMessageDeleted(data as unknown as InboxMessage)) {
    return fail(404);
  }

  const mediaKind = data.message_type === "voice" ? "voice" : "audio";
  const path = telegramMessageMediaStoragePath({
    businessId: access.businessId,
    messageId: data.id,
    mediaKind,
  });
  try {
    const signed = await cachedSignedUrls(TELEGRAM_MESSAGE_MEDIA_BUCKET, [path], 300);
    if (signed[0]?.signedUrl) return redirect(signed[0].signedUrl);
  } catch {
    // A missing private copy may still be recoverable from the exact provider message.
  }

  const platformMessageId = data.platform_message_id?.trim();
  if (!platformMessageId || platformMessageId.startsWith("telegram:")) return fail(404);

  const { data: account, error: accountError } = await supabaseAdmin.from("social_accounts")
    .select("platform,platform_account_id,is_active,facebook_token_status")
    .eq("id", access.conversation.social_account_id)
    .eq("business_id", access.businessId)
    .maybeSingle();
  if (accountError) return fail(503);
  if (!account || account.platform !== "facebook" || !account.is_active ||
      account.facebook_token_status === "disconnected" || !account.platform_account_id) {
    return fail(404);
  }

  try {
    const token = await getFacebookPageAccessToken(account.platform_account_id);
    const version = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
    const graphUrl = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(platformMessageId)}`);
    graphUrl.searchParams.set("fields", "attachments");
    const response = await fetch(graphUrl, {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return fail(404);
    }
    const payload = await response.json().catch(() => null) as {
      attachments?: { data?: GraphAttachment[] | null } | GraphAttachment[] | null;
    } | null;
    const raw = payload?.attachments;
    const attachments = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
    const source = facebookAudioUrl(attachments);
    return source ? redirect(source) : fail(404);
  } catch {
    return fail(404);
  }
}
