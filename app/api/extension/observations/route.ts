import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { normalizeMessageText } from "@/lib/extension/facebook-thread";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Replies a browser saw, and whether TENH ever received them.
 *
 * Reconciliation happens here rather than on a timer: every time somebody
 * looks, each still-pending observation is checked against `messages` again,
 * and the ones Meta has since delivered are marked matched. A webhook that
 * arrives four minutes late resolves itself, and nothing needs a cron job to
 * do it.
 *
 * What is left after that is the list worth reading -- replies typed in
 * Facebook that never reached TENH. That is usually one thing: another app
 * holding the Page's webhook subscription.
 */

const LIMIT = 25;
const MATCH_WINDOW_MS = 10 * 60_000;

/* Below this, a pending observation is simply too fresh to judge. */
const SETTLE_MS = 90_000;

type EventRow = {
  id: string;
  conversation_id: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const member = authResult.member;

  const { data, error } = await supabaseAdmin
    .from("extension_events")
    .select("id,conversation_id,status,metadata,created_at")
    .eq("business_id", member.business_id)
    .eq("event_type", "outgoing_message_observed")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to read browser observations." },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as EventRow[];
  const pending = rows.filter(
    (row) => row.status === "pending" && row.conversation_id,
  );

  for (const row of pending) {
    const observedAt = Date.parse(
      String(row.metadata?.observedAt ?? row.created_at),
    );

    const anchor = Number.isFinite(observedAt)
      ? observedAt
      : Date.parse(row.created_at);

    const { data: candidates } = await supabaseAdmin
      .from("messages")
      .select("id,message_text")
      .eq("conversation_id", row.conversation_id as string)
      .eq("direction", "outgoing")
      .gte("created_at", new Date(anchor - MATCH_WINDOW_MS).toISOString())
      .lte("created_at", new Date(anchor + MATCH_WINDOW_MS).toISOString())
      .limit(50);

    const expected = normalizeMessageText(row.metadata?.preview);

    const match = (candidates ?? []).find(
      (candidate) =>
        expected && normalizeMessageText(candidate.message_text) === expected,
    );

    if (!match) continue;

    row.status = "matched";

    await supabaseAdmin
      .from("extension_events")
      .update({
        status: "matched",
        metadata: { ...(row.metadata ?? {}), matchedMessageId: match.id },
      })
      .eq("id", row.id);
  }

  const now = Date.now();

  return NextResponse.json({
    success: true,
    observations: rows.map((row) => {
      const observedAt = String(row.metadata?.observedAt ?? row.created_at);
      const age = now - Date.parse(observedAt);

      return {
        id: row.id,
        conversationId: row.conversation_id,
        preview:
          typeof row.metadata?.preview === "string"
            ? row.metadata.preview
            : null,
        observedAt,

        /*
         * "Waiting" and "missing" are the same row at two ages. Calling a
         * ten-second-old observation missing would accuse the webhook of
         * failing before it has had a chance to arrive.
         */
        state:
          row.status === "matched"
            ? "in_tenh"
            : row.status === "unmatched_thread"
              ? "unknown_conversation"
              : Number.isFinite(age) && age > SETTLE_MS
                ? "missing_from_tenh"
                : "waiting",
      };
    }),
  });
}
