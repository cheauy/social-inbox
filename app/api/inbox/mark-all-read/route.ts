import { NextRequest, NextResponse } from "next/server";
import { getInboxConversationScope } from "@/lib/inbox/get-conversations";
import { authorizeInboxBusinessAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { validReadTarget, readSnapshotCondition, type ReadReceipt, type ReadTarget } from "@/lib/inbox/bulk-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Bounded, authenticated compare-and-swap. Never clears messages that arrived
 * after the user's click. No provider calls, deletes or changes to read receipts. */
export async function POST(request: NextRequest) {
  let body: { targets?: unknown };
  try { body = await request.json(); } catch { return json({ success: false, error: "Invalid JSON request." }, 400); }
  if (!body || !Array.isArray(body.targets) || !body.targets.length || body.targets.length > 100 || !body.targets.every(validReadTarget)) {
    return json({ success: false, error: "Provide 1–100 valid unread conversation snapshots." }, 400);
  }
  const targets = body.targets as ReadTarget[];
  if (new Set(targets.map(target => target.id)).size !== targets.length) return json({ success: false, error: "Duplicate conversation snapshots." }, 400);
  try {
    let scope;
    try { scope = await getInboxConversationScope(); }
    catch { return json({ success: false, error: "Unable to verify Inbox access. Please sign in again." }, 401); }
    if (!scope.accessibleBusinessIds.length) return json({ success: false, error: "No active Inbox access." }, 403);
    const { data: rows, error } = await supabaseAdmin.from("conversations")
      .select("id,business_id,social_account_id,updated_at").in("id", targets.map(target => target.id)).in("business_id", scope.accessibleBusinessIds);
    if (error) return json({ success: false, error: "Unable to verify these conversations." }, 503);
    // A mixed-authority request does not partially mutate the allowed IDs.
    if ((rows?.length ?? 0) !== targets.length) return json({ success: false, error: "One or more conversations are unavailable or outside your access." }, 403);
    const businesses = [...new Set((rows ?? []).map(row => String(row.business_id)))];
    for (const businessId of businesses) {
      const access = await authorizeInboxBusinessAccess(businessId);
      if (!access.success) return json({ success: false, error: access.error }, access.status);
      if (!await memberHasPermission(access.member, "conversations", "view")) return json({ success: false, error: "Not allowed to view this Inbox." }, 403);
    }
    const channelIds = [...new Set((rows ?? []).map(row => String(row.social_account_id)))];
    const { data: channels, error: channelError } = await supabaseAdmin.from("social_accounts")
      .select("id,platform,facebook_token_status,telegram_token_status").in("id", channelIds).in("business_id", businesses).eq("is_active", true);
    if (channelError) return json({ success: false, error: "Unable to verify the channels." }, 503);
    const allowedChannels = new Set((channels ?? []).filter(row => row.platform === "telegram"
      ? row.telegram_token_status === "verified" : row.facebook_token_status !== "disconnected").map(row => row.id));
    if (channelIds.some(id => !allowedChannels.has(id))) return json({ success: false, error: "One or more channels are no longer active." }, 403);
    const rowById = new Map((rows ?? []).map(row => [row.id, row]));
    const confirmed: ReadReceipt[] = [];
    const failedIds: string[] = [];
    for (let offset = 0; offset < targets.length; offset += 25) {
      const batch = targets.slice(offset, offset + 25);
      const { data, error: writeError } = await supabaseAdmin.from("conversations").update({ unread_count: 0 })
        .in("business_id", businesses).in("social_account_id", [...allowedChannels])
        .in("id", batch.map(target => target.id))
        .or(batch.map(target => readSnapshotCondition(target, rowById.get(target.id)?.updated_at ?? null)).join(","))
        .gt("unread_count", 0).select("id,last_message_at,updated_at,unread_count");
      if (writeError) failedIds.push(...batch.map(target => target.id));
      else confirmed.push(...((data ?? []) as ReadReceipt[]));
    }
    const handled = new Set([...confirmed.map(row => row.id), ...failedIds]);
    return json({ success: true, conversations: confirmed, failedIds, skippedIds: targets.filter(target => !handled.has(target.id)).map(target => target.id) });
  } catch { return json({ success: false, error: "Unable to mark conversations as read. Please retry." }, 503); }
}
