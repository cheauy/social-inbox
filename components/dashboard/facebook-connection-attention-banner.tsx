"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

type AttentionPage = {
  id: string;
  name: string;
  status: string;
  message: string | null;
};

type AttentionResponse = {
  success?: boolean;
  canManageChannels?: boolean;
  pages?: AttentionPage[];
};

const POLL_INTERVAL_MS = 60_000;

export function FacebookConnectionAttentionBanner() {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = useCallback(
    (en: string, km: string) => (isKhmer ? km : en),
    [isKhmer],
  );
  const [pages, setPages] = useState<AttentionPage[]>([]);
  const [canManageChannels, setCanManageChannels] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/facebook/connection-attention", {
        cache: "no-store",
      });
      const result = (await response.json()) as AttentionResponse;

      if (response.ok && result.success) {
        setPages(result.pages ?? []);
        setCanManageChannels(result.canManageChannels === true);
      }
    } catch {
      // Connection warnings must never break dashboard rendering.
    }
  }, []);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    function handleFocus() {
      void load();
    }

    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [load]);

  if (pages.length === 0) {
    return null;
  }

  const names = pages.map((page) => page.name);
  const pageLabel =
    names.length <= 2
      ? names.join(", ")
      : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

  return (
    <div className="px-[clamp(12px,3vw,24px)] pt-3">
      <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-600 text-sm font-black text-white"
            aria-hidden="true"
          >
            !
          </span>

          <div className="min-w-0">
            <p className="text-sm font-bold text-red-950">
              {t(
                "Facebook connection paused",
                "ការតភ្ជាប់ Facebook ត្រូវបានផ្អាក",
              )}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-red-800">
              <span className="font-semibold">{pageLabel}</span>
              {" — "}
              {canManageChannels
                ? t(
                    "Facebook authorization changed. Reconnect to resume Messenger and comment delivery. Existing TENH history is safe.",
                    "ការអនុញ្ញាត Facebook បានផ្លាស់ប្តូរ។ សូមភ្ជាប់ឡើងវិញ ដើម្បីបន្តទទួលសារ Messenger និងមតិយោបល់។ ប្រវត្តិ TENH ដែលមានស្រាប់ត្រូវបានរក្សាទុក។",
                  )
                : t(
                    "Facebook authorization needs attention from a workspace Owner or member with Channel Manage permission.",
                    "ការអនុញ្ញាត Facebook ត្រូវការការយកចិត្តទុកដាក់ពីម្ចាស់ Workspace ឬសមាជិកដែលមានសិទ្ធិ Channel Manage។",
                  )}
            </p>
          </div>
        </div>

        {canManageChannels ? (
          <a
            href="/dashboard/integrations"
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            {t("Reconnect Facebook", "ភ្ជាប់ Facebook ឡើងវិញ")}
          </a>
        ) : null}
      </div>
    </div>
  );
}
