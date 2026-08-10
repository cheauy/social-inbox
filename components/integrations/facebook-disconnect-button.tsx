"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type FacebookDisconnectButtonProps = {
  socialAccountId: string;
  pageName: string;
};

export function FacebookDisconnectButton({
  socialAccountId,
  pageName,
}: FacebookDisconnectButtonProps) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  async function handleDisconnect() {
    if (disconnecting) {
      return;
    }

    const confirmed = window.confirm(
      `Disconnect ${pageName} from TENH?\n\nYour existing customers, conversations, and messages will stay saved. TENH will stop receiving new Facebook events from this Page until you reconnect it.`,
    );

    if (!confirmed) {
      return;
    }

    setDisconnecting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/facebook/connections/${encodeURIComponent(
          socialAccountId,
        )}/disconnect`,
        {
          method: "POST",
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        warning?: string | null;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to disconnect the Facebook Page.",
        );
      }

      const query = new URLSearchParams({
        facebook: "disconnected",
        message: `${pageName} was disconnected. Conversation history was preserved.`,
      });

      if (result.warning) {
        query.set("warning", result.warning);
      }

      router.replace(
        `/dashboard/integrations?${query.toString()}`,
      );
      router.refresh();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Unable to disconnect the Facebook Page.",
      );
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() =>
          void handleDisconnect()
        }
        disabled={disconnecting}
        className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disconnecting
          ? "Disconnecting..."
          : "Disconnect"}
      </button>

      {error ? (
        <p className="max-w-56 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
