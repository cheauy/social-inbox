import "server-only";

/*
 * Splitting id lists before they reach a PostgREST `.in()` filter.
 *
 * PostgREST puts `.in()` values in the query string, so the ids travel in the
 * request URL rather than a body. A UUID costs about 37 characters once
 * comma-separated and encoded, and Node's HTTP client refuses a request whose
 * headers exceed 16KB. One workspace with 405 contacts built a 16,007-character
 * URL and undici rejected it before it left the process -- which surfaced as a
 * bare "TypeError: fetch failed", looking like a network fault instead of a
 * request we had made too big.
 *
 * The failure scales with the customer's data, so it arrives suddenly, on the
 * busiest workspaces, and never in development. Batch any id list that grows
 * with conversations, contacts or messages.
 *
 * 100 ids is roughly 4KB, leaving room for the select list and the rest of the
 * URL. Run the batches with Promise.all: more rows then cost more requests
 * rather than more waiting.
 */
export const SUPABASE_IN_BATCH_SIZE = 100;

export function chunkIds(
  ids: string[],
  size: number = SUPABASE_IN_BATCH_SIZE,
): string[][] {
  const batchSize = Math.max(
    1,
    Math.floor(size),
  );
  const batches: string[][] = [];

  for (
    let index = 0;
    index < ids.length;
    index += batchSize
  ) {
    batches.push(
      ids.slice(index, index + batchSize),
    );
  }

  return batches;
}
