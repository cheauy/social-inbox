import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-2xl text-white">
          💬
        </div>

        <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-blue-600">
          Social Inbox
        </p>

        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          Manage customer messages in one place
        </h1>

        <p className="mt-4 leading-7 text-slate-600">
          Connect your Facebook Page, receive Messenger messages
          live, and reply to customers from your website.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard/inbox"
            className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700"
          >
            Open inbox
          </Link>

          <Link
            href="/dashboard/integrations"
            className="rounded-xl border border-slate-300 px-5 py-3 font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Connect Facebook
          </Link>
        </div>
      </section>
    </main>
  );
}