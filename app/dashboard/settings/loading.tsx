/*
 * Instant skeleton for every Settings page.
 *
 * Each Settings page is a server component that awaits getCurrentMember()
 * plus its own Supabase queries before returning any markup. Without a
 * loading.tsx, Next.js has nothing to show during that wait, so clicking a
 * Settings link left the old page frozen on screen until the server replied —
 * which reads as "the app is slow" even when the query is quick.
 *
 * With this file the sidebar stays interactive and this skeleton paints
 * immediately, so the customer sees the page change on click.
 */
export default function SettingsLoading() {
  return (
    <div className="p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading settings…</span>

      <div className="animate-pulse">
        {/* Page title + description */}
        <div className="h-8 w-52 rounded-lg bg-slate-200" />
        <div className="mt-3 h-4 w-80 rounded bg-slate-200/80" />

        {/* Tab strip */}
        <div className="mt-6 flex gap-6 border-b border-slate-200 pb-3">
          {[72, 56, 88, 64, 96].map((width, index) => (
            <div
              key={index}
              className="h-4 rounded bg-slate-200/80"
              style={{ width }}
            />
          ))}
        </div>

        {/* Card */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="h-5 w-44 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-72 rounded bg-slate-200/80" />

          <div className="mt-6 space-y-3">
            {[0, 1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="flex items-center gap-4 rounded-xl border border-slate-100 px-4 py-4"
              >
                <div className="h-9 w-9 shrink-0 rounded-xl bg-slate-200" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-40 rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-64 rounded bg-slate-200/70" />
                </div>
                <div className="hidden gap-2 sm:flex">
                  <div className="h-9 w-9 rounded-xl bg-slate-200/80" />
                  <div className="h-9 w-9 rounded-xl bg-slate-200/80" />
                  <div className="h-9 w-9 rounded-xl bg-slate-200/80" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
