"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

type FacebookDisconnectButtonProps = {
  socialAccountId: string;
  pageName: string;
};

export function FacebookDisconnectButton({
  socialAccountId,
  pageName,
}: FacebookDisconnectButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openConfirm() {
    if (disconnecting) {
      return;
    }

    setError(null);
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (disconnecting) {
      return;
    }

    setConfirmOpen(false);
    setError(null);
  }

  async function handleDisconnect() {
    if (disconnecting) {
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
          result.error ?? "Unable to disconnect the Facebook Page.",
        );
      }

      const query = new URLSearchParams({
        facebook: "disconnected",
        message: `${pageName} was disconnected. Conversation history was preserved.`,
      });

      if (result.warning) {
        query.set("warning", result.warning);
      }

      setConfirmOpen(false);
      router.replace(`/dashboard/integrations?${query.toString()}`);
      router.refresh();
    } catch (disconnectError) {
      /*
       * Keep the dialog open and show the reason inside it. Previously the
       * native confirm() had already closed, so the error appeared as small
       * text beside the button and was easy to miss.
       */
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Unable to disconnect the Facebook Page.",
      );
      setDisconnecting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openConfirm}
        disabled={disconnecting}
        className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disconnecting ? "Disconnecting..." : "Disconnect"}
      </button>

      <ConfirmActionDialog
        open={confirmOpen}
        icon="unplug"
        tone="danger"
        title="Disconnect this Page?"
        description={`TENH will stop receiving new Messenger messages and comments from ${pageName} until you reconnect it.`}
        note="Your existing customers, conversations, and messages stay saved. The channel slot is freed for another Page."
        confirmLabel="Disconnect"
        loadingLabel="Disconnecting..."
        loading={disconnecting}
        error={error}
        onCancel={closeConfirm}
        onConfirm={() => void handleDisconnect()}
      />
    </>
  );
}
