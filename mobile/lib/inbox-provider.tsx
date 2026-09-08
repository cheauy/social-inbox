import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, ApiError } from "./api/client";
import { useAuth } from "./auth/provider";
import { sessionStorage } from "./auth/secure-storage";
import { supabase } from "./supabase/client";
import type { InboxConversation, Member, Workspace } from "./types";

type InboxState = {
  workspaces: Workspace[]; workspace: Workspace | null; member: Member | null;
  conversations: InboxConversation[]; loading: boolean; error: string; live: boolean; revision: number;
  refresh: () => Promise<void>; loadWorkspaces: () => Promise<void>; selectWorkspace: (workspace: Workspace) => Promise<void>;
  updateConversation: (id: string, value: Partial<InboxConversation>) => void;
};
const Context = createContext<InboxState | null>(null);
export const useInbox = () => { const value = useContext(Context); if (!value) throw new Error("Inbox provider missing"); return value; };
export function InboxProvider({ children }: React.PropsWithChildren) {
  const { session } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0), request = useRef(0), alive = useRef(true);
  const workspaceRef = useRef<Workspace | null>(null);
  const storageKey = `workspace.${session?.user.id}`;
  useEffect(() => () => { alive.current = false; generation.current++; }, []);
  const clear = useCallback(() => { workspaceRef.current = null; setWorkspace(null); setMember(null); setConversations([]); }, []);
  const loadWorkspaces = useCallback(async () => {
    if (!session) { setLoading(false); return; }
    const current = generation.current;
    setLoading(true); setError("");
    try {
      const data = await api<{ workspaces: Workspace[] }>("/api/workspaces", workspaceRef.current?.businessId);
      if (!alive.current || current !== generation.current) return;
      setWorkspaces(data.workspaces);
      const saved = workspaceRef.current?.businessId || await sessionStorage.getItem(storageKey);
      if (!alive.current || current !== generation.current) return;
      const selected = data.workspaces.find(w => w.businessId === saved && w.subscriptionOperational);
      if (selected) { workspaceRef.current = selected; setWorkspace(selected); } else clear();
    } catch (e) { if (alive.current && current === generation.current) { setError(e instanceof Error ? e.message : "Unable to load workspaces."); if (e instanceof ApiError && [401, 403].includes(e.status)) clear(); } }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [session?.user.id, storageKey, clear]);
  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);
  const selectWorkspace = useCallback(async (next: Workspace) => {
    const current = ++generation.current;
    clear(); setLoading(true); setError("");
    try {
      await api("/api/workspaces/switch", next.businessId, { method: "POST", body: { businessId: next.businessId } });
      if (!alive.current || current !== generation.current) return;
      await sessionStorage.setItem(storageKey, next.businessId);
      if (!alive.current || current !== generation.current) return;
      workspaceRef.current = next; setWorkspace(next);
    } catch (e) { if (alive.current && current === generation.current) setError(e instanceof Error ? e.message : "Unable to switch workspace."); throw e; }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [clear, storageKey]);
  const refresh = useCallback(async () => {
    const selected = workspaceRef.current;
    if (!selected) return;
    const current = generation.current, sequence = ++request.current;
    try {
      const data = await api<{ conversations: InboxConversation[]; member: Member }>(`/api/mobile/bootstrap?workspaceId=${encodeURIComponent(selected.businessId)}`, selected.businessId);
      if (!alive.current || current !== generation.current || sequence !== request.current) return;
      setConversations(data.conversations); setMember(data.member); setError("");
    } catch (e) {
      if (!alive.current || current !== generation.current || sequence !== request.current) return;
      setError(e instanceof Error ? e.message : "Unable to load Inbox.");
      if (e instanceof ApiError && [401, 403].includes(e.status)) clear();
    } finally { if (alive.current && current === generation.current && sequence === request.current) setLoading(false); }
  }, [clear]);
  useEffect(() => {
    if (!workspace?.businessId) return;
    setLoading(true); void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => { setRevision(v => v + 1); void refresh(); }, 300); };
    let channel = supabase.channel(`tenh-mobile-${workspace.businessId}`);
    for (const table of ["messages", "conversations", "contacts"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${workspace.businessId}` }, changed);
    for (const table of ["team_members", "business_subscriptions", "social_accounts"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${workspace.businessId}` }, () => { void loadWorkspaces(); changed(); });
    channel.subscribe(status => { setLive(status === "SUBSCRIBED"); if (status === "SUBSCRIBED") changed(); });
    const listener = AppState.addEventListener("change", state => { if (state === "active") { void loadWorkspaces(); changed(); } });
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); listener.remove(); setLive(false); };
  }, [workspace?.businessId, refresh, loadWorkspaces]);
  const updateConversation = useCallback((id: string, patch: Partial<InboxConversation>) => setConversations(items => items.map(c => c.id === id ? { ...c, ...patch } : c)), []);
  return <Context.Provider value={{ workspaces, workspace, member, conversations, loading, error, live, revision, refresh, loadWorkspaces, selectWorkspace, updateConversation }}>{children}</Context.Provider>;
}
