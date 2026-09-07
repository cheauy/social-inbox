"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_WORKSPACE_LANGUAGE_ID,
  WORKSPACE_LANGUAGE_CHANGE_EVENT,
  WORKSPACE_LANGUAGE_STORAGE_KEY,
  getStoredWorkspaceLanguageId,
  isWorkspaceLanguageId,
  type WorkspaceLanguageId,
} from "@/lib/display/workspace-language";

const khmerNavigationLabels: Record<string, string> = {
  Inbox: "ប្រអប់សារ",
  "Group Chat": "ជជែកជាក្រុម",
  Analytics: "វិភាគទិន្នន័យ",
  Subscription: "ការជាវ",
  Integrations: "ការតភ្ជាប់",
  Settings: "ការកំណត់",
};

type DashboardNavigationLabelProps = {
  label: string;
};

export function DashboardNavigationLabel({
  label,
}: DashboardNavigationLabelProps) {
  const [languageId, setLanguageId] =
    useState<WorkspaceLanguageId>(
      DEFAULT_WORKSPACE_LANGUAGE_ID,
    );

  useEffect(() => {
    setLanguageId(getStoredWorkspaceLanguageId());

    function handleLanguageChange(event: Event) {
      const customEvent = event as CustomEvent<{
        id?: string;
      }>;
      const nextLanguage = customEvent.detail?.id ?? null;

      if (isWorkspaceLanguageId(nextLanguage)) {
        setLanguageId(nextLanguage);
      }
    }

    function handleStorage(event: StorageEvent) {
      if (
        event.key === WORKSPACE_LANGUAGE_STORAGE_KEY &&
        isWorkspaceLanguageId(event.newValue)
      ) {
        setLanguageId(event.newValue);
      }
    }

    window.addEventListener(
      WORKSPACE_LANGUAGE_CHANGE_EVENT,
      handleLanguageChange,
    );
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(
        WORKSPACE_LANGUAGE_CHANGE_EVENT,
        handleLanguageChange,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  if (languageId !== "km") {
    return <>{label}</>;
  }

  return <>{khmerNavigationLabels[label] ?? label}</>;
}
