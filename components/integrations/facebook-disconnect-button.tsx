"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { IntegrationActionMenu } from "@/components/integrations/integration-action-menu";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT, TENH_ACTIVE_WORKSPACE_UI_STORAGE_KEY } from "@/lib/display/workspace-storage";
import { setIntegrationEnabled } from "@/lib/channels/set-integration-enabled";

type FacebookDisconnectButtonProps = {
  socialAccountId: string;
  pageName: string;
  enabled?: boolean;
  reconnectRequired?: boolean;
  businessId?: string;
};

export function FacebookDisconnectButton({ socialAccountId, pageName, enabled, reconnectRequired, businessId = "" }: FacebookDisconnectButtonProps) {
  const router = useRouter();
  const isKhmer = useWorkspaceLanguageId() === "km";
  const text = (en: string, km: string) => isKhmer ? km : en;
  const [action, setAction] = useState<"disable" | "disconnect" | null>(null);
  const [working, setWorking] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scopeInvalid, setScopeInvalid] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const close = () => { generation.current++; setAction(null); setError(null); };
    const workspaceChanged = () => { close(); setScopeInvalid(true); };
    const storageChanged = (event: StorageEvent) => { if (event.key === TENH_ACTIVE_WORKSPACE_UI_STORAGE_KEY) workspaceChanged(); };
    const invalidate = () => { generation.current++; };
    window.addEventListener(TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT, workspaceChanged);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("popstate", close);
    return () => {
      invalidate();
      mounted.current = false;
      window.removeEventListener(TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT, workspaceChanged);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("popstate", close);
    };
  }, []);

  async function change(kind: "enable" | "disable" | "disconnect") {
    if (busy.current || refreshing || scopeInvalid) return;
    busy.current = true;
    const version = generation.current;
    setWorking(true); setError(null);
    try {
      if (kind === "disconnect") {
        const response = await fetch(`/api/facebook/connections/${encodeURIComponent(socialAccountId)}/disconnect`, { method: "POST" });
        const result = await response.json() as { success?: boolean; error?: string; warning?: string | null };
        if (version !== generation.current) return;
        if (!response.ok || !result.success) throw new Error(result.error ?? "Unable to disconnect the Facebook Page.");
        const query = new URLSearchParams({ facebook: "disconnected", message: `${pageName} was disconnected. Conversation history was preserved.` });
        if (result.warning) query.set("warning", result.warning);
        setAction(null);
        startTransition(() => { router.replace(`/dashboard/integrations?${query.toString()}`, { scroll: false }); router.refresh(); });
      } else {
        await setIntegrationEnabled(socialAccountId, kind === "enable", businessId);
        if (version !== generation.current) return;
        setAction(null);
        startTransition(() => router.refresh());
      }
    } catch (failure) {
      if (version === generation.current) setError(failure instanceof Error ? failure.message : "Unable to update this Page.");
    } finally {
      busy.current = false;
      if (mounted.current) {
        setWorking(false);
        if (version !== generation.current) startTransition(() => router.refresh());
      }
    }
  }

  return <>
    <IntegrationActionMenu name={pageName} disabled={working || refreshing || scopeInvalid} actions={[
      ...(businessId ? [{ label: enabled ? text("Disable inbox", "បិទប្រអប់សារ") : text("Enable inbox", "បើកប្រអប់សារ"), onSelect: () => { setError(null); if (enabled) setAction("disable"); else void change("enable"); } }] : []),
      ...(reconnectRequired ? [{ label: text("Reconnect", "ភ្ជាប់ឡើងវិញ"), href: "/api/facebook/oauth/connect" }] : []),
      { label: text("Disconnect", "ផ្តាច់ការតភ្ជាប់"), danger: true, onSelect: () => { setError(null); setAction("disconnect"); } },
    ]} />
    {error && !action ? <p role="alert" className="max-w-xs text-sm text-red-700">{error}</p> : null}
    <ConfirmActionDialog open={Boolean(action)} icon={action === "disconnect" ? "unplug" : "warning"} tone={action === "disconnect" ? "danger" : "warning"}
      title={action === "disconnect" ? text("Disconnect this Page?", "ផ្តាច់ Page នេះ?") : text("Disable inbox?", "បិទប្រអប់សារ?")}
      description={action === "disconnect" ? text(`TENH will stop receiving new Messenger messages and comments from ${pageName} until you reconnect it.`, `TENH នឹងឈប់ទទួលសារ Messenger និងមតិយោបល់ថ្មីពី ${pageName} រហូតដល់អ្នកភ្ជាប់ឡើងវិញ។`) : text(`New messages and comments from ${pageName} will stop arriving in your Inbox.`, `សារ និងមតិយោបល់ថ្មីពី ${pageName} នឹងឈប់ចូលប្រអប់សារ។`)}
      note={action === "disconnect" ? text("Your customers, conversations and messages stay saved. Saved credentials are removed and the channel slot is freed. Reconnect the Page to receive messages again.", "អតិថិជន សន្ទនា និងសាររបស់អ្នកនៅតែរក្សាទុក។ ព័ត៌មានភ្ជាប់ត្រូវបានលុប ហើយកន្លែងឆានែលត្រូវបានដោះលែង។ ភ្ជាប់ Page ឡើងវិញដើម្បីទទួលសារ។") : text("The Page stays connected, and your conversations and credentials are kept. You can enable Inbox again later, within your subscription limit.", "Page នៅតែបានភ្ជាប់ ហើយសន្ទនា និងព័ត៌មានភ្ជាប់ត្រូវបានរក្សាទុក។ អ្នកអាចបើកប្រអប់សារឡើងវិញ ក្នុងកម្រិតគម្រោងរបស់អ្នក។")}
      confirmLabel={action === "disconnect" ? text("Disconnect", "ផ្តាច់ការតភ្ជាប់") : text("Disable inbox", "បិទប្រអប់សារ")}
      cancelLabel={text("Cancel", "បោះបង់")} closeLabel={text("Close confirmation", "បិទការបញ្ជាក់")} loadingLabel={text("Working…", "កំពុងដំណើរការ…")}
      loading={working} error={error} onCancel={() => { if (!busy.current) { setAction(null); setError(null); } }}
      onConfirm={() => { if (action) void change(action); }} />
  </>;
}
