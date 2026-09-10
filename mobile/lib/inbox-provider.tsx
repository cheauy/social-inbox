import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, ApiError } from "./api/client";
import { useAuth } from "./auth/provider";
import { sessionStorage } from "./auth/secure-storage";
import { useNotificationSound } from "./notification-sound";
import { supabase } from "./supabase/client";
import type { InboxConversation, Member, TeamRoom, Workspace } from "./types";

type InboxState = {
  workspaces: Workspace[]; workspace: Workspace | null; member: Member | null;
  conversations: InboxConversation[]; loading: boolean; error: string; live: boolean; revision: number;
  refresh: () => Promise<void>; loadWorkspaces: () => Promise<void>; selectWorkspace: (workspace: Workspace) => Promise<void>;

  /*
   * Merging.
   *
   * Somebody who runs two shops can open both at once and read one list.
   * `merged` is the set of workspace ids that list is drawn from.
   *
   * Nothing about a merged list relies on which workspace is "active": every
   * request the app makes carries the workspace it is for, and the server
   * checks that membership before answering. So a thread scopes itself to the
   * conversation's own business -- its messages, its tags, its quick replies,
   * its send -- and a reply cannot land in the other shop even while the
   * chooser's pick sits somewhere else.
   */
  merged: string[];
  openWorkspaces: (chosen: Workspace[]) => Promise<void>;
  updateConversation: (id: string, value: Partial<InboxConversation>) => void;
  updateContactTags: (contactId: string, tags: NonNullable<InboxConversation["contact"]>["tags"]) => void;

  /*
   * Team chat lives here rather than in the Group Chat tab because three
   * places need it at once: the tab bar draws a badge from it, the tab lists
   * it, and a room's own header reads its name, description and mute state
   * out of it. One fetch, one truth.
   */
  rooms: TeamRoom[];
  roomsLoading: boolean;
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
  const [merged, setMerged] = useState<string[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [revision, setRevision] = useState(0);
  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsBadge, setRoomsBadge] = useState(0);
  const [roster, setRoster] = useState<Member[]>([]);
  const [canManageRooms, setCanManageRooms] = useState(false);
  const generation = useRef(0), request = useRef(0), alive = useRef(true);
  /*
   * Held in a ref so the realtime subscription does not have to be torn down
   * and rebuilt every time somebody changes their alert tone.
   */
  const { play, enabled: soundOn } = useNotificationSound();
  const alert = useRef(() => {});
  alert.current = () => { if (soundOn) play(); };
  const workspaceRef = useRef<Workspace | null>(null);
  const mergedRef = useRef<string[]>([]);
  const storageKey = `workspace.${session?.user.id}`;
  const mergeKey = `merged.${session?.user.id}`;
  useEffect(() => () => { alive.current = false; generation.current++; }, []);
  const clear = useCallback(() => { workspaceRef.current = null; setWorkspace(null); mergedRef.current = []; setMerged([]); setMember(null); setConversations([]); setRooms([]); setRoomsLoading(true); setRoomsBadge(0); setRoster([]); setCanManageRooms(false); }, []);
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
      if (selected) {
        workspaceRef.current = selected; setWorkspace(selected);
        /*
         * The merged set is filtered against what is still live: a workspace
         * whose plan lapsed since the last launch drops out of the list
         * rather than making every load fail with a 403.
         */
        const stored = (await sessionStorage.getItem(mergeKey))?.split(",").filter(Boolean) ?? [];
        if (!alive.current || current !== generation.current) return;
        const live = stored.filter(id => data.workspaces.some(w => w.businessId === id && w.subscriptionOperational));
        const next = live.includes(selected.businessId) ? live : [selected.businessId];
        mergedRef.current = next; setMerged(next);
      } else clear();
    } catch (e) { if (alive.current && current === generation.current) { setError(e instanceof Error ? e.message : "Unable to load workspaces."); if (e instanceof ApiError && [401, 403].includes(e.status)) clear(); } }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [session?.user.id, storageKey, clear]);
  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);
  /*
   * Make `next` the workspace that writes go to. Kept separate from choosing,
   * because in a merged list this happens on its own, mid-tap, when somebody
   * opens a thread belonging to the other shop -- so it must not blank the
   * list it was tapped from.
   */
  const activate = useCallback(async (next: Workspace) => {
    await api("/api/workspaces/switch", next.businessId, { method: "POST", body: { businessId: next.businessId } });
    await sessionStorage.setItem(storageKey, next.businessId);
    workspaceRef.current = next; setWorkspace(next);
  }, [storageKey]);

  const openWorkspaces = useCallback(async (chosen: Workspace[]) => {
    const live = chosen.filter(one => one.subscriptionOperational);
    if (live.length === 0) return;
    const current = ++generation.current;
    clear(); setLoading(true); setError("");
    try {
      const ids = live.map(one => one.businessId);
      await activate(live[0]);
      if (!alive.current || current !== generation.current) return;
      await sessionStorage.setItem(mergeKey, ids.join(","));
      mergedRef.current = ids; setMerged(ids);
    } catch (e) { if (alive.current && current === generation.current) setError(e instanceof Error ? e.message : "Unable to switch workspace."); throw e; }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [clear, activate, mergeKey]);

  const selectWorkspace = useCallback((next: Workspace) => openWorkspaces([next]), [openWorkspaces]);

  const refresh = useCallback(async () => {
    const selected = workspaceRef.current;
    if (!selected) return;
    const current = generation.current, sequence = ++request.current;
    try {
      const ids = mergedRef.current.length > 0 ? mergedRef.current : [selected.businessId];
      const data = await api<{ conversations: InboxConversation[]; member: Member }>(`/api/mobile/bootstrap?workspaceIds=${encodeURIComponent(ids.join(","))}`, selected.businessId);
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
    } finally {
      if (alive.current && current === generation.current) setRoomsLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!workspace?.businessId) return;
    setLoading(true); setRoomsLoading(true); void refresh(); void refreshRooms();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => { setRevision(v => v + 1); void refresh(); void refreshRooms(); }, 300); };
    /*
     * Every workspace in the merged list is listened to, not just the active
     * one: a message arriving in the other shop belongs in this list too, and
     * without its own filter it would sit there unread until the next pull.
     */
    const listening = merged.length > 0 ? merged : [workspace.businessId];
    let channel = supabase.channel(`tenh-mobile-${listening.join("-")}`);
    for (const id of listening)
      for (const table of ["messages", "conversations", "contacts", "team_chat_messages", "team_chat_rooms"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${id}` }, changed);
    /*
     * The alert tone, on the arrival itself rather than on the reload the
     * arrival triggers: `changed` is debounced and fires for edits, reads and
     * the agent's own sends, all of which would make a noise for nothing.
     */
    for (const id of listening)
      channel = channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `business_id=eq.${id}` }, payload => { if ((payload.new as { direction?: string } | null)?.direction === "incoming") alert.current(); });
    for (const id of listening)
      for (const table of ["team_members", "business_subscriptions", "social_accounts"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${id}` }, () => { void loadWorkspaces(); changed(); });
    channel.subscribe(status => { setLive(status === "SUBSCRIBED"); if (status === "SUBSCRIBED") changed(); });
    const listener = AppState.addEventListener("change", state => { if (state === "active") { void loadWorkspaces(); changed(); } });
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); listener.remove(); setLive(false); };
  }, [workspace?.businessId, merged.join(","), refresh, refreshRooms, loadWorkspaces]);
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
  return <Context.Provider value={{ workspaces, workspace, member, conversations, loading, error, live, revision, refresh, loadWorkspaces, selectWorkspace, merged, openWorkspaces, updateConversation, updateContactTags, rooms, roomsLoading, roomsBadge, roster, canManageRooms, refreshRooms }}>{children}</Context.Provider>;
}
