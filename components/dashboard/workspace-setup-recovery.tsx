"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function WorkspaceSetupRecovery() {
  const router = useRouter();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();

    async function recover() {
      try {
        const response = await fetch("/api/onboarding/ensure-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | { success?: boolean; error?: string; trialGranted?: boolean | null }
          | null;

        if (!response.ok || !payload?.success) {
          throw new Error(
            payload?.error ||
              "TENH could not finish setting up this workspace. Please try again.",
          );
        }

        if (payload.trialGranted === false) {
          router.replace("/dashboard/subscription/buy");
          router.refresh();
          return;
        }

        router.replace("/dashboard/inbox");
        router.refresh();
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "TENH could not finish setting up this workspace.",
        );
      }
    }

    void recover();
    return () => controller.abort();
  }, [router]);

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-slate-100 p-6">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-600">
          T
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-950">
          Preparing your TENH workspace
        </h1>
        {error ? (
          <>
            <p className="mt-3 text-sm leading-6 text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
            >
              Try again
            </button>
          </>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-500">
            TENH is verifying your account, creating your first workspace if needed, and selecting the correct subscription. This does not switch you into another user&apos;s subscription.
          </p>
        )}
      </div>
    </main>
  );
}
