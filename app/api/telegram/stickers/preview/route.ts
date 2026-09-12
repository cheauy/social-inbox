import { NextRequest, NextResponse } from "next/server";
import { getStickerConversation, loadStickerSet, StickerStoreError } from "@/lib/telegram/sticker-store-server";
import { getTelegramFile, downloadTelegramFile } from "@/lib/telegram/telegram-api";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams; const conversationId = q.get("conversationId") || "";
    if (!conversationId || conversationId.length > 100) throw new StickerStoreError("Conversation required.");
    const scope = await getStickerConversation(conversationId); const pack = await loadStickerSet(scope, q.get("set"));
    const sticker = pack.stickers.find(s => s.file_unique_id === q.get("sticker") && s.type === "regular");
    const fileId = sticker?.thumbnail?.file_id || (sticker && !sticker.is_animated && !sticker.is_video ? sticker.file_id : null);
    if (!fileId) throw new StickerStoreError("No preview is available.", 404);
    const file = await getTelegramFile({ token: scope.token, fileId });
    if (!file.file_path || file.file_path.includes("..") || /[?:#\\]/.test(file.file_path) || (file.file_size || 0) > MAX_PREVIEW_BYTES) throw new StickerStoreError("Invalid sticker preview.", 413);
    const response = await downloadTelegramFile({ token: scope.token, filePath: file.file_path, timeoutMs: 12000 });
    if (Number(response.headers.get("content-length")) > MAX_PREVIEW_BYTES) throw new StickerStoreError("Preview too large.", 413);
    const reader = response.body?.getReader(); if (!reader) throw new StickerStoreError("Empty preview.", 502);
    const chunks: Uint8Array[] = []; let total = 0;
    try { for (;;) { const result = await reader.read(); if (result.done) break; total += result.value.length;
      if (total > MAX_PREVIEW_BYTES) { await reader.cancel(); throw new StickerStoreError("Preview too large.", 413); } chunks.push(result.value); }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    const type = bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? "image/png"
      : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" ? "image/webp"
      : bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg" : null;
    if (!type) throw new StickerStoreError("Unsupported preview.", 415);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return NextResponse.json({ success: false, error: "Sticker preview unavailable." }, { status: error instanceof StickerStoreError ? error.status : 502 }); }
}
