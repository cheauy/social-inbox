import { SerialTaskQueue } from "./serial-task-queue";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, ApiError } from "./api/client";
import { clearReadCache } from "./api/read-cache";
import { useAuth } from "./auth/provider";
import { sessionStorage } from "./auth/secure-storage";
import { useNotificationSound } from "./notification-sound";
import { supabase } from "./supabase/client";
import type { InboxConversation, Member, TeamRoom, Workspace } from "./types";

type InboxState = {
  workspaces: Workspace[]; workspace: Workspace | null; member: Member | null;
  conversations: InboxConversation[]; loading: boolean; error: string; live: boolean; revision: number; roomRevision: number; settingsRevision: number;

  /*
   * What this member is allowed to do here, as the server resolved it.
   *
   * The bootstrap has always carried this and the app has always thrown it
   * away, so every screen offered every button and let the server refuse --
   * which is safe and reads as broken. A level of "view" means read-only;
   * "manage" means the button is worth showing.
   */
  permissions: Record<string, string | boolean>;
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

  /*
   * Unread alerts and reminders that have fallen due.
   *
   * The Notifications tab is the only one that could not say it had anything
   * waiting: a mention, a failed payment or a page that had stopped
   * authorising sat there until somebody happened to open the tab. Counted
   * here rather than on that screen, because the tab bar needs it whether or
   * not the screen is mounted.
   */
  alertsBadge: number;
  alertsRevision: number;
  refreshAlerts: () => Promise<void>;
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
  const [permissions, setPermissions] = useState<Record<string, string | boolean>>({});
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [revision, setRevision] = useState(0);
  const [roomRevision, setRoomRevision] = useState(0);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsBadge, setRoomsBadge] = useState(0);
  const [alertsBadge, setAlertsBadge] = useState(0);
  const [alertsRevision, setAlertsRevision] = useState(0);
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
  useEffect(() => {
    // React Strict Mode runs setup, cleanup, setup in development. Resetting
    // this flag in setup keeps the second mount alive instead of making every
    // completed request look as though the provider was unmounted.
    alive.current = true;
    return () => { alive.current = false; generation.current++; };
  }, []);
  const clear = useCallback(() => { workspaceRef.current = null; setWorkspace(null); mergedRef.current = []; setMerged([]); setMember(null); setPermissions({}); setConversations([]); setRooms([]); setRoomsLoading(true); setRoomsBadge(0); setAlertsBadge(0); setRoster([]); setCanManageRooms(false); }, []);
  const conversationSnapshot = useRef(conversations);
  conversationSnapshot.current = conversations;
  const loadWorkspaces = useCallback(async (quiet = false) => {
    if (!session) {
      generation.current++;
      setWorkspaces([]);
      clear();
      setError("");
      setLoading(false);
      return;
    }
    const current = generation.current;
    if (!quiet) setLoading(true);
    setError("");
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
  }, [session, storageKey, mergeKey, clear]);
  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);
  /*
   * Make `next` the workspace that writes go to. Kept separate from choosing,
   * because in a merged list this happens on its own, mid-tap, when somebody
   * opens a thread belonging to the other shop -- so it must not blank the
   * list it was tapped from.
   */
  const openWorkspaces = useCallback(async (chosen: Workspace[]) => {
    const live = chosen.filter(one => one.subscriptionOperational);
    if (live.length === 0) return;
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const ids = live.map(one => one.businessId);
      /*
       * Keep the current workspace visible until the server accepts the new
       * one. Clearing first turned a temporary network failure into an empty
       * app, while the website correctly leaves the previous workspace open.
       */
      await api("/api/workspaces/switch", live[0].businessId, {
        method: "POST",
        body: { businessId: live[0].businessId },
      });
      if (!alive.current || current !== generation.current) return;
      await Promise.all([
        sessionStorage.setItem(storageKey, live[0].businessId),
        sessionStorage.setItem(mergeKey, ids.join(",")),
      ]);
      if (!alive.current || current !== generation.current) return;

      // Apply the accepted switch as one state transition so no row from the
      // previous workspace is briefly shown under the new workspace name.
      setMember(null);
      setConversations([]);
      setRooms([]);
      setRoomsLoading(true);
      setRoomsBadge(0);
      setAlertsBadge(0);
      setRoster([]);
      setCanManageRooms(false);
      workspaceRef.current = live[0]; setWorkspace(live[0]);
      mergedRef.current = ids; setMerged(ids);
    } catch (e) { if (alive.current && current === generation.current) setError(e instanceof Error ? e.message : "Unable to switch workspace."); throw e; }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [storageKey, mergeKey]);

  const selectWorkspace = useCallback((next: Workspace) => openWorkspaces([next]), [openWorkspaces]);

  const executeRefresh = useCallback(async (conversationIds?: string[]) => {
    const selected = workspaceRef.current;
    if (!selected) return;
    const current = generation.current, sequence = ++request.current;
    try {
      const ids = mergedRef.current.length > 0 ? mergedRef.current : [selected.businessId];
      const data = await api<{ conversations: InboxConversation[]; member: Member; permissions?: Record<string, string | boolean>; removedConversationIds?: string[] }>(`/api/mobile/bootstrap?workspaceIds=${encodeURIComponent(ids.join(","))}${conversationIds ? `&conversationIds=${encodeURIComponent(conversationIds.join(","))}` : ""}`, selected.businessId);
      if (!alive.current || current !== generation.current || sequence !== request.current) return;
      setConversations(previous => {
        if (!conversationIds) return data.conversations;
        const updates = new Map(data.conversations.map(row => [row.id, row]));
        const removed = new Set(data.removedConversationIds ?? []);
        return [...previous.filter(row => !removed.has(row.id) && !updates.has(row.id)), ...updates.values()]
          .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) || Date.parse(b.last_message_at ?? "1970-01-01") - Date.parse(a.last_message_at ?? "1970-01-01"));
      }); setMember(data.member); setPermissions(data.permissions ?? {}); setError("");
    } catch (e) {
      if (!alive.current || current !== generation.current || sequence !== request.current) return;
      setError(e instanceof Error ? e.message : "Unable to load Inbox.");
      if (e instanceof ApiError && [401, 403].includes(e.status)) clear();
    } finally { if (alive.current && current === generation.current && sequence === request.current) setLoading(false); }
  }, [clear]);
  // Serialize full and targeted refreshes: a fast single-row response must
  // never cancel a slower initial full list and leave just one conversation.
  const refreshQueue = useRef(new SerialTaskQueue());
  const refresh = useCallback((ids?: string[]) => {
    const expectedGeneration = generation.current;
    const pending = refreshQueue.current.run(async () => {
      if (alive.current && expectedGeneration === generation.current) await executeRefresh(ids);
    });
    return pending;
  }, [executeRefresh]);
  const refreshAlerts = useCallback(async () => {
    const selected = workspaceRef.current;
    if (!selected) return;
    const current = generation.current;
    try {
      const [alerts, announcement] = await Promise.all([
        api<{ notifications: { is_read: boolean }[] }>("/api/team-notifications", selected.businessId),
        api<{ announcement: { id: string } | null }>("/api/system-announcements/current", selected.businessId).catch(() => ({ announcement: null })),
      ]);
      if (!alive.current || current !== generation.current) return;
      const unread = (alerts.notifications ?? []).filter(one => !one.is_read).length;
      // Due reminders are already materialized by /api/team-notifications.
      // Counting /api/reminders as well doubled the badge for every reminder.
      setAlertsBadge(unread + (announcement.announcement ? 1 : 0));
    } catch {
      // The tab draws no dot rather than taking the app down over a count.
    }
  }, []);

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
    setLoading(true); setRoomsLoading(true); void refresh(); void refreshRooms(); void refreshAlerts();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fullInbox = false, roomsDirty = false, threadDirty = false, flushing = false, disposed = false, subscribedOnce = false;
    const changedIds = new Set<string>();
    const changed = (kind: "inbox" | "rooms" | "conversation", id?: string) => {
      if (kind === "inbox") fullInbox = true;
      if (kind === "rooms") roomsDirty = true;
      if (kind === "conversation" && id && !fullInbox) changedIds.add(id);
      if (changedIds.size > 500) { fullInbox = true; changedIds.clear(); }
      // A continuous message stream must not postpone the refresh forever.
      if (!timer) timer = setTimeout(flush, 300);
    };
    async function flush() {
      timer = undefined;
      if (disposed || flushing || AppState.currentState !== "active") return;
      flushing = true;
      const all = fullInbox, rooms = roomsDirty, ids = [...changedIds];
      if (threadDirty) setRevision(v => v + 1);
      if (rooms) setRoomRevision(v => v + 1);
      threadDirty = false;
      fullInbox = false; roomsDirty = false; changedIds.clear();
      try {
        if (all) await refresh();
        else for (let i = 0; i < ids.length && !disposed; i += 50) await refresh(ids.slice(i, i + 50));
        if (rooms && !disposed) await refreshRooms();
      } finally {
        flushing = false;
        if (!disposed && (fullInbox || roomsDirty || changedIds.size)) timer = setTimeout(flush, 300);
      }
    }
    const resumed = AppState.addEventListener("change", state => {
      if (state === "active") { setRevision(v => v + 1); setRoomRevision(v => v + 1); changed("inbox"); changed("rooms"); }
    });
    const settingsChanged = () => {
      clearReadCache();
      threadDirty = true;
      setSettingsRevision(value => value + 1);
      changed("inbox");
    };
    /*
     * Every workspace in the merged list is listened to, not just the active
     * one: a message arriving in the other shop belongs in this list too, and
     * without its own filter it would sit there unread until the next pull.
     */
    const listening = merged.length > 0 ? merged : [workspace.businessId];
    let channel = supabase.channel(`tenh-mobile-${listening.join("-")}`);
    for (const id of listening)
      /*
       * team_chat_room_members is in here because being added to a private
       * room is a change to what this phone may see, and nothing else reports
       * it: the room's own row does not change, no message has arrived yet,
       * and the list would keep saying the room does not exist until somebody
       * happened to reopen the app. Removal is the same fact in reverse, and
       * matters more.
       */
      for (const table of ["messages", "conversations", "contacts", "team_chat_messages", "team_chat_rooms", "team_chat_room_members"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${id}` }, payload => {
        if (table === "messages") {
          threadDirty = true;
          const row = ((payload.new as { conversation_id?: string })?.conversation_id ? payload.new : payload.old) as { conversation_id?: string };
          if (row.conversation_id) changed("conversation", row.conversation_id);
          else changed("inbox");
          return;
        }
        if (table.startsWith("team_chat_")) { changed("rooms"); return; }
        if (table === "contacts") {
          threadDirty = true;
          const row = ((payload.new as { id?: string })?.id ? payload.new : payload.old) as { id?: string };
          for (const conversation of conversationSnapshot.current) {
            if (conversation.contact?.id === row.id) changed("conversation", conversation.id);
          }
          return;
        }
        const row = ((payload.new as { id?: string })?.id ? payload.new : payload.old) as { id?: string };
        if (typeof row.id === "string") changed("conversation", row.id);
      });
    /*
     * The alert tone, on the arrival itself rather than on the reload the
     * arrival triggers: `changed` is debounced and fires for edits, reads and
     * the agent's own sends, all of which would make a noise for nothing.
     */
    for (const id of listening)
      channel = channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `business_id=eq.${id}` }, payload => { if ((payload.new as { direction?: string } | null)?.direction === "incoming") alert.current(); });
    for (const id of listening)
      for (const table of ["social_accounts", "tags", "saved_replies", "saved_reply_categories"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${id}` }, settingsChanged);
    channel.subscribe(status => { setLive(status === "SUBSCRIBED"); if (status === "SUBSCRIBED") { if (subscribedOnce) { threadDirty = true; changed("inbox"); changed("rooms"); } subscribedOnce = true; } });
    return () => { disposed = true; clearTimeout(timer); resumed.remove(); void supabase.removeChannel(channel); setLive(false); };
  }, [workspace?.businessId, merged.join(","), refresh, refreshRooms, refreshAlerts]);

  /*
   * Workspace access and subscription state can be changed by an Owner or a
   * TENH administrator while this phone is open. The web listens without a
   * selected-workspace filter and polls as a fallback; mobile now does the
   * same, so a renamed, suspended, restored, added or removed workspace does
   * not stay stale just because it is not the one currently open.
   */
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearReadCache();
      clearTimeout(timer);
      timer = setTimeout(() => {
        setRevision(value => value + 1);
        setSettingsRevision(value => value + 1);
        setAlertsRevision(value => value + 1);
        void loadWorkspaces(true);
      }, 120);
    };
    let channel = supabase.channel(`tenh-mobile-workspaces-${session.user.id}`);
    for (const table of ["businesses", "business_subscriptions", "team_members"])
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, sync);
    channel.subscribe();
    const poll = setInterval(() => { if (AppState.currentState === "active") void loadWorkspaces(true); }, 60_000);
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") sync();
    });
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      listener.remove();
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadWorkspaces]);

  /*
   * Alerts are account-wide on the website: the API returns notifications
   * from every operational workspace the member can access. Subscribe by
   * membership id, not by the selected workspace, and keep a 30-second poll
   * for reminders and system announcements that are created server-side.
   */
  const notificationMembers = workspaces.map(one => one.memberId).sort().join("|");
  useEffect(() => {
    if (!session || !workspace) return;
    const memberIds = notificationMembers ? notificationMembers.split("|") : [];
    const updated = () => {
      if (AppState.currentState !== "active") return;
      setAlertsRevision(value => value + 1);
      void refreshAlerts();
    };
    const channels = memberIds.map(memberId =>
      supabase
        .channel(`tenh-mobile-alerts-${memberId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "team_notifications", filter: `recipient_member_id=eq.${memberId}` }, payload => {
          const row = payload.new as { is_read?: boolean; notification_type?: string } | null;
          if (payload.eventType === "INSERT" && row?.is_read === false && ["team_chat_mention", "conversation_reminder"].includes(row.notification_type ?? "")) alert.current();
          updated();
        })
        .subscribe(),
    );
    const poll = setInterval(updated, 60_000);
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") updated();
    });
    return () => {
      clearInterval(poll);
      listener.remove();
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [session?.user.id, workspace?.businessId, notificationMembers, refreshAlerts]);
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
  return <Context.Provider value={{ workspaces, workspace, member, conversations, permissions, loading, error, live, revision, roomRevision, settingsRevision, refresh, loadWorkspaces, selectWorkspace, merged, openWorkspaces, updateConversation, updateContactTags, rooms, roomsLoading, roomsBadge, alertsBadge, alertsRevision, refreshAlerts, roster, canManageRooms, refreshRooms }}>{children}</Context.Provider>;
}
