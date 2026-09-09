import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, ApiError } from "./api/client";
import { useAuth } from "./auth/provider";
import { sessionStorage } from "./auth/secure-storage";
import { supabase } from "./supabase/client";
import type { InboxConversation, Member, TeamRoom, Workspace } from "./types";

type InboxState = {
  workspaces: Workspace[]; workspace: Workspace | null; member: Member | null;
  conversations: InboxConversation[]; loading: boolean; error: string; live: boolean; revision: number;
  refresh: () => Promise<void>; loadWorkspaces: () => Promise<void>; selectWorkspace: (workspace: Workspace) => Promise<void>;
  updateConversation: (id: string, value: Partial<InboxConversation>) => void;
  updateContactTags: (contactId: string, tags: NonNullable<InboxConversation["contact"]>["tags"]) => void;

  /*
   * Team chat lives here rather than in the Group Chat tab because three
   * places need it at once: the tab bar draws a badge from it, the tab lists
   * it, and a room's own header reads its name, description and mute state
   * out of it. One fetch, one truth.
   */
  rooms: TeamRoom[];
  roomsBadge: number;
  roster: Member[];
  canManageRooms: boolean;
  refreshRooms: () => Promise<void>;
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
  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  const [roomsBadge, setRoomsBadge] = useState(0);
  const [roster, setRoster] = useState<Member[]>([]);
  const [canManageRooms, setCanManageRooms] = useState(false);
  const generation = useRef(0), request = useRef(0), alive = useRef(true);
  const workspaceRef = useRef<Workspace | null>(null);
  const storageKey = `workspace.${session?.user.id}`;
  useEffect(() => () => { alive.current = false; generation.current++; }, []);
  const clear = useCallback(() => { workspaceRef.current = null; setWorkspace(null); setMember(null); setConversations([]); setRooms([]); setRoomsBadge(0); setRoster([]); setCanManageRooms(false); }, []);
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
  const refreshRooms = useCallback(async () => {
    const selected = workspaceRef.current;
    if (!selected) return;
    const current = generation.current;
    try {
      const data = await api<{ rooms: TeamRoom[]; totalBadgeCount: number; members: Member[]; canManage: boolean }>("/api/team-chat/rooms", selected.businessId);
      if (!alive.current || current !== generation.current) return;
      setRooms(data.rooms ?? []);
      setRoomsBadge(data.totalBadgeCount ?? 0);
      setRoster(data.members ?? []);
      setCanManageRooms(Boolean(data.canManage));
    } catch {
      // The Group Chat tab shows its own empty state; a failed poll here is
      // not worth taking over the Inbox's error line.
    }
  }, []);
  useEffect(() => {
    if (!workspace?.businessId) return;
    setLoading(true); void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => { setRevision(v => v + 1); void refresh(); void refreshRooms(); }, 300); };
    let channel = supabase.channel(`tenh-mobile-${workspace.businessId}`);
    for (const table of ["messages", "conversations", "contacts", "team_chat_messages", "team_chat_rooms"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${workspace.businessId}` }, changed);
    for (const table of ["team_members", "business_subscriptions", "social_accounts"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${workspace.businessId}` }, () => { void loadWorkspaces(); changed(); });
    channel.subscribe(status => { setLive(status === "SUBSCRIBED"); if (status === "SUBSCRIBED") changed(); });
    const listener = AppState.addEventListener("change", state => { if (state === "active") { void loadWorkspaces(); changed(); } });
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); listener.remove(); setLive(false); };
  }, [workspace?.businessId, refresh, refreshRooms, loadWorkspaces]);
  const updateConversation = useCallback((id: string, patch: Partial<InboxConversation>) => setConversations(items => items.map(c => c.id === id ? { ...c, ...patch } : c)), []);
  const updateContactTags = useCallback((contactId: string, tags: NonNullable<InboxConversation["contact"]>["tags"]) => {
    setConversations((items) =>
      items.map((item) =>
        item.contact?.id === contactId
          ? { ...item, contact: { ...item.contact, tags } }
          : item,
      ),
    );
  }, []);
  return <Context.Provider value={{ workspaces, workspace, member, conversations, loading, error, live, revision, refresh, loadWorkspaces, selectWorkspace, updateConversation, updateContactTags, rooms, roomsBadge, roster, canManageRooms, refreshRooms }}>{children}</Context.Provider>;
}
