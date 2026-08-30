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
import {
  TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
} from "@/lib/display/workspace-storage";

type WorkspaceLanguageTextProps = {
  en: string;
  km: string;
};

export function useWorkspaceLanguageId() {
  const [languageId, setLanguageId] =
    useState<WorkspaceLanguageId>(
      DEFAULT_WORKSPACE_LANGUAGE_ID,
    );

  useEffect(() => {
    setLanguageId(getStoredWorkspaceLanguageId());

    function handleLanguageChange(event: Event) {
      const customEvent = event as CustomEvent<{ id?: string }>;
      const nextLanguage = customEvent.detail?.id ?? null;

      if (isWorkspaceLanguageId(nextLanguage)) {
        setLanguageId(nextLanguage);
      }
    }

    function syncLanguage() {
      setLanguageId(getStoredWorkspaceLanguageId());
    }

    function handleStorage(event: StorageEvent) {
      if (
        event.key === WORKSPACE_LANGUAGE_STORAGE_KEY ||
        event.key?.startsWith(`${WORKSPACE_LANGUAGE_STORAGE_KEY}:`)
      ) {
        syncLanguage();
      }
    }

    function handleWorkspaceUiChange() {
      syncLanguage();
    }

    window.addEventListener(
      WORKSPACE_LANGUAGE_CHANGE_EVENT,
      handleLanguageChange,
    );
    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
      handleWorkspaceUiChange,
    );

    return () => {
      window.removeEventListener(
        WORKSPACE_LANGUAGE_CHANGE_EVENT,
        handleLanguageChange,
      );
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
        handleWorkspaceUiChange,
      );
    };
  }, []);

  return languageId;
}

export function WorkspaceLanguageText({
  en,
  km,
}: WorkspaceLanguageTextProps) {
  const languageId = useWorkspaceLanguageId();
  return <>{languageId === "km" ? km : en}</>;
}
