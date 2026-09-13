import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { facebookGraphJsonWithTokenRecovery } from "@/lib/facebook/facebook-connection-health";
import { processFacebookMessage } from "@/lib/facebook/process-message";
import { facebookRecoveryDay } from "@/lib/facebook/recovery-day";
import type { FacebookAttachment } from "@/types/facebook";

export const TODAY_CONVERSATION_BATCH = 20;
export const TODAY_MESSAGE_BATCH = 50;
const MAX_CALLS = 6;
const PASS_MS = 45_000;
const LEASE_MS = 180_000;
const TABLE = "facebook_today_recovery";
type Thread = { id: string; customerId: string };
type Cursor = { version: 1; pageId: string; dayStart: number; until: number; runKey: string;
  after: string | null; more: boolean; queue: Thread[]; active: (Thread & { after: string | null }) | null; done: boolean };
type Paging = { next?: unknown; cursors?: { after?: unknown } };
type Message = { id?: string; created_time?: string; from?: { id?: string }; to?: { data?: { id?: string }[] };
  message?: string; attachments?: { data?: unknown[] } };
type List = { data?: Array<{ id?: string; updated_time?: string; participants?: { data?: { id?: string }[]; paging?: Paging } }>;
  paging?: Paging; error?: { code?: number; message?: string }; [key: string]: unknown };
type Messages = { data?: Message[]; paging?: Paging; error?: { code?: number; message?: string }; [key: string]: unknown };
const safeId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(id);
const customerId = (id: unknown): id is string => typeof id === "string" && /^\d{1,32}$/.test(id);
const validAfter = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length > 0 && value.length <= 4000);
const validThread = (value: unknown): value is Thread => Boolean(value && typeof value === "object" && safeId((value as Thread).id) && customerId((value as Thread).customerId));
const dateMs = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;
function nextCursor(paging?: Paging) {
  if (!paging?.next) return null;
  const after = paging.cursors?.after;
  if (!validAfter(after) || after === null) throw new Error("Meta pagination is incomplete; the batch will retry.");
  return after; // Never follow paging.next URLs, which may carry credentials.
}
function savedCursor(value: unknown, pageId: string, start: number, runKey: string, now: number): Cursor | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Cursor;
  if (c.version !== 1 || c.pageId !== pageId || c.dayStart !== start || c.runKey !== runKey ||
      !Number.isFinite(c.until) || c.until < start || c.until > now || !validAfter(c.after) || typeof c.more !== "boolean" || typeof c.done !== "boolean" ||
      !Array.isArray(c.queue) || c.queue.length > TODAY_CONVERSATION_BATCH || !c.queue.every(validThread) ||
      (c.active !== null && (!validThread(c.active) || !validAfter(c.active.after)))) return null;
  return structuredClone(c);
}

/** One bounded reconnect batch. Later background runs resume its checkpoint. */
export async function recoverFacebookToday({ pageId, socialAccountId, accessToken, normalizeAttachment }: {
  pageId: string; socialAccountId: string; accessToken: string;
  normalizeAttachment: (value: unknown) => FacebookAttachment | null;
}) {
  const result = { candidates: 0, recovered: 0, failed: 0, truncated: true, accessToken, tokenRepaired: false };
  let lease: string | null = null;
  const deadline = Date.now() + PASS_MS;
  try {
    const { data: account, error: accountError } = await supabaseAdmin.from("social_accounts")
      .select("id,business_id,platform,platform_account_id,is_active,facebook_backfill_requested_at")
      .eq("id", socialAccountId).eq("platform", "facebook").eq("platform_account_id", pageId).eq("is_active", true).maybeSingle();
    if (accountError || !account) throw new Error("The connected Page could not be verified for recovery.");
    const { error: initError } = await supabaseAdmin.from(TABLE).upsert({ social_account_id: socialAccountId }, { onConflict: "social_account_id", ignoreDuplicates: true });
    if (initError) throw new Error("Apply the Facebook today-recovery database migration before importing.");
    const leaseId = randomUUID(), now = Date.now();
    const { data: row, error: claimError } = await supabaseAdmin.from(TABLE)
      .update({ lease_id: leaseId, lease_until: new Date(now + LEASE_MS).toISOString() })
      .eq("social_account_id", socialAccountId).or(`lease_until.is.null,lease_until.lt.${new Date(now).toISOString()}`)
      .select("cursor").maybeSingle();
    if (claimError) throw new Error("Unable to claim the Page recovery batch.");
    if (!row) return result; // Another OAuth/watchdog worker owns this Page.
    lease = leaseId;
    const day = facebookRecoveryDay(now), runKey = account.facebook_backfill_requested_at || String(day.startMs);
    const state: Cursor = savedCursor(row.cursor, pageId, day.startMs, runKey, now) ?? {
      version: 1, pageId, dayStart: day.startMs, until: day.endMs, runKey, after: null,
      more: true, queue: [], active: null, done: false,
    } satisfies Cursor;
    async function checkpoint() {
      state.done = !state.active && state.queue.length === 0 && !state.more;
      const { data, error } = await supabaseAdmin.from(TABLE).update({ cursor: state,
        lease_until: new Date(Date.now() + LEASE_MS).toISOString(), updated_at: new Date().toISOString() })
        .eq("social_account_id", socialAccountId).eq("lease_id", leaseId).select("social_account_id").maybeSingle();
      if (error || !data) throw new Error("Unable to checkpoint this recovery batch.");
    }
    await checkpoint();
    let calls = 0, inspected = 0;
    while (!state.done && result.recovered < TODAY_MESSAGE_BATCH && inspected < TODAY_CONVERSATION_BATCH && calls < MAX_CALLS && Date.now() < deadline) {
      if (!state.active && state.queue.length === 0) {
        calls++;
        const response = await facebookGraphJsonWithTokenRecovery<List>({ pageId, accessToken: result.accessToken,
          path: `${encodeURIComponent(pageId)}/conversations`, params: { platform: "MESSENGER", fields: "id,updated_time,participants",
            limit: TODAY_CONVERSATION_BATCH, ...(state.after ? { after: state.after } : {}) } });
        result.accessToken = response.accessToken; result.tokenRepaired ||= response.tokenRepaired;
        if (!response.ok || !Array.isArray(response.payload.data)) throw new Error("Unable to fetch today's Messenger conversations.");
        const rows = response.payload.data;
        if (rows.length > TODAY_CONVERSATION_BATCH) throw new Error("Meta exceeded the conversation batch limit.");
        const after = nextCursor(response.payload.paging);
        if (after !== null && after === state.after) throw new Error("Meta returned a repeated conversation cursor.");
        let reachedOlder = false;
        state.queue = rows.flatMap(thread => {
          if (dateMs(thread.updated_time) < state.dayStart) { reachedOlder = true; return []; }
          const parties = thread.participants?.data;
          if (!safeId(thread.id) || !Array.isArray(parties) || thread.participants?.paging?.next) return [];
          const ids = [...new Set(parties.map(party => party.id))];
          const other = ids.find(id => id !== pageId);
          return ids.length === 2 && ids.includes(pageId) && customerId(other) ? [{ id: thread.id, customerId: other }] : [];
        });
        // The conversations edge is scanned newest-first. Stop when reaching
        // older activity; never walk all historical conversation pages.
        state.after = after;
        state.more = Boolean(after) && !reachedOlder && rows.length > 0;
        await checkpoint();
        if (state.done) break;
      }
      if (!state.active && state.queue.length) {
        state.active = { ...state.queue.shift()!, after: null };
        await checkpoint();
      }
      if (!state.active || calls >= MAX_CALLS) continue;
      const active = state.active;
      const limit = TODAY_MESSAGE_BATCH - result.recovered;
      const params = { fields: "id,created_time,from,to,message,attachments", limit, ...(active.after ? { after: active.after } : {}) };
      calls++;
      let response = await facebookGraphJsonWithTokenRecovery<Messages>({ pageId, accessToken: result.accessToken, path: `${encodeURIComponent(active.id)}/messages`, params });
      result.accessToken = response.accessToken; result.tokenRepaired ||= response.tokenRepaired;
      if (!response.ok && response.payload.error?.code === 100 && calls < MAX_CALLS && Date.now() < deadline) {
        calls++;
        response = await facebookGraphJsonWithTokenRecovery<Messages>({ pageId, accessToken: result.accessToken, path: `${encodeURIComponent(active.id)}/messages`,
          params: { ...params, fields: "id,created_time,from,to,message" } });
        result.accessToken = response.accessToken; result.tokenRepaired ||= response.tokenRepaired;
      }
      if (!response.ok || !Array.isArray(response.payload.data)) throw new Error("Unable to fetch today's Messenger messages.");
      const messages = response.payload.data;
      if (messages.length > limit) throw new Error("Meta exceeded the message batch limit.");
      const after = nextCursor(response.payload.paging);
      if (after !== null && after === active.after) throw new Error("Meta returned a repeated message cursor.");
      const recent = messages.filter(message => safeId(message.id) && Number.isFinite(dateMs(message.created_time)) &&
        dateMs(message.created_time) >= state.dayStart && dateMs(message.created_time) <= state.until);
      const { data: existing, error: existingError } = recent.length ? await supabaseAdmin.from("messages")
        .select("platform_message_id,conversation:conversations!inner(social_account_id)")
        .eq("conversation.social_account_id", socialAccountId).in("platform_message_id", recent.map(message => message.id!)) : { data: [], error: null };
      if (existingError) throw new Error("Unable to compare already imported messages.");
      const known = new Set((existing ?? []).map(message => message.platform_message_id));
      for (const message of recent) {
        if (known.has(message.id!)) continue;
        if (Date.now() >= deadline) { await checkpoint(); return result; } // Retry this same page, skipping committed IDs.
        const from = message.from?.id, to = message.to?.data?.map(person => person.id) ?? [];
        const echo = from === pageId;
        if (!(echo ? to.length === 1 && to[0] === active.customerId : from === active.customerId && to.length === 1 && to[0] === pageId)) continue;
        const attachments = (message.attachments?.data ?? []).map(normalizeAttachment).filter((item): item is FacebookAttachment => item !== null);
        result.candidates++;
        await processFacebookMessage({ sender: { id: from! }, recipient: { id: echo ? active.customerId : pageId }, timestamp: dateMs(message.created_time),
          message: { mid: message.id!, is_echo: echo, text: message.message || (attachments.length ? undefined : "[Recovered Messenger message]"),
            attachments: attachments.length ? attachments : undefined } });
        known.add(message.id!); result.recovered++;
      }
      const reachedOlder = messages.some(message => dateMs(message.created_time) < state.dayStart);
      if (after && !reachedOlder && messages.length > 0) active.after = after;
      else { state.active = null; inspected++; }
      await checkpoint();
    }
    result.truncated = !state.done;
  } catch (error) {
    result.failed++;
    console.warn("[TENH Facebook Recovery] Today batch will retry:", error instanceof Error ? error.message : "Unknown error");
  } finally {
    if (lease) {
      const { error } = await supabaseAdmin.from(TABLE).update({ lease_id: null, lease_until: null })
        .eq("social_account_id", socialAccountId).eq("lease_id", lease);
      if (error) console.warn("[TENH Facebook Recovery] The Page recovery lease will expire automatically.");
    }
  }
  return result;
}
