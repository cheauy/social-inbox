"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseConversationPageRequest } from "@/lib/inbox/conversation-page-contract";
import { uuidPattern } from "@/lib/inbox/live-sync";

type Identity = { userId: string; businessId: string; memberId: string };
type Location = { businessId: string; memberId: string; accessibleBusinessIds: string[]; query: string;
  selected: { id: string; businessId: string; channelId: string | null } | null };
type Snapshot = { identity: string; href: string };
type ReturnContext = { href: string; remember: (location: Location) => void };
const InboxReturnContext = createContext<ReturnContext | null>(null);
const identityKey = (identity: Identity) => JSON.stringify([identity.userId, identity.businessId, identity.memberId]);

// Only navigation IDs and URL filters. Never retain rows, messages or drafts.
export function buildInboxReturnHref(location: Location): string | null {
  if (location.query.length > 2048 || location.accessibleBusinessIds.length > 100) return null;
  try {
    const input = new URLSearchParams(location.query);
    const request = parseConversationPageRequest({ status: input.get("status") ?? "all", view: input.get("view") ?? "all",
      channelId: input.get("channel") ?? input.get("page"), workspaceId: input.get("workspace") });
    if (request.workspaceId && !location.accessibleBusinessIds.includes(request.workspaceId)) return null;
    const query = new URLSearchParams();
    if (request.channelId) query.set("channel", request.channelId);
    if (request.workspaceId) query.set("workspace", request.workspaceId);
    if (request.status !== "all") query.set("status", request.status);
    if (request.view !== "all") query.set("view", request.view);
    const selected = location.selected;
    // The existing server page independently authorizes this row and loads
    // fresh messages. Omit a thread outside the requested channel/workspace.
    if (selected && uuidPattern.test(selected.id) && location.accessibleBusinessIds.includes(selected.businessId) &&
      (!request.workspaceId || request.workspaceId === selected.businessId) &&
      (!request.channelId || request.channelId === selected.channelId)) query.set("conversation", selected.id);
    const suffix = query.toString();
    return suffix ? `/dashboard/inbox?${suffix}` : "/dashboard/inbox";
  } catch { return null; }
}

export function InboxReturnContextProvider({ userId, businessId, memberId, children }: Identity & { children: ReactNode }) {
  const key = identityKey({ userId, businessId, memberId });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const remember = useCallback((location: Location) => {
    if (location.businessId !== businessId || location.memberId !== memberId) return;
    const href = buildInboxReturnHref(location);
    setSnapshot(previous => href ? previous?.identity === key && previous.href === href ? previous : { identity: key, href } : null);
  }, [key, businessId, memberId]);
  useEffect(() => {
    const clear = () => setSnapshot(null);
    window.addEventListener("tenh:workspace-data-changed", clear);
    return () => window.removeEventListener("tenh:workspace-data-changed", clear);
  }, []);
  const href = snapshot?.identity === key ? snapshot.href : "/dashboard/inbox";
  const value = useMemo(() => ({ href, remember }), [href, remember]);
  return <InboxReturnContext.Provider value={value}>{children}</InboxReturnContext.Provider>;
}

export function useInboxReturnHref() {
  return useContext(InboxReturnContext)?.href ?? "/dashboard/inbox";
}

export function useRememberInboxReturn(location: Location) {
  const remember = useContext(InboxReturnContext)?.remember;
  const { businessId, memberId, accessibleBusinessIds, query, selected } = location;
  const accessibleKey = accessibleBusinessIds.join(",");
  const id = selected?.id, selectedBusiness = selected?.businessId, channelId = selected?.channelId;
  useEffect(() => {
    remember?.({ businessId, memberId, accessibleBusinessIds: accessibleKey.split(","), query,
      selected: id && selectedBusiness ? { id, businessId: selectedBusiness, channelId: channelId ?? null } : null });
  }, [remember, businessId, memberId, accessibleKey, query, id, selectedBusiness, channelId]);
}
