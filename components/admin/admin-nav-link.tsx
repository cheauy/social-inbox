"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const POLL_MS = 15_000;

export function AdminNavLink() {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tenh-admin/summary", {
        cache: "no-store",
      });

      if (!response.ok) {
        setCount(0);
        return;
      }

      const result = (await response.json()) as {
        success?: boolean;
        summary?: {
          actionable?: number;
        };
      };

      const actionable = result.summary?.actionable;

      setCount(
        result.success &&
          typeof actionable === "number" &&
          Number.isFinite(actionable)
          ? actionable
          : 0,
      );
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      void load();
    }, POLL_MS);

    function handleSummaryChanged() {
      void load();
    }

    window.addEventListener(
      "tenh-admin-summary-changed",
      handleSummaryChanged,
    );

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(
        "tenh-admin-summary-changed",
        handleSummaryChanged,
      );
    };
  }, [load]);

  const label = count > 99 ? "99+" : String(count);

  return (
    <Link
      href="/dashboard/admin"
      className="relative rounded-lg border border-slate-900 bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
    >
      Admin
      {count > 0 ? (
        <span className="absolute -right-2 -top-2 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
          {label}
        </span>
      ) : null}
    </Link>
  );
}
