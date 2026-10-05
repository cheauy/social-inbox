import { randomUUID } from "node:crypto";
import type { LoginInputKind } from "../../src/crypto.ts";
import type { AutoShareResult, FinishedSend, IngestOutcome, IngestRow, SharedChat } from "../../src/store.ts";
import {
  isOpenLogin,
  isTerminal,
  type ClaimedSession,
  type Command,
  type Fence,
  type Identity,
  type LoginPatch,
  type SessionStatus,
  type Store,
  type WorkerPatch,
} from "../../src/store.ts";

type Row = {
  id: string;
  businessId: string;
  holder: string;
  status: SessionStatus;
  loginMethod: "qr" | "phone";
  dbKeyWrapped: string | null;
  localState: "none" | "present" | "removed";
  assignedWorker: string | null;
  leaseOwner: string | null;
  epoch: number;
  leaseExpires: number;
  lastShutdown: "clean" | "unclean" | null;
  lastErrorCode: string | null;
  telegramUserId: string | null;
  channelActive: boolean;
};

type Login = { qrLink: string | null; hint: string | null; inputKind: LoginInputKind | null; inputSealed: string | null; errorCode: string | null; deadline: number };

const LIVE_OWNED: SessionStatus[] = ["connected", "reconnecting", "pausing", "paused", "disconnect_pending"];

/**
 * In-memory mirror of the tgp_* RPC semantics (fencing, terminal finality,
 * open-login guards, duplicate ownership). The SQL itself is tested separately
 * in tests/sql and against PgStore in pg-store.integration.test.ts.
 */
export class MemoryStore implements Store {
  readonly rows = new Map<string, Row>();
  readonly logins = new Map<string, Login>();
  readonly commands: Array<{ id: string; sessionId: string; kind: Command["kind"]; status: string; payload?: Record<string, unknown>; result?: unknown; errorCode?: string | null; tempMessageId?: number; messageId?: string | null }> = [];

  /** What tgp_enqueue_action does (holder and message checks are tested in SQL). */
  enqueueAction(id: string, kind: "edit_text" | "delete_messages" | "typing", payload: Record<string, unknown>, messageId: string | null = null) {
    const command: MemoryStore["commands"][number] = { id: randomUUID(), sessionId: id, kind, status: "queued", payload, messageId };
    this.commands.push(command);
    this.wake?.(id);
    return command;
  }
  // D1 mirror: shares keyed by session id (one account per session here), messages and waiting chats.
  readonly shares = new Map<string, Map<string, { rowId: string; unshared: boolean; lastReadAt: number; lastMessageAt: string | null; sharedAt: string; preview: string | null; unread: number; title?: string }>>();
  readonly messages: Array<IngestRow & { sessionId: string; id: string; savedType?: string; attachment?: Record<string, unknown>; quoted?: number; edited?: boolean; deleted?: boolean; deletedBy?: string }> = [];
  readonly unshared = new Map<string, Set<string>>();
  ingestCalls = 0;
  readonly writes: Array<{ sessionId: string; op: string; accepted: boolean; patch?: unknown }> = [];
  channelLimit = new Map<string, number>();
  private wake: ((id: string) => void) | null = null;

  // ---- API-side helpers (what the Next.js routes do through RPCs) ----
  beginLogin(businessId: string, method: "qr" | "phone", ttlMs = 60_000, holder = "holder-1") {
    const id = randomUUID();
    this.rows.set(id, {
      id, businessId, holder, status: "connecting", loginMethod: method, dbKeyWrapped: null, localState: "none",
      assignedWorker: null, leaseOwner: null, epoch: 0, leaseExpires: 0, lastShutdown: null, lastErrorCode: null,
      telegramUserId: null, channelActive: false,
    });
    this.logins.set(id, { qrLink: null, hint: null, inputKind: null, inputSealed: null, errorCode: null, deadline: Date.now() + ttlMs });
    this.wake?.(id);
    return id;
  }

  submitInput(id: string, kind: LoginInputKind, sealed: string) {
    const row = this.rows.get(id);
    const login = this.logins.get(id);
    if (!row || !login || row.status !== `waiting_${kind}`) return false;
    login.inputKind = kind;
    login.inputSealed = sealed;
    this.wake?.(id);
    return true;
  }

  cancel(id: string) {
    const row = this.rows.get(id);
    if (!row || !isOpenLogin(row.status)) return false;
    row.status = "cancelled";
    this.logins.delete(id);
    this.wake?.(id);
    return true;
  }

  requestAction(id: string, kind: "pause" | "logout") {
    const row = this.rows.get(id) as Row;
    row.status = kind === "pause" ? "pausing" : "disconnect_pending";
    row.channelActive = false;
    this.commands.push({ id: randomUUID(), sessionId: id, kind, status: "queued" });
    this.wake?.(id);
  }

  requestChatList(id: string) {
    const command: MemoryStore["commands"][number] = { id: randomUUID(), sessionId: id, kind: "list_chats", status: "queued" };
    this.commands.push(command);
    this.wake?.(id);
    return command;
  }

  shareChat(id: string, chatId: string, history: "none" | "last_50" = "none") {
    const map = this.shares.get(id) ?? new Map();
    this.shares.set(id, map);
    const existing = map.get(chatId);
    const sharedAt = new Date().toISOString();
    map.set(chatId, existing ? { ...existing, unshared: false, sharedAt } : { rowId: randomUUID(), unshared: false, lastReadAt: Date.now(), lastMessageAt: null, sharedAt, preview: null, unread: 0 });
    this.unshared.get(id)?.delete(chatId);
    if (history === "last_50") this.commands.push({ id: randomUUID(), sessionId: id, kind: "import_history", status: "queued", payload: { chat_id: chatId, limit: 50 } });
    this.wake?.(id);
  }

  /** What tgp_enqueue_send does (holder, sharing and rate checks are tested in SQL). */
  enqueueSend(id: string, chatId: string, text: string, clientRequestId: string = randomUUID(), memberId = "member-1") {
    const command: MemoryStore["commands"][number] = {
      id: randomUUID(), sessionId: id, kind: "send_text", status: "queued",
      payload: { chat_id: chatId, text, member_id: memberId, client_request_id: clientRequestId },
    };
    this.commands.push(command);
    this.wake?.(id);
    return command;
  }

  /** What tgp_set_auto_share does (holder checks are tested in SQL). */
  readonly autoShare = new Set<string>();
  setAutoShare(id: string, enabled: boolean) {
    if (enabled) this.autoShare.add(id);
    else this.autoShare.delete(id);
    this.unshared.delete(id);
    this.wake?.(id);
  }

  unshareChat(id: string, chatId: string) {
    const share = this.shares.get(id)?.get(chatId);
    if (share) share.unshared = true;
  }

  expireLease(id: string) {
    (this.rows.get(id) as Row).leaseExpires = 0;
  }

  /** Simulates another worker taking over (newer epoch). */
  stealLease(id: string, otherWorker = "worker-other") {
    const row = this.rows.get(id) as Row;
    row.leaseOwner = otherWorker;
    row.epoch += 1;
    row.leaseExpires = Date.now() + 60_000;
  }

  // ---- Store ----
  private holds(f: Fence) {
    const row = this.rows.get(f.sessionId);
    return !!row && row.leaseOwner === f.workerId && row.epoch === f.epoch && row.leaseExpires > Date.now();
  }

  private record(sessionId: string, op: string, accepted: boolean, patch?: unknown) {
    this.writes.push({ sessionId, op, accepted, patch });
    return accepted;
  }

  async claimSessions(workerId: string, ttlSeconds: number, limit: number): Promise<ClaimedSession[]> {
    const out: ClaimedSession[] = [];
    for (const row of this.rows.values()) {
      if (out.length >= limit) break;
      if (row.assignedWorker && row.assignedWorker !== workerId) continue;
      if (row.leaseExpires > Date.now()) continue;
      const wanted = isOpenLogin(row.status) || ["connected", "reconnecting", "pausing", "disconnect_pending"].includes(row.status) ||
        (isTerminal(row.status) && row.localState === "present");
      if (!wanted) continue;
      row.leaseOwner = workerId;
      row.epoch += 1;
      row.leaseExpires = Date.now() + ttlSeconds * 1000;
      row.assignedWorker ??= workerId;
      out.push({ id: row.id, businessId: row.businessId, status: row.status, loginMethod: row.loginMethod, epoch: row.epoch, dbKeyWrapped: row.dbKeyWrapped, localState: row.localState });
    }
    return out;
  }

  async renewLease(f: Fence, ttlSeconds: number) {
    if (!this.holds(f)) return false;
    (this.rows.get(f.sessionId) as Row).leaseExpires = Date.now() + ttlSeconds * 1000;
    return true;
  }

  async releaseLease(f: Fence, shutdown: "clean" | "unclean" | null) {
    const row = this.rows.get(f.sessionId);
    if (!row || row.leaseOwner !== f.workerId || row.epoch !== f.epoch) return this.record(f.sessionId, "release", false);
    row.leaseOwner = null;
    row.leaseExpires = 0;
    if (shutdown) row.lastShutdown = shutdown;
    return this.record(f.sessionId, "release", true, shutdown);
  }

  async workerUpdate(f: Fence, patch: WorkerPatch) {
    if (!this.holds(f)) return this.record(f.sessionId, "update", false, patch);
    const row = this.rows.get(f.sessionId) as Row;
    const next = patch.status ?? row.status;
    if (next !== row.status) {
      if (isTerminal(row.status)) return this.record(f.sessionId, "update", false, patch);
      if ((row.status === "pausing" || row.status === "disconnect_pending") && !["paused", "disconnected", "revoked", "failed"].includes(next)) return this.record(f.sessionId, "update", false, patch);
      if (row.status === "paused" && !["revoked", "disconnected"].includes(next)) return this.record(f.sessionId, "update", false, patch);
      if ((next === "connected" || next === "reconnecting") && !["connected", "reconnecting"].includes(row.status)) return this.record(f.sessionId, "update", false, patch);
    }
    if (patch.db_key_wrapped && row.dbKeyWrapped) return this.record(f.sessionId, "update", false, patch);
    row.status = next;
    if ("last_error_code" in patch) row.lastErrorCode = patch.last_error_code ?? null;
    if (patch.local_state) row.localState = patch.local_state;
    if ("db_key_wrapped" in patch) row.dbKeyWrapped = patch.db_key_wrapped ?? null;
    if (isTerminal(next) || ["paused", "pausing", "disconnect_pending"].includes(next)) row.channelActive = false;
    if (isTerminal(next)) this.logins.delete(row.id);
    return this.record(f.sessionId, "update", true, patch);
  }

  async loginUpdate(f: Fence, patch: LoginPatch) {
    if (!this.holds(f)) return this.record(f.sessionId, "login", false, patch);
    const row = this.rows.get(f.sessionId) as Row;
    const login = this.logins.get(f.sessionId);
    if (!isOpenLogin(row.status) || !login) return this.record(f.sessionId, "login", false, patch);
    if (patch.status && !isOpenLogin(patch.status)) return this.record(f.sessionId, "login", false, patch);
    row.status = patch.status ?? row.status;
    row.lastErrorCode = patch.errorCode ?? null;
    login.qrLink = patch.status === "waiting_qr" ? patch.qrLink ?? null : null;
    login.hint = patch.status === "waiting_password" ? patch.passwordHint ?? null : null;
    login.errorCode = patch.errorCode ?? null;
    return this.record(f.sessionId, "login", true, patch);
  }

  async takeLoginInput(f: Fence) {
    const row = this.rows.get(f.sessionId);
    const login = this.logins.get(f.sessionId);
    if (!this.holds(f) || !row || !login || !isOpenLogin(row.status)) return { input: null, deadlineAt: null };
    const input = login.inputKind && login.inputSealed ? { kind: login.inputKind, sealed: login.inputSealed } : null;
    login.inputKind = null;
    login.inputSealed = null;
    return { input, deadlineAt: new Date(login.deadline) };
  }

  async readStatus(sessionId: string) {
    return this.rows.get(sessionId)?.status ?? null;
  }

  async activate(f: Fence, identity: Identity) {
    if (!this.holds(f)) return { ok: false, code: "LEASE_LOST" };
    const row = this.rows.get(f.sessionId) as Row;
    if (!isOpenLogin(row.status)) return { ok: false, code: "LOGIN_NOT_OPEN" };
    const other = [...this.rows.values()].find((o) => o.id !== row.id && o.telegramUserId === identity.telegramUserId && LIVE_OWNED.includes(o.status));
    let code: string | null = null;
    if (other) code = other.businessId === row.businessId ? "ACCOUNT_ALREADY_CONNECTED" : "ACCOUNT_IN_OTHER_WORKSPACE";
    const limit = this.channelLimit.get(row.businessId);
    const active = [...this.rows.values()].filter((o) => o.businessId === row.businessId && o.channelActive).length;
    if (!code && limit !== undefined && active + 1 > limit) code = "CHANNEL_LIMIT_REACHED";
    if (code) {
      row.status = "failed";
      row.lastErrorCode = code;
      this.logins.delete(row.id);
      return { ok: false, code };
    }
    row.status = "connected";
    row.telegramUserId = identity.telegramUserId;
    row.channelActive = true;
    this.logins.delete(row.id);
    this.writes.push({ sessionId: row.id, op: "activate", accepted: true, patch: identity });
    return { ok: true };
  }

  async claimCommands(f: Fence, limit: number): Promise<Command[]> {
    if (!this.holds(f)) return [];
    return this.commands.filter((c) => c.sessionId === f.sessionId && (c.status === "queued" || c.status === "claimed")).slice(0, limit)
      .map((c) => {
        c.status = "claimed";
        return { id: c.id, kind: c.kind, payload: c.payload ?? {}, messageId: c.messageId ?? null };
      });
  }

  async finishCommandResult(f: Fence, commandId: string, status: "done" | "failed", errorCode: string | null, result: unknown) {
    if (!this.holds(f)) return false;
    const command = this.commands.find((c) => c.id === commandId && c.status === "claimed");
    if (!command) return false;
    command.status = status;
    command.errorCode = errorCode;
    command.result = result;
    return true;
  }

  async sharedChats(f: Fence): Promise<SharedChat[]> {
    if (!this.holds(f)) return [];
    return [...(this.shares.get(f.sessionId)?.entries() ?? [])]
      .filter(([, share]) => !share.unshared)
      .map(([chatId, share]) => ({ chatId, rowId: share.rowId, lastMessageAt: share.lastMessageAt, sharedAt: share.sharedAt }));
  }

  async ingestMessage(f: Fence, row: IngestRow): Promise<IngestOutcome> {
    this.ingestCalls += 1;
    const none = (result: IngestOutcome["result"]): IngestOutcome => ({ result, messageId: null });
    if (!this.holds(f)) return none("LEASE_LOST");
    const session = this.rows.get(f.sessionId) as Row;
    if (!["connected", "reconnecting"].includes(session.status)) return none("NOT_LIVE");
    const share = this.shares.get(f.sessionId)?.get(row.chatId);
    if (!share || share.unshared) {
      if (row.direction === "incoming") {
        const set = this.unshared.get(f.sessionId) ?? new Set<string>();
        set.add(row.chatId);
        this.unshared.set(f.sessionId, set);
      }
      return none("NOT_SHARED");
    }
    const existing = this.messages.find((m) => m.sessionId === f.sessionId && m.chatId === row.chatId && m.messageId === row.messageId);
    if (existing) return { result: "DUPLICATE", messageId: existing.id };
    const id = randomUUID();
    this.messages.push({ ...row, sessionId: f.sessionId, id });
    if (!share.lastMessageAt || row.sentAt >= share.lastMessageAt) {
      share.lastMessageAt = row.sentAt;
      share.preview = row.body ?? `[${row.placeholder}]`;
    }
    if (row.direction === "incoming" && row.countUnread !== false) share.unread += 1;
    return { result: "INSERTED", messageId: id };
  }

  async autoShareChat(f: Fence, chatId: string, title: string): Promise<AutoShareResult> {
    if (!this.holds(f)) return "LEASE_LOST";
    if (!this.autoShare.has(f.sessionId)) return "OFF";
    const map = this.shares.get(f.sessionId) ?? new Map();
    this.shares.set(f.sessionId, map);
    const existing = map.get(chatId);
    if (existing) return existing.unshared ? "EXCLUDED" : "SHARED";
    map.set(chatId, { rowId: randomUUID(), unshared: false, lastReadAt: Date.now(), lastMessageAt: null, sharedAt: new Date().toISOString(), preview: null, unread: 0, title });
    this.unshared.get(f.sessionId)?.delete(chatId);
    return "SHARED";
  }

  // Media, replies, edits, deletions and profile photos (mirror of the 20261024 SQL).
  readonly contactPhotos = new Map<string, boolean>();
  async setMessageMedia(f: Fence, messageId: string, messageType: string, text: string, attachment: Record<string, unknown>) {
    if (!this.holds(f)) return false;
    const m = this.messages.find((x) => x.id === messageId && x.sessionId === f.sessionId);
    if (!m) return false;
    Object.assign(m, { savedType: messageType, body: text, attachment });
    return true;
  }
  async setMessageReply(f: Fence, messageId: string, chatId: string, replyTo: number) {
    if (!this.holds(f)) return false;
    const m = this.messages.find((x) => x.id === messageId && x.chatId === chatId);
    if (!m) return false;
    Object.assign(m, { quoted: replyTo });
    return true;
  }
  async editMessage(f: Fence, chatId: string, messageId: number, text: string) {
    if (!this.holds(f)) return "NOT_LIVE";
    const m = this.messages.find((x) => x.sessionId === f.sessionId && x.chatId === chatId && x.messageId === messageId);
    if (!m) return "NOT_FOUND";
    Object.assign(m, { body: text, edited: true });
    return "OK";
  }
  async deleteMessages(f: Fence, chatId: string, messageIds: number[]) {
    if (!this.holds(f)) return 0;
    let n = 0;
    for (const m of this.messages) {
      if (m.sessionId === f.sessionId && m.chatId === chatId && messageIds.includes(m.messageId) && !(m as { deleted?: boolean }).deleted) {
        Object.assign(m, { deleted: true, body: "Message deleted" });
        n += 1;
      }
    }
    return n;
  }
  async chatContact(f: Fence, chatId: string) {
    if (!this.holds(f)) return null;
    const share = this.shares.get(f.sessionId)?.get(chatId);
    return share && !share.unshared && this.messages.some((m) => m.sessionId === f.sessionId && m.chatId === chatId)
      ? { contactId: `contact-${chatId}`, businessId: (this.rows.get(f.sessionId) as Row).businessId } : null;
  }
  async markDeletedByMember(f: Fence, messageId: string, memberId: string) {
    if (!this.holds(f)) return false;
    const m = this.messages.find((x) => x.id === messageId && x.sessionId === f.sessionId);
    if (!m) return false;
    Object.assign(m, { deleted: true, body: "Message deleted", deletedBy: memberId });
    return true;
  }
  async setContactPhoto(f: Fence, chatId: string, hasPhoto: boolean) {
    if (!this.holds(f)) return false;
    this.contactPhotos.set(chatId, hasPhoto);
    return true;
  }

  async sendBegin(f: Fence, commandId: string) {
    if (!this.holds(f)) return false;
    const command = this.commands.find((c) => c.id === commandId && (c.kind === "send_text" || c.kind === "send_media") && c.status === "claimed");
    if (!command) return false;
    command.status = "sending";
    return true;
  }

  async sendAccepted(f: Fence, commandId: string, tempMessageId: number) {
    if (!this.holds(f)) return false;
    const command = this.commands.find((c) => c.id === commandId && (c.status === "sending" || c.status === "uncertain"));
    if (!command) return false;
    command.tempMessageId = tempMessageId;
    return true;
  }

  async sendFinish(f: Fence, tempMessageId: number, status: "done" | "failed", errorCode: string | null, messageId: string | null): Promise<FinishedSend | null> {
    if (!this.holds(f)) return null;
    const command = this.commands.find((c) => c.sessionId === f.sessionId && (c.kind === "send_text" || c.kind === "send_media") && c.tempMessageId === tempMessageId &&
      (c.status === "sending" || c.status === "uncertain"));
    if (!command) return null;
    command.status = status;
    command.errorCode = errorCode;
    command.messageId = messageId;
    return { commandId: command.id, payload: command.payload ?? {} };
  }

  async sendFail(f: Fence, commandId: string, status: "failed" | "uncertain", errorCode: string) {
    if (!this.holds(f)) return false;
    const command = this.commands.find((c) => c.id === commandId && (c.status === "claimed" || c.status === "sending"));
    if (!command) return false;
    command.status = status;
    command.errorCode = errorCode;
    return true;
  }

  staleSweeps = 0;
  async sendMarkStale(f: Fence) {
    if (!this.holds(f)) return 0;
    this.staleSweeps += 1;
    return 0;
  }

  async finishCommand(f: Fence, commandId: string, status: "done" | "failed", errorCode: string | null = null) {
    if (!this.holds(f)) return false;
    const command = this.commands.find((c) => c.id === commandId && c.status === "claimed");
    if (!command) return false;
    command.status = status;
    command.errorCode = errorCode;
    return true;
  }

  async listen(onWake: (sessionId: string) => void) {
    this.wake = onWake;
    return async () => {
      this.wake = null;
    };
  }
}
