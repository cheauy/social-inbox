"use client";

import { useEffect, useState } from "react";

export function WorkspaceAccessRemovedNotice({
  fallbackBusinessId,
}: {
  fallbackBusinessId: string;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!fallbackBusinessId) {
      return;
    }

    void fetch("/api/workspaces/switch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessId: fallbackBusinessId,
      }),
    }).catch(() => {
      // The current server render already uses the fallback workspace.
      // A failed cookie update can safely retry on the next navigation.
    });
  }, [fallbackBusinessId]);

  if (!visible) {
    return null;
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-amber-900">
            You don&apos;t have access to that subscription anymore.
          </p>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            TENH switched you to another subscription you can access. Your other subscriptions are not affected.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setVisible(false)}
          className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
          aria-label="Dismiss access notice"
        >
          ×
        </button>
      </div>
    </div>
  );
}
