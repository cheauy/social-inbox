import { SerialTaskQueue } from "./serial-task-queue";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, ApiError, authSessionGeneration } from "./api/client";
import { clearReadCache } from "./api/read-cache";
import { readInboxCache, writeInboxCache, clearInboxCache } from "./inbox-cache";
import { useAuth } from "./auth/provider";
import { sessionStorage } from "./auth/secure-storage";
import { useNotificationSound } from "./notification-sound";
import { supabase } from "./supabase/client";
import type { InboxConversation, Member, Workspace } from "./types";

type InboxState = {
  workspaces: Workspace[]; workspace: Workspace | null; member: Member | null;
  conversations: InboxConversation[]; loading: boolean; error: string; live: boolean; revision: number; settingsRevision: number;
  threadUpdates: { refresh: number; all: number; byId: Record<string, number> };

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
  loadMore: () => Promise<void>; hasMore: boolean; loadingMore: boolean;

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
};
const Context = createContext<InboxState | null>(null);
export const useInbox = () => { const value = useContext(Context); if (!value) throw new Error("Inbox provider missing"); return value; };
export function InboxProvider({ children }: React.PropsWithChildren) {
  const { session } = useAuth();
  const authGeneration = authSessionGeneration();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [merged, setMerged] = useState<string[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [permissions, setPermissions] = useState<Record<string, string | boolean>>({});
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextOffset = useRef(0);
  const morePending = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [revision, setRevision] = useState(0);
  const [threadUpdates, setThreadUpdates] = useState({ refresh: 0, all: 0, byId: {} as Record<string, number> });
  const publishThreads = useCallback((ids?: string[], invalidation = true) => {
    if (ids && !ids.length) return;
    setRevision(value => value + 1);
    setThreadUpdates(previous => {
      if (!invalidation) return { ...previous, refresh: previous.refresh + 1 };
      if (!ids) return { ...previous, all: previous.all + 1, byId: {} };
      const byId = { ...previous.byId };
      for (const id of ids) byId[id] = (byId[id] ?? 0) + 1;
      // An unknown/high-volume stream falls back to one global invalidation.
      return Object.keys(byId).length > 500 ? { ...previous, all: previous.all + 1, byId: {} } : { ...previous, byId };
    });
  }, []);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [alertsBadge, setAlertsBadge] = useState(0);
  const [alertsRevision, setAlertsRevision] = useState(0);
  const generation = useRef(0), request = useRef(0), alive = useRef(true);
  const userRef = useRef(session?.user.id);
  userRef.current = session?.user.id;
  const [selectionRevision, setSelectionRevision] = useState(0);
  const refreshQueue = useRef(new SerialTaskQueue());
  const refreshControllers = useRef(new Set<AbortController>());
  const initialQueued = useRef<number | null>(null);
  const selectionWrites = useRef<Promise<unknown>>(Promise.resolve());
  const selectionAttempt = useRef(0);
  const switchControllers = useRef(new Set<AbortController>());
  const retireSelections = useCallback(() => {
    selectionAttempt.current++;
    for (const controller of switchControllers.current) controller.abort();
    switchControllers.current.clear();
    return selectionAttempt.current;
  }, []);
  const retireRefreshes = useCallback(() => {
    generation.current++;
    // A retired transport may ignore abort or still be restoring its session.
    // Its queue must never hold up the newly accepted workspace.
    refreshQueue.current = new SerialTaskQueue();
    initialQueued.current = null;
    for (const controller of refreshControllers.current) controller.abort();
    refreshControllers.current.clear();
    morePending.current = null;
    return generation.current;
  }, []);
  const liveRef = useRef(false);
  const reconcilePending = useRef<string[]>([]);
  const alertsRequest = useRef(0);
  /*
   * Held in a ref so the realtime subscription does not have to be torn down
   * and rebuilt every time somebody changes their alert tone.
   */
  const { play, enabled: soundOn } = useNotificationSound();
  const alert = useRef(() => {});
  // Shared across channel recreation and workspace changes, capped at 1024 arrivals.
  const alertHistory = useRef(new Map<string, true>());
  alert.current = () => { if (soundOn) play(); };
  const workspaceRef = useRef<Workspace | null>(null);
  const mergedRef = useRef<string[]>([]);
  const workspaceOwner = useCallback(() => JSON.stringify([
    userRef.current, workspaceRef.current?.businessId, workspaceRef.current?.memberId,
    [...(mergedRef.current.length ? mergedRef.current : workspaceRef.current ? [workspaceRef.current.businessId] : [])].sort(),
  ]), []);
  const storageKey = `workspace.${session?.user.id}`;
  const mergeKey = `merged.${session?.user.id}`;
  useEffect(() => {
    // React Strict Mode runs setup, cleanup, setup in development. Resetting
    // this flag in setup keeps the second mount alive instead of making every
    // completed request look as though the provider was unmounted.
    alive.current = true;
    return () => { alive.current = false; retireSelections(); retireRefreshes(); };
  }, [retireRefreshes, retireSelections]);
  const clear = useCallback(() => { clearReadCache(); retireSelections(); retireRefreshes(); setLoadingMore(false); reconcilePending.current = []; liveRef.current = false; nextOffset.current = 0; setHasMore(false); workspaceRef.current = null; setWorkspace(null); mergedRef.current = []; setMerged([]); setMember(null); setPermissions({}); setConversations([]); setAlertsBadge(0); setLoading(false); }, [retireRefreshes, retireSelections]);
  useEffect(() => { clear(); setWorkspaces([]); setError(""); }, [session?.user.id, clear]);
  const conversationSnapshot = useRef(conversations);
  conversationSnapshot.current = conversations;
  const onboardingRef = useRef<{ userId: string; request: Promise<unknown> } | null>(null);
  const loadWorkspaces = useCallback(async (quiet = false) => {
    if (!session) {
      onboardingRef.current = null;
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
      // Native sign-in bypasses the website callback. Use the same protected,
      // idempotent onboarding endpoint before listing a new user's workspace.
      if (onboardingRef.current?.userId !== session.user.id) {
        onboardingRef.current = {
          userId: session.user.id,
          request: api("/api/onboarding/ensure-workspace", null, { method: "POST" }),
        };
      }
      const onboarding = onboardingRef.current;
      try { await onboarding.request; }
      catch (error) {
        if (onboardingRef.current === onboarding) onboardingRef.current = null;
        throw error;
      }
      if (!alive.current || current !== generation.current) return;
      const data = await api<{ workspaces: Workspace[] }>("/api/workspaces", workspaceRef.current?.businessId);
      if (!alive.current || current !== generation.current) return;
      // A cached preview is usable only under the same live membership.
      const memberships = new Map(data.workspaces.filter(row => row.subscriptionOperational).map(row => [row.businessId, row.memberId]));
      clearReadCache(key => {
        const [user, business, resource, membership] = JSON.parse(key) as string[];
        return user === session.user.id && Boolean(membership) && resource.startsWith("/api/conversations/") && memberships.get(business) !== membership;
      });
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
    } catch (e) { if (!(e instanceof ApiError && e.retiredAuthSession) && alive.current && current === generation.current) { setError(e instanceof Error ? e.message : "Unable to load workspaces."); if (e instanceof ApiError && [401, 403].includes(e.status)) { clear(); void clearInboxCache(); } } }
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
    const userId = session?.user.id;
    if (!userId) return;
    const attempt = retireSelections();
    const controller = new AbortController();
    switchControllers.current.add(controller);
    const ownsSelection = () => alive.current && attempt === selectionAttempt.current && userRef.current === userId && !controller.signal.aborted;
    let accepted = false;
    setLoadingMore(false); setLoading(true); setError("");
    try {
      const ids = live.map(one => one.businessId);
      /*
       * Keep the current workspace visible until the server accepts the new
       * one. Clearing first turned a temporary network failure into an empty
       * app, while the website correctly leaves the previous workspace open.
       */
      await api("/api/workspaces/switch", live[0].businessId, {
        method: "POST",
        body: { businessId: live[0].businessId }, expectedUserId: userId, signal: controller.signal,
      });
      if (!ownsSelection()) return;
      // Native writes cannot be cancelled. Keep their final saved selection in
      // the same order as accepted ownership, including rapid A -> B -> A.
      const persisted = selectionWrites.current.catch(() => {}).then(async () => {
        if (!ownsSelection()) return;
        await Promise.all([
          sessionStorage.setItem(storageKey, live[0].businessId),
          sessionStorage.setItem(mergeKey, ids.join(",")),
        ]);
      });
      selectionWrites.current = persisted.catch(() => {});
      await persisted;
      if (!ownsSelection()) return;

      // Reads may have started for the previous workspace while this switch
      // awaited transport or native storage. Retire them at COMMIT, before
      // publishing destination refs, so none can share its queue/ownership.
      retireRefreshes();
      setLoadingMore(false);
      // Apply the accepted switch as one state transition so no row from the
      // previous workspace is briefly shown under the new workspace name.
      setMember(null);
      setPermissions({});
      reconcilePending.current = [];
      setConversations([]);
      nextOffset.current = 0; setHasMore(false);

      setAlertsBadge(0);

      workspaceRef.current = live[0]; setWorkspace(live[0]);
      mergedRef.current = ids; setMerged(ids);
      accepted = true;
      // IDs can be identical when the chooser reopens the saved workspace.
      // Acceptance, rather than an ID change, must trigger its first load.
      setSelectionRevision(value => value + 1);
    } catch (e) {
      if (!(e instanceof ApiError && e.retiredAuthSession) && ownsSelection()) {
        setError(e instanceof Error ? e.message : "Unable to switch workspace.");
        if (e instanceof ApiError && [401, 403].includes(e.status)) { clear(); void clearInboxCache(); }
      }
      throw e;
    } finally {
      if (!accepted && ownsSelection()) setLoading(false);
      switchControllers.current.delete(controller);
    }
  }, [storageKey, mergeKey, session?.user.id, retireSelections, retireRefreshes, clear]);

  const selectWorkspace = useCallback((next: Workspace) => openWorkspaces([next]), [openWorkspaces]);

  const executeRefresh = useCallback(async (conversationIds?: string[]) => {
    const selected = workspaceRef.current;
    if (!selected || AppState.currentState !== "active") return false;
    const current = generation.current, sequence = ++request.current;
    if (!conversationIds && initialQueued.current === current) initialQueued.current = null;
    const userId = session?.user.id;
    const owner = workspaceOwner();
    const controller = new AbortController();
    refreshControllers.current.add(controller);
    let networkFinished = false;
    try {
      const ids = mergedRef.current.length > 0 ? mergedRef.current : [selected.businessId];
      if (!conversationIds && session?.user.id && conversationSnapshot.current.length === 0) {
        void readInboxCache(session.user.id, ids).then(rows => {
          if (rows && !networkFinished && !controller.signal.aborted && AppState.currentState === "active" && alive.current && current === generation.current && userRef.current === userId && owner === workspaceOwner() && sequence === request.current) {
            setConversations(rows); setLoading(false);
          }
        });
      }
      const data = await api<{ conversations: InboxConversation[]; member: Member; permissions?: Record<string, string | boolean>; removedConversationIds?: string[]; hasMore?: boolean; nextOffset?: number }>(`/api/mobile/bootstrap?workspaceIds=${encodeURIComponent(ids.join(","))}${conversationIds ? `&conversationIds=${encodeURIComponent(conversationIds.join(","))}` : "&limit=30"}`, selected.businessId, { signal: controller.signal, expectedUserId: userId });
      networkFinished = true;
      if (controller.signal.aborted || !alive.current || current !== generation.current || userRef.current !== userId || owner !== workspaceOwner() || sequence !== request.current) return false;
      if (data.removedConversationIds?.length) {
        const removed = new Set(data.removedConversationIds.map(id => `/api/conversations/${encodeURIComponent(id)}/messages?limit=25`));
        clearReadCache(key => {
          const [user, , resource, membership] = JSON.parse(key) as string[];
          return user === session?.user.id && Boolean(membership) && removed.has(resource);
        });
      }
      if (!conversationIds) {
        nextOffset.current = data.nextOffset ?? data.conversations.length;
        setHasMore(Boolean(data.hasMore));
        if (session?.user.id) writeInboxCache(session.user.id, ids, data.conversations);
      }
      setConversations(previous => {
        const updates = new Map(data.conversations.map(row => [row.id, row]));
        const removed = new Set(data.removedConversationIds ?? []);
        return [...previous.filter(row => ids.includes(row.business_id) && !removed.has(row.id) && !updates.has(row.id)), ...updates.values()]
          .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) || Date.parse(b.last_message_at ?? "1970-01-01") - Date.parse(a.last_message_at ?? "1970-01-01"));
      }); setMember(data.member); setPermissions(data.permissions ?? {}); setError("");
      return true;
    } catch (e) {
      if ((e instanceof ApiError && e.retiredAuthSession) || controller.signal.aborted || !alive.current || current !== generation.current || userRef.current !== userId || owner !== workspaceOwner() || sequence !== request.current) return false;
      setError(e instanceof Error ? e.message : "Unable to load Inbox.");
      if (e instanceof ApiError && [401, 403].includes(e.status)) { clear(); void clearInboxCache(); }
      return false;
    } finally { refreshControllers.current.delete(controller); networkFinished = true; if (alive.current && current === generation.current && userRef.current === userId && owner === workspaceOwner() && sequence === request.current) setLoading(false); }
  }, [clear, session?.user.id, workspaceOwner]);
  // Serialize full and targeted refreshes: a fast single-row response must
  // never cancel a slower initial full list and leave just one conversation.
  const loadMore = useCallback(async () => {
    if (morePending.current === generation.current || !hasMore || AppState.currentState !== "active") return;
    const selected = workspaceRef.current;
    if (!selected) return;
    const current = generation.current;
    morePending.current = current; setLoadingMore(true);
    const userId = session?.user.id;
    const owner = workspaceOwner();
    let controller: AbortController | undefined;
    try {
      await refreshQueue.current.run(async () => {
        if (!alive.current || current !== generation.current || userRef.current !== userId || owner !== workspaceOwner() || AppState.currentState !== "active") return;
        controller = new AbortController(); refreshControllers.current.add(controller);
        const ids = mergedRef.current.length > 0 ? mergedRef.current : [selected.businessId];
        const data = await api<{ conversations: InboxConversation[]; hasMore: boolean; nextOffset: number }>(
          `/api/mobile/bootstrap?workspaceIds=${encodeURIComponent(ids.join(","))}&limit=30&offset=${nextOffset.current}`, selected.businessId, { signal: controller.signal, expectedUserId: userId });
        if (controller.signal.aborted || !alive.current || current !== generation.current || userRef.current !== userId || owner !== workspaceOwner()) return;
        setConversations(previous => [...new Map([...previous, ...data.conversations].map(row => [row.id, row])).values()]);
        nextOffset.current = data.nextOffset; setHasMore(data.hasMore);
      });
    } catch (e) {
      if (!(e instanceof ApiError && e.retiredAuthSession) && !controller?.signal.aborted && alive.current && current === generation.current && userRef.current === userId && owner === workspaceOwner()) {
        setError(e instanceof Error ? e.message : "Unable to load more conversations.");
        if (e instanceof ApiError && [401, 403].includes(e.status)) { clear(); void clearInboxCache(); }
      }
    } finally {
      if (controller) refreshControllers.current.delete(controller);
      if (morePending.current === current) { morePending.current = null; if (alive.current) setLoadingMore(false); }
    }
  }, [hasMore, clear, session?.user.id, workspaceOwner]);
  const refreshRows = useCallback(async (ids?: string[]) => {
    const expectedGeneration = generation.current;
    let succeeded = false;
    await refreshQueue.current.run(async () => {
      if (alive.current && expectedGeneration === generation.current) succeeded = await executeRefresh(ids);
    });
    return succeeded;
  }, [executeRefresh]);
  const refresh = useCallback(async () => { await refreshRows(); }, [refreshRows]);
  useEffect(() => {
    if (!session?.user.id || !workspace?.businessId) return;
    setLoading(true);
    // Startup/accepted selection is not a message burst. Load both the scoped
    // encrypted preview and fresh authorized page without the event debounce.
    if (AppState.currentState === "active") {
      const current = generation.current;
      initialQueued.current = current;
      void refreshRows().finally(() => { if (initialQueued.current === current) initialQueued.current = null; });
    }
  }, [session?.user.id, workspace?.businessId, merged.join(","), selectionRevision, refreshRows]);
  const refreshAlerts = useCallback(async () => {
    const selected = workspaceRef.current;
    if (!selected) return;
    const current = generation.current, sequence = ++alertsRequest.current;
    try {
      const [alerts, announcement] = await Promise.all([
        api<{ notifications: { is_read: boolean }[] }>("/api/team-notifications", selected.businessId),
        api<{ announcement: { id: string } | null }>("/api/system-announcements/current", selected.businessId).catch(() => ({ announcement: null })),
      ]);
      if (!alive.current || current !== generation.current || sequence !== alertsRequest.current) return;
      const unread = (alerts.notifications ?? []).filter(one => !one.is_read).length;
      // Due reminders are already materialized by /api/team-notifications.
      // Counting /api/reminders as well doubled the badge for every reminder.
      setAlertsBadge(unread + (announcement.announcement ? 1 : 0));
    } catch {
      // The tab draws no dot rather than taking the app down over a count.
    }
  }, []);

  useEffect(() => {
    if (!session?.user.id || !workspace?.businessId) return;
    setLoading(true); void refreshAlerts();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fullInbox = false, threadDirty = false, allThreads = false, flushing = false, disposed = false, failures = 0;
    const ownerGeneration = generation.current, owner = workspaceOwner();
    const ownsAlerts = () => !disposed && alive.current && generation.current === ownerGeneration &&
      workspaceOwner() === owner && authSessionGeneration() === authGeneration;
    const changedIds = new Set<string>();
    const threadIds = new Set<string>();
    const changed = (kind: "inbox" | "conversation", id?: string) => {
      if (kind === "inbox") fullInbox = true;
      if (kind === "conversation" && id && !fullInbox) changedIds.add(id);
      if (changedIds.size > 500) { fullInbox = true; changedIds.clear(); }
      // A continuous message stream must not postpone the refresh forever.
      if (!timer) timer = setTimeout(flush, 300);
    };
    async function flush() {
      timer = undefined;
      if (disposed || flushing || AppState.currentState !== "active") return;
      flushing = true;
      const all = fullInbox, ids = [...changedIds];
      const dirtyIds = [...threadIds], dirtyAll = allThreads;
      if (threadDirty) publishThreads(dirtyAll ? undefined : dirtyIds);
      allThreads = false; threadIds.clear();
      threadDirty = false;
      fullInbox = false; changedIds.clear();
      try {
        let succeeded = true;
        if (all) succeeded = await refreshRows();
        else for (let i = 0; i < ids.length && !disposed; i += 50) {
          if (!await refreshRows(ids.slice(i, i + 50))) { succeeded = false; break; }
        }
        if (!succeeded && !disposed) {
          fullInbox ||= all;
          for (const id of ids) changedIds.add(id);
          threadDirty = true;
          allThreads ||= dirtyAll;
          for (const id of dirtyIds) threadIds.add(id);
          failures++;
        } else failures = 0;
      } finally {
        flushing = false;
        if (!disposed && AppState.currentState === "active" && (fullInbox || changedIds.size)) {
          clearTimeout(timer);
          timer = setTimeout(flush, failures ? Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)) : 300);
        }
      }
    }
    const resumed = AppState.addEventListener("change", state => {
      if (state === "active") { publishThreads(undefined, false); changed("inbox"); }
      else {
        clearTimeout(timer); timer = undefined;
        for (const controller of refreshControllers.current) controller.abort();
      }
    });
    const settingsChanged = () => {
      clearReadCache();
      threadDirty = true;
      allThreads = true;
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
      for (const table of ["messages", "conversations", "contacts"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${id}` }, payload => {
        if (table === "messages") {
          threadDirty = true;
          const row = ((payload.new as { conversation_id?: string })?.conversation_id ? payload.new : payload.old) as { conversation_id?: string };
          if (row.conversation_id) {
            threadIds.add(row.conversation_id);
            if (threadIds.size > 500) { allThreads = true; threadIds.clear(); }
            changed("conversation", row.conversation_id);
          } else { allThreads = true; changed("inbox"); }
          return;
        }
        if (table === "contacts") {
          threadDirty = true;
          const row = ((payload.new as { id?: string })?.id ? payload.new : payload.old) as { id?: string };
          for (const conversation of conversationSnapshot.current) {
            if (conversation.contact?.id === row.id) { threadIds.add(conversation.id); changed("conversation", conversation.id); }
          }
          if (threadIds.size > 500) { allThreads = true; threadIds.clear(); }
          return;
        }
        const row = ((payload.new as { id?: string })?.id ? payload.new : payload.old) as { id?: string; source_type?: string };
        // Update the channel badge immediately; the bounded refresh below
        // still supplies the complete authorized conversation and counts.
        if (payload.eventType !== "DELETE" && (row.source_type === "comment" || row.source_type === "messenger")) {
          const source = row.source_type;
          setConversations(current => current.map(item => item.id === row.id ? { ...item, source_type: source } : item));
        }
        if (typeof row.id === "string") changed("conversation", row.id);
      });
    /*
     * The alert tone, on the arrival itself rather than on the reload the
     * arrival triggers: `changed` is debounced and fires for edits, reads and
     * the agent's own sends, all of which would make a noise for nothing.
     */
    for (const id of listening)
      channel = channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `business_id=eq.${id}` }, payload => {
        if (!ownsAlerts()) return;
        const row = payload.new as { id?: string; business_id?: string; direction?: string } | null;
        if (row?.direction !== "incoming" || row.business_id !== id || typeof row.id !== "string" || !row.id) return;
        const key = JSON.stringify([authGeneration, session.user.id, id, row.id]);
        if (alertHistory.current.has(key)) return;
        // Remember background/muted arrivals too, so their replay stays silent.
        alertHistory.current.set(key, true);
        if (alertHistory.current.size > 1024) alertHistory.current.delete(alertHistory.current.keys().next().value!);
        if (AppState.currentState === "active") alert.current();
      });
    for (const id of listening)
      for (const table of ["social_accounts", "tags", "saved_replies", "saved_reply_categories"]) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${id}` }, settingsChanged);
    channel.subscribe(status => {
      if (disposed) return;
      liveRef.current = status === "SUBSCRIBED";
      setLive(liveRef.current);
      if (status === "SUBSCRIBED") {
        publishThreads(undefined, false);
        // If the first read is still queued, it starts AFTER this join and
        // covers its gap. A read already started before join needs catchup.
        if (initialQueued.current !== generation.current) changed("inbox");
      }
    });
    return () => { disposed = true; clearTimeout(timer); resumed.remove(); void supabase.removeChannel(channel); liveRef.current = false; setLive(false); };
  }, [session?.user.id, authGeneration, workspace?.businessId, workspace?.memberId, merged.join(","), selectionRevision, refreshRows, refreshAlerts, publishThreads, workspaceOwner]);

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
    let disposed = false;
    let accessDirty = false;
    const sync = (invalidation = true) => {
      if (disposed) return;
      accessDirty ||= invalidation;
      if (invalidation) clearReadCache();
      clearTimeout(timer);
      if (AppState.currentState !== "active") return;
      timer = setTimeout(() => {
        if (disposed || AppState.currentState !== "active") return;
        const invalidate = accessDirty; accessDirty = false;
        publishThreads(undefined, invalidate);
        setSettingsRevision(value => value + 1);
        setAlertsRevision(value => value + 1);
        void loadWorkspaces(true);
      }, 120);
    };
    let channel = supabase.channel(`tenh-mobile-workspaces-${session.user.id}`);
    for (const table of ["businesses", "business_subscriptions", "team_members"])
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => sync());
    channel.subscribe();
    let reconciling = false;
    // Reuse the existing minute tick. contact_tags publication/RLS is unknown:
    // reconcile one rotating, protected batch rather than adding a raw listener.
    const poll = setInterval(() => {
      if (disposed || AppState.currentState !== "active" || reconciling) return;
      reconciling = true;
      void (async () => {
        const current = generation.current;
        try {
          await loadWorkspaces(true);
          if (disposed || !alive.current || current !== generation.current || AppState.currentState !== "active") return;
          const rows = conversationSnapshot.current;
          const known = new Set(rows.map(row => row.id));
          if (!reconcilePending.current.length) reconcilePending.current = [...known];
          const ids = reconcilePending.current.splice(0, 50).filter(id => known.has(id));
          if (await refreshRows(liveRef.current && ids.length ? ids : undefined)) {
            if (disposed || !alive.current || current !== generation.current || AppState.currentState !== "active") return;
            publishThreads(undefined, false);
            setSettingsRevision(value => value + 1);
          } else if (!disposed && current === generation.current) reconcilePending.current.unshift(...ids);
        } finally { reconciling = false; }
      })();
    }, 60_000);
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") sync(false);
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(poll);
      listener.remove();
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadWorkspaces, refreshRows, publishThreads]);

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
          if (row?.notification_type === "team_chat_mention") return;
          if (payload.eventType === "INSERT" && row?.is_read === false && row.notification_type === "conversation_reminder") alert.current();
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
  return <Context.Provider value={{ workspaces, workspace, member, conversations, permissions, loading, error, live, revision, threadUpdates, settingsRevision, refresh, loadMore, hasMore, loadingMore, loadWorkspaces, selectWorkspace, merged, openWorkspaces, updateConversation, updateContactTags, alertsBadge, alertsRevision, refreshAlerts }}>{children}</Context.Provider>;
}
