export default function IntegrationsPage() {
  return (
    <main className="p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            Integrations
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Connect the social accounts used by your business.
          </p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-bold text-white">
                f
              </div>

              <div>
                <h2 className="font-semibold text-slate-900">
                  Facebook Page
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Receive and reply to Facebook Messenger messages.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled
              className="rounded-xl bg-slate-200 px-5 py-3 font-medium text-slate-500"
            >
              Not connected
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}