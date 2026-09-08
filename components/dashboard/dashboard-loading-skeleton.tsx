/*
 * The instant skeleton behind every dashboard tab.
 *
 * Ten of the twelve dashboard routes had no loading.tsx. Each one is a server
 * component that awaits getCurrentMember() and its own Supabase queries before
 * returning any markup, and without a loading file Next.js has nothing to show
 * during that wait -- so clicking Analytics or Group Chat left the previous
 * page frozen on screen until the server replied. Nothing moved, so there was
 * no way to tell a slow query from a click that had not registered.
 *
 * A loading file does more than draw a box. It makes the navigation itself
 * immediate, and it lets Next.js partially prefetch a dynamic route, which it
 * otherwise skips entirely.
 *
 * Deliberately generic. A skeleton that mimics each page exactly has to be
 * updated whenever that page changes, and one that has drifted is worse than
 * a plain shape -- it promises a layout that is not what arrives. This draws
 * the chrome every dashboard page shares: a title, a line of description, and
 * the panel the content lands in.
 */

type DashboardLoadingSkeletonProps = {
  /** Announced to screen readers, e.g. "analytics". */
  label: string;
  /** Rough height of the main panel, matched to the page's usual shape. */
  panel?: "tall" | "short" | "split";
};

export function DashboardLoadingSkeleton({
  label,
  panel = "tall",
}: DashboardLoadingSkeletonProps) {
  return (
    <div
      className="h-full w-full overflow-hidden p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading {label}…</span>

      <div className="mx-auto flex h-full max-w-6xl animate-pulse flex-col">
        <div className="shrink-0">
          <div className="h-7 w-44 rounded-lg bg-slate-200" />
          <div className="mt-2.5 h-4 w-72 rounded bg-slate-200/70" />
        </div>

        {panel === "split" ? (
          <div className="mt-6 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="rounded-2xl border border-slate-200 bg-white" />
            <div className="hidden rounded-2xl border border-slate-200 bg-white lg:block" />
          </div>
        ) : panel === "short" ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((card) => (
              <div
                key={card}
                className="h-32 rounded-2xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 min-h-0 flex-1 rounded-2xl border border-slate-200 bg-white" />
        )}
      </div>
    </div>
  );
}
