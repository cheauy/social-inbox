import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ChannelMessageRow = {
  conversation_id: string | null;
  direction: string | null;
  created_at: string;
  platform_created_at: string | null;
};

const CHUNK_SIZE = 200, PAGE_SIZE = 1000, MAX_ROWS_PER_CHUNK = 200_000;

/** Fold each page immediately. Two workers bound transport concurrency and
 * avoid retaining every raw message while preserving all-history metrics. */
export async function readChannelMessages(businessId: string, conversationIds: string[],
  onPage: (rows: ChannelMessageRow[]) => void, signal?: AbortSignal) {
  const controller = new AbortController();
  const activeSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let nextChunk = 0;
  let failure: unknown;
  const read = (ids: string[], from: number, to: number) => supabaseAdmin.from("messages")
    .select("conversation_id, direction, created_at, platform_created_at")
    .eq("business_id", businessId).in("conversation_id", ids)
    .in("direction", ["incoming", "outgoing"])
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .abortSignal(activeSignal).range(from, to);

  async function worker() {
    try {
      while (!activeSignal.aborted) {
        const start = nextChunk;
        nextChunk += CHUNK_SIZE;
        if (start >= conversationIds.length) return;
        const ids = conversationIds.slice(start, start + CHUNK_SIZE);
        for (let from = 0; from < MAX_ROWS_PER_CHUNK; from += PAGE_SIZE) {
          if (activeSignal.aborted) return;
          const { data, error } = await read(ids, from, from + PAGE_SIZE - 1);
          if (activeSignal.aborted) return;
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as ChannelMessageRow[];
          onPage(rows);
          if (rows.length < PAGE_SIZE) break;
          if (from + PAGE_SIZE === MAX_ROWS_PER_CHUNK) {
            // A full final page is not proof of completeness. One-row probe
            // distinguishes an exact-cap result from a truncated aggregate.
            const tail = await read(ids, MAX_ROWS_PER_CHUNK, MAX_ROWS_PER_CHUNK);
            if (activeSignal.aborted) return;
            if (tail.error) throw new Error(tail.error.message);
            if (tail.data?.length) throw new Error("Channel message history exceeds the supported row limit.");
          }
        }
      }
    } catch (error) {
      failure ??= error;
      controller.abort();
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, Math.ceil(conversationIds.length / CHUNK_SIZE)) }, worker));
  if (failure) throw failure;
  if (signal?.aborted) throw new Error("Channel performance request cancelled.");
}
