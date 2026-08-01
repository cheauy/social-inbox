export default function InboxLoading() {
  return (
    <main className="p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded bg-slate-200" />
        </div>

        <div className="min-h-[650px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
      </div>
    </main>
  );
}