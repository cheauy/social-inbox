import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { authorizeInboxBusinessAccess } from "@/lib/inbox/get-inbox-resource-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { getTelegramUserProfilePhotos, getTelegramFile, downloadTelegramFile } from "@/lib/telegram/telegram-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 2 * 1024 * 1024;
const cache = new Map<string, { expires: number; image: Buffer | null }>();
const pending = new Map<string, Promise<Buffer | null>>();

async function loadPhoto(encrypted: string, userId: number) {
  const token = decryptChannelCredential(encrypted);
  const photos = await getTelegramUserProfilePhotos({ token, userId });
  const photo = [...(photos.photos?.[0] ?? [])].sort((a, b) => a.width - b.width)[0];
  if (!photo) return null;
  const file = await getTelegramFile({ token, fileId: photo.file_id });
  if (!file.file_path || file.file_path.includes("..") || /[?:#\\]/.test(file.file_path) || (file.file_size ?? 0) > MAX_BYTES) throw new Error("Invalid avatar");
  const response = await downloadTelegramFile({ token, filePath: file.file_path, timeoutMs: 12000 });
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Avatar too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty avatar");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.length;
    if (length > MAX_BYTES) { await reader.cancel(); throw new Error("Avatar too large"); }
    chunks.push(result.value);
  }
  return sharp(Buffer.concat(chunks), { limitInputPixels: 16000000 }).rotate().resize(96, 96, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get("businessId") ?? "";
  const accountId = request.nextUrl.searchParams.get("accountId") ?? "";
  const access = await authorizeInboxBusinessAccess(businessId);
  if (!access.success) return new NextResponse(null, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const { data: account, error } = await supabaseAdmin.from("social_accounts")
    .select("id,platform_account_id,telegram_bot_token_encrypted")
    .eq("id", accountId).eq("business_id", access.businessId).eq("platform", "telegram")
    .eq("is_active", true).eq("telegram_token_status", "verified").maybeSingle();
  if (error || !account?.telegram_bot_token_encrypted || !/^\d+$/.test(account.platform_account_id ?? "")) return new NextResponse(null, { status: 404 });
  const key = `${access.businessId}:${account.id}`;
  try {
    let entry = cache.get(key);
    if (!entry || entry.expires < Date.now()) {
      let job = pending.get(key);
      if (!job) {
        if (pending.size >= 30) return new NextResponse(null, { status: 503 });
        job = loadPhoto(account.telegram_bot_token_encrypted, Number(account.platform_account_id));
        pending.set(key, job);
      }
      let image: Buffer | null;
      try { image = await job; } finally { pending.delete(key); }
      entry = { image, expires: Date.now() + (image ? 3600000 : 300000) };
      cache.delete(key);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, entry);
    }
    if (!entry.image) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=300" } });
    return new NextResponse(new Uint8Array(entry.image), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "Vary": "Cookie, Authorization", "X-Content-Type-Options": "nosniff" } });
  } catch {
    // Never expose errors from Telegram URLs, which contain the bot credential.
    return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
