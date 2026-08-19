import Link from "next/link";
import { Suspense } from "react";

import {
  InboxChannelSelector,
} from "@/components/inbox/inbox-channel-selector";

export function RemovedWorkspaceAccessShell({
  message,
}: {
  message: string;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Suspense
            fallback={
              <div className="border-b border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
                Loading channels…
              </div>
            }
          >
            <InboxChannelSelector />
          </Suspense>

          <div className="p-4">
            <p className="text-xs leading-5 text-slate-500">
              Select another channel only if you still have access to its subscription. TENH will never switch you automatically.
            </p>
          </div>
        </section>

        <section className="flex min-h-[260px] items-center justify-center rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="max-w-xl text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-lg font-bold text-red-600">
              !
            </div>

            <h1 className="mt-4 text-xl font-bold text-slate-950">
              You no longer have access to this subscription.
            </h1>

            <p className="mt-3 text-sm leading-6 text-red-700">
              {message}
            </p>

            <p className="mt-3 text-sm leading-6 text-slate-500">
              Channels from this subscription stay visible only so you know which access was removed. Their conversations are not loaded. Channels from subscriptions you can still access continue to work normally.
            </p>

            <Link
              href="/dashboard/subscription/buy"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700"
            >
              Buy new subscription
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
