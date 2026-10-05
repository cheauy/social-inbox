import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { listVisibleChats } from "@/lib/telegram-personal/inbox-server";
import { featureGate, jsonError } from "@/lib/telegram-personal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shared Telegram Personal chats the signed-in member may see in this workspace. */
export async function GET() {
  const auth = await getCurrentMember();
  if (!auth.success) return jsonError(auth.error, auth.status, auth.code ?? "UNAUTHORIZED");
  const gated = featureGate(auth.member);
  if (gated) return gated;

  try {
    const { accounts, chats } = await listVisibleChats(auth.member.business_id, auth.user.id);
    const names = new Map(accounts.map((account) => [account.id, account.name]));
    return NextResponse.json(
      {
        success: true,
        businessId: auth.member.business_id,
        chats: chats.map((chat) => ({
          id: chat.id,
          title: chat.title,
          username: chat.username,
          accountName: names.get(chat.social_account_id) ?? "Telegram account",
          lastMessageAt: chat.last_message_at,
          preview: chat.last_message_preview,
          lastDirection: chat.last_direction,
          unread: chat.unread_count,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[TENH Telegram Personal] inbox list failed:", error instanceof Error ? error.message : "unknown");
    return jsonError("Unable to load Telegram Personal chats.", 500, "LOAD_FAILED");
  }
}
