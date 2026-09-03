import "server-only";

/*
 * Supabase (PostgREST) silently caps every SELECT at 1,000 rows unless the
 * query uses .range(). Analytics and workload routes that read raw rows and
 * count them in JavaScript therefore under-report as soon as a workspace
 * grows past 1,000 conversations or messages in the window — with no error.
 *
 * This helper walks the result in pages so the caller always receives the
 * complete set. `buildQuery` must return a fresh query each time it is called
 * because a PostgREST builder cannot be re-executed after .range() is applied.
 */
const PAGE_SIZE = 1000;

type PagedQuery<Row> = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: Row[] | null;
    error: { message: string } | null;
  }>;
};

export async function fetchAllRows<Row>(
  buildQuery: () => PagedQuery<Row>,
  options?: { maxRows?: number },
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const maxRows = options?.maxRows ?? 200_000;
  const rows: Row[] = [];
  let from = 0;

  while (from < maxRows) {
    const to = Math.min(from + PAGE_SIZE, maxRows) - 1;
    const { data, error } = await buildQuery().range(from, to);

    if (error) {
      return { data: rows, error };
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < to - from + 1) {
      break;
    }

    from = to + 1;
  }

  return { data: rows, error: null };
}
