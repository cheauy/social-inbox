"use client";

type InboxErrorProps = {
  error: Error & {
    digest?: string;
  };
  reset: () => void;
};

export default function InboxError({
  error,
  reset,
}: InboxErrorProps) {
  return (
    <main className="p-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6">
        <h1 className="text-lg font-bold text-red-900">
          Unable to load the inbox
        </h1>

        <p className="mt-2 text-sm text-red-700">
          {error.message}
        </p>

        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}