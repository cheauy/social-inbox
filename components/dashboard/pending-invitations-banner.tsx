"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

type PendingInvitation = {
  id: string;
  role: string;
  email: string;
  expiresAt: string;
  businessName: string;
  subscriptionLabel: string;
};

type PendingResponse = {
  success?: boolean;
  invitations?: PendingInvitation[];
  error?: string;
};

const POLL_INTERVAL_MS = 60_000;

function daysLeft(expiresAt: string) {
  const ms = Date.parse(expiresAt) - Date.now();

  if (!Number.isFinite(ms) || ms <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export function PendingInvitationsBanner() {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = useCallback(
    (en: string, km: string) => (isKhmer ? km : en),
    [isKhmer],
  );

  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/invitations/pending", {
        cache: "no-store",
      });

      const result = (await response.json()) as PendingResponse;

      if (response.ok && result.success) {
        setInvitations(result.invitations ?? []);
      }
    } catch {
      /* A missing banner is better than a broken dashboard. */
    }
  }, []);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [load]);

  async function accept(invitation: PendingInvitation) {
    setPendingId(invitation.id);
    setError(null);

    try {
      const response = await fetch("/api/invitations/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: invitation.id }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to accept this invitation.",
        );
      }

      // Full reload so the layout re-reads the new active workspace cookie.
      window.location.assign("/dashboard/inbox");
    } catch (acceptError) {
      setPendingId(null);
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : "Unable to accept this invitation.",
      );
    }
  }

  const visible = invitations.filter(
    (invitation) => !dismissed.includes(invitation.id),
  );

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 px-[clamp(12px,3vw,24px)] pt-3">
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {visible.map((invitation) => {
        const days = daysLeft(invitation.expiresAt);
        const busy = pendingId === invitation.id;

        return (
          <div
            key={invitation.id}
            className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m4 7 8 6 8-6" />
                </svg>
              </span>

              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-950">
                  {t("You were invited to", "អ្នកត្រូវបានអញ្ជើញឲ្យចូលរួម")}{" "}
                  {invitation.businessName}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-600">
                  {invitation.role === "owner"
                    ? t("As Owner", "ជាម្ចាស់")
                    : t("As Team member", "ជាសមាជិកក្រុម")}
                  {" · "}
                  {invitation.subscriptionLabel}
                  {" · "}
                  {days === 1
                    ? t("Expires tomorrow", "ផុតកំណត់ថ្ងៃស្អែក")
                    : t(
                        `Expires in ${days} days`,
                        `ផុតកំណត់ក្នុងរយៈពេល ${days} ថ្ងៃ`,
                      )}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setDismissed((current) => [...current, invitation.id])
                }
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {t("Later", "ពេលក្រោយ")}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void accept(invitation)}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:bg-blue-300"
              >
                {busy
                  ? t("Joining...", "កំពុងចូលរួម...")
                  : t("Accept", "ទទួលយក")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
