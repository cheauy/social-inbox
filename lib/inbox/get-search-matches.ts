import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { InboxSearchMatch } from "./search-match";

export const escapeSearchLike = (value: string) => value.replace(/[%_\\]/g, value => "\\" + value);

/** Only enrich the already authorized, server-qualified visible page. */
export async function getSearchMatches(query: string, conversations: { id: string; business_id: string }[]) {
  const matches: Record<string, InboxSearchMatch> = {};
  const needle = query.trim().replace(/^@/, "");
  if (needle.length < 3 || !conversations.length) return matches;
  const allowed = new Map(conversations.map(row => [row.id, row.business_id]));
  const read = (ids: string[], limit: number) => supabaseAdmin.from("messages")
    .select("id,business_id,conversation_id,message_text,platform_created_at")
    .in("conversation_id", ids).in("business_id", [...new Set(conversations.map(row => row.business_id))])
    .ilike("message_text", `%${escapeSearchLike(needle)}%`)
    .order("platform_created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  const keep = (rows: { id: string; business_id: string; conversation_id: string; message_text: string | null; platform_created_at: string | null }[]) => {
    for (const row of rows) if (allowed.get(row.conversation_id) === row.business_id && !matches[row.conversation_id] && row.message_text) {
      matches[row.conversation_id] = { messageId: row.id, text: row.message_text, sentAt: row.platform_created_at };
    }
  };
  const { data, error } = await read([...allowed.keys()], 1000);
  if (error) throw new Error("Unable to load matching messages.");
  keep(data ?? []);
  // A prolific thread must not crowd another thread's match out of the batch.
  if (data?.length === 1000) await Promise.all([...allowed.keys()].filter(id => !matches[id]).map(async id => {
    const result = await read([id], 1);
    if (result.error) throw new Error("Unable to load matching messages.");
    keep(result.data ?? []);
  }));
  return matches;
}
