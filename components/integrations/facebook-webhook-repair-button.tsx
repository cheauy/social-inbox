"use client";

import { useState } from "react";

export function FacebookWebhookRepairButton() {
  const [repairing, setRepairing] =
    useState(false);
  const [notice, setNotice] =
    useState<string | null>(null);
  const [failed, setFailed] =
    useState(false);

  async function repair() {
    if (repairing) {
      return;
    }

    setRepairing(true);
    setNotice(null);
    setFailed(false);

    try {
      const response = await fetch(
        "/api/facebook/subscribe",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      const text = await response.text();
      const result = text.trim()
        ? (JSON.parse(text) as {
            success?: boolean;
            repairedCount?: number;
            failedCount?: number;
            error?: string;
            pages?: Array<{
              pageName?: string;
              success?: boolean;
              error?: string | null;
            }>;
          })
        : {};

      if (!response.ok || !result.success) {
        const failedPages =
          result.pages
            ?.filter((page) => !page.success)
            .map((page) =>
              `${page.pageName ?? "Facebook Page"}: ${
                page.error ?? "subscription failed"
              }`,
            )
            .join(" · ");

        throw new Error(
          failedPages ||
            result.error ||
            "Unable to repair Facebook webhooks.",
        );
      }

      setNotice(
        `Webhook repaired for ${result.repairedCount ?? 0} Facebook Page${
          result.repairedCount === 1 ? "" : "s"
        }.`,
      );
    } catch (error) {
      setFailed(true);
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to repair Facebook webhooks.",
      );
    } finally {
      setRepairing(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={() => void repair()}
        disabled={repairing}
        className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
      >
        {repairing
          ? "Repairing webhooks..."
          : "Repair Facebook webhooks"}
      </button>

      {notice ? (
        <p
          className={`max-w-xs text-xs ${
            failed
              ? "text-red-600"
              : "text-emerald-600"
          }`}
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
