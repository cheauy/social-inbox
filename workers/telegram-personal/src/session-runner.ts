import type { KeyObject } from "node:crypto";
import {
  generateDatabaseKey,
  openSealed,
  sealAad,
  unwrapDatabaseKey,
  wrapDatabaseKey,
} from "./crypto.ts";
import {
  acquireDirectoryLock,
  ensureSessionDirectory,
  LockHeldError,
  removeSessionDirectory,
} from "./local-data.ts";
import { maskPhone, type Logger } from "./redact.ts";
import {
  isOpenLogin,
  isTerminal,
  type ClaimedSession,
  type Fence,
  type OpenLoginStatus,
  type SessionStatus,
  type Store,
} from "./store.ts";
import { tdErrorDetails, type TdClient, type TdClientFactory, type TdObject } from "./tdlib-port.ts";
import { listPrivateChats, loadHistory, mapMessage } from "./chats.ts";
import type { Command, SharedChat } from "./store.ts";
import { OperationTimeoutError, withTimeout } from "./timeout.ts";

export type RunnerConfig = {
  workerId: string;
  dataDir: string;
  kek: Buffer;
  sealPrivateKey: KeyObject;
  leaseTtlSeconds: number;
  renewEveryMs: number;
  pollMs: number;
  closeTimeoutMs: number;
  logoutTimeoutMs: number;
  loginStepTimeoutMs: number;
  reconnectGraceMs: number;
  /** How often a live session confirms with Telegram that it is still authorized. */
  authProbeMs: number;
};

/** "retry" asks the supervisor to back off before this session is claimed again. */
export type RunnerOutcome = "done" | "retry";

type Phase = "login" | "live" | "cleanup";

const UNSUPPORTED_LOGIN_STATES = new Set([
  "authorizationStateWaitEmailAddress",
  "authorizationStateWaitEmailCode",
  "authorizationStateWaitRegistration",
  "authorizationStateWaitPremiumPurchase",
]);

const KNOWN_LOGIN_ERRORS: Array<[RegExp, string]> = [
  [/PHONE_NUMBER_INVALID/, "PHONE_NUMBER_INVALID"],
  [/PHONE_NUMBER_BANNED/, "PHONE_NUMBER_BANNED"],
  [/PHONE_CODE_INVALID/, "PHONE_CODE_INVALID"],
  [/PHONE_CODE_EXPIRED/, "PHONE_CODE_EXPIRED"],
  [/PASSWORD_HASH_INVALID/, "PASSWORD_INVALID"],
  [/FLOOD|TOO MANY REQUESTS/, "FLOOD_WAIT"],
];

export function loginErrorCode(error: unknown): string {
  if (error instanceof OperationTimeoutError) return "LOGIN_STEP_TIMEOUT";
  const details = tdErrorDetails(error);
  if (!details) return "LOGIN_STEP_FAILED";
  const message = details.message.toUpperCase();
  if (details.code === 429) return "FLOOD_WAIT";
  for (const [pattern, code] of KNOWN_LOGIN_ERRORS) if (pattern.test(message)) return code;
  return "LOGIN_STEP_FAILED";
}

/**
 * Owns exactly one Telegram Personal session while this worker holds its
 * lease. TDLib updates and periodic ticks are applied one at a time through a
 * queue so database writes stay ordered; authorizationStateClosed is observed
 * synchronously so a queued task can wait for it without deadlocking.
 */
export class SessionRunner {
  readonly sessionId: string;
  private readonly session: ClaimedSession;
  private readonly fence: Fence;
  private readonly store: Store;
  private readonly factory: TdClientFactory;
  private readonly config: RunnerConfig;
  private readonly log: Logger;
  private readonly onDone: (sessionId: string, outcome: RunnerOutcome) => void;

  private phase: Phase = "login";
  private client: TdClient | null = null;
  private releaseLock: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();
  private renewTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastRenewOk = Date.now();
  private observedStatus: SessionStatus;
  private loginStatus: OpenLoginStatus = "connecting";
  private lastAuth: string | null = null;
  private closed = false;
  private closedWaiters: Array<() => void> = [];
  private connectionReady = false;
  private notReadySince: number | null = null;
  private lastAuthProbe = Date.now();
  // D1 chat state (in memory only; the database is the source of truth).
  private myUserId: number | null = null;
  private readonly sharedChats = new Map<string, SharedChat>();
  private sharesLoadedAt = 0;
  private sharesDirty = false;
  private readonly privateChats = new Map<number, boolean>();
  private readonly caughtUp = new Set<string>();
  // D2: sends Telegram accepted, by TDLib's temporary message id, until their outcome arrives.
  private readonly pendingSends = new Map<number, { commandId: string; payload: Record<string, unknown> }>();
  private lastStaleSweep = 0;
  private ending = false;
  private finished = false;

  constructor(options: {
    session: ClaimedSession;
    store: Store;
    factory: TdClientFactory;
    config: RunnerConfig;
    log: Logger;
    onDone: (sessionId: string, outcome: RunnerOutcome) => void;
  }) {
    this.session = options.session;
    this.sessionId = options.session.id;
    this.fence = { sessionId: options.session.id, workerId: options.config.workerId, epoch: options.session.epoch };
    this.store = options.store;
    this.factory = options.factory;
    this.config = options.config;
    this.log = options.log;
    this.onDone = options.onDone;
    this.observedStatus = options.session.status;
  }

  private logEvent(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
    this.log(level, event, { sessionId: this.sessionId, businessId: this.session.businessId, epoch: this.fence.epoch, ...fields });
  }

  private enqueue(task: () => Promise<void>) {
    this.queue = this.queue.then(async () => {
      if (this.finished) return;
      try {
        await task();
      } catch (error) {
        this.logEvent("error", "session_task_failed", { error });
      }
    });
    return this.queue;
  }

  // ---------------------------------------------------------------------------
  async start() {
    const { session } = this;
    const paths = ensureSessionDirectory(this.config.dataDir, session.id);
    try {
      this.releaseLock = acquireDirectoryLock(paths.lock, { workerId: this.config.workerId, epoch: session.epoch });
    } catch (error) {
      this.logEvent("warn", "session_directory_locked", { reason: error instanceof LockHeldError ? "held" : "error" });
      await this.store.releaseLease(this.fence, null).catch(() => false);
      return this.finish("retry");
    }

    if (isTerminal(session.status)) this.phase = "cleanup";
    else if (isOpenLogin(session.status)) this.phase = "login";
    else this.phase = "live";

    let key: Buffer;
    if (!session.dbKeyWrapped) {
      if (this.phase === "cleanup" || this.phase === "live") {
        // Nothing usable on disk without a key: remove it. A live session without
        // a key can only be repaired by signing in again.
        if (this.phase === "live") {
          await this.store.workerUpdate(this.fence, { status: "failed", last_error_code: "KEY_MISSING" });
        }
        return this.removeLocalAndFinish();
      }
      key = generateDatabaseKey();
      const stored = await this.store.workerUpdate(this.fence, {
        db_key_wrapped: wrapDatabaseKey(this.config.kek, session.id, key),
        local_state: "present",
      });
      if (!stored) {
        this.logEvent("warn", "session_key_not_stored");
        await this.store.releaseLease(this.fence, null).catch(() => false);
        return this.finish("retry");
      }
    } else {
      try {
        key = unwrapDatabaseKey(this.config.kek, session.id, session.dbKeyWrapped);
      } catch {
        // Never wipe sessions because of a key/config problem; an operator must fix the KEK.
        this.logEvent("error", "session_key_unwrap_failed");
        await this.store.releaseLease(this.fence, null).catch(() => false);
        return this.finish("retry");
      }
    }

    if (this.phase === "live" && session.status === "connected") {
      await this.store.workerUpdate(this.fence, { status: "reconnecting" });
      this.observedStatus = "reconnecting";
    }

    const client = this.factory.create({
      databaseDirectory: paths.database,
      filesDirectory: paths.files,
      databaseEncryptionKey: key.toString("base64"),
    });
    key.fill(0);
    this.client = client;
    client.onUpdate((update) => this.onUpdate(update));

    this.renewTimer = setInterval(() => void this.renew(), this.config.renewEveryMs);
    this.tickTimer = setInterval(() => this.poke(false), this.config.pollMs);
    this.logEvent("info", "session_started", { status: session.status });
    this.poke();
  }

  /**
   * Request an immediate reconciliation. External wake-ups (Postgres NOTIFY
   * after a share, cancel or lifecycle request) also refresh shared chats
   * right away; the periodic timer keeps the 5 s throttle.
   */
  poke(external = true) {
    if (this.finished || this.ending) return;
    if (external) this.sharesDirty = true;
    void this.enqueue(() => this.tick());
  }

  // ---------------------------------------------------------------------------
  private onUpdate(update: TdObject) {
    if (this.finished) return;
    if (update._ === "updateAuthorizationState") {
      const state = update.authorization_state as TdObject;
      this.lastAuth = state._;
      if (state._ === "authorizationStateClosed") {
        this.closed = true;
        for (const resolve of this.closedWaiters.splice(0)) resolve();
      }
      void this.enqueue(() => this.handleAuth(state));
    } else if (update._ === "updateConnectionState") {
      const name = (update.state as TdObject | undefined)?._ ?? "";
      void this.enqueue(() => this.handleConnection(name));
    } else if (update._ === "updateNewChat") {
      const chat = update.chat as TdObject | undefined;
      if (chat) this.privateChats.set(Number(chat.id), (chat.type as TdObject | undefined)?._ === "chatTypePrivate");
    } else if (update._ === "updateNewMessage") {
      const message = update.message as TdObject | undefined;
      if (message) void this.enqueue(() => this.handleNewMessage(message));
    } else if (update._ === "updateMessageSendSucceeded") {
      const message = update.message as TdObject | undefined;
      const tempId = Number(update.old_message_id);
      if (message) void this.enqueue(() => this.handleSendSucceeded(tempId, message));
    } else if (update._ === "updateMessageSendFailed") {
      const tempId = Number(update.old_message_id);
      const code = Number((update.error as TdObject | undefined)?.code);
      void this.enqueue(() => this.handleSendFailed(tempId, Number.isFinite(code) ? code : 0));
    }
    // Everything else is dropped unread. Message content is never logged.
  }

  private waitClosed(ms: number) {
    if (this.closed) return Promise.resolve(true);
    return withTimeout(new Promise<void>((resolve) => this.closedWaiters.push(resolve)), ms, "tdlib_close")
      .then(() => true, () => false);
  }

  private async invoke(request: TdObject, ms: number, operation: string) {
    if (!this.client) throw new Error("TDLib client not open.");
    return withTimeout(this.client.invoke(request), ms, operation);
  }

  /** Ends the TDLib instance. Returns true only if authorizationStateClosed was observed. */
  private async closeClient(mode: "close" | "destroy" | "logout"): Promise<boolean> {
    if (!this.client || this.closed) return this.closed || !this.client;
    const ms = mode === "logout" ? this.config.logoutTimeoutMs : this.config.closeTimeoutMs;
    try {
      if (mode === "close") {
        await withTimeout(this.client.close(), ms, "tdlib_close");
      } else {
        await this.invoke({ _: mode === "logout" ? "logOut" : "destroy" }, ms, mode);
      }
    } catch (error) {
      this.logEvent("warn", "session_close_request_failed", { reason: mode, error });
    }
    return this.waitClosed(ms);
  }

  // ---------------------------------------------------------------------------
  private async handleAuth(state: TdObject) {
    if (this.ending) return;
    const name = state._;

    if (this.phase === "cleanup") {
      if (name === "authorizationStateReady") return this.signOutAndRemove(null);
      if (name !== "authorizationStateWaitTdlibParameters" && name !== "authorizationStateClosing" && name !== "authorizationStateLoggingOut") {
        return this.destroyAndRemove(null);
      }
      return;
    }

    if (this.phase === "live") {
      if (name === "authorizationStateReady") {
        await this.invoke({ _: "setOption", name: "online", value: { _: "optionValueBoolean", value: false } }, this.config.loginStepTimeoutMs, "set_offline").catch(() => undefined);
        if (this.observedStatus === "disconnect_pending") return this.signOutAndRemove("disconnected");
        if (this.observedStatus === "pausing") return this.pause();
        if (this.connectionReady) await this.setLiveStatus("connected");
        await this.startChatSync();
        return;
      }
      if (name === "authorizationStateWaitPhoneNumber" || UNSUPPORTED_LOGIN_STATES.has(name) ||
          name === "authorizationStateWaitCode" || name === "authorizationStateWaitPassword" ||
          name === "authorizationStateWaitOtherDeviceConfirmation" ||
          name === "authorizationStateLoggingOut" || name === "authorizationStateClosed") {
        // Authorization disappeared without us asking: the session was terminated
        // from another device or by Telegram.
        if (this.observedStatus === "disconnect_pending") return this.destroyAndRemove("disconnected");
        return this.revoked();
      }
      return;
    }

    // phase === "login"
    switch (name) {
      case "authorizationStateWaitTdlibParameters":
        return;
      case "authorizationStateWaitPhoneNumber":
        if (this.session.loginMethod === "qr") {
          try {
            await this.invoke({ _: "requestQrCodeAuthentication", other_user_ids: [] }, this.config.loginStepTimeoutMs, "request_qr");
          } catch (error) {
            await this.loginProgress(this.loginStatus, { errorCode: loginErrorCode(error) });
          }
          return;
        }
        return this.loginProgress("waiting_phone");
      case "authorizationStateWaitOtherDeviceConfirmation":
        return this.loginProgress("waiting_qr", { qrLink: String(state.link ?? "") });
      case "authorizationStateWaitCode":
        return this.loginProgress("waiting_code");
      case "authorizationStateWaitPassword":
        return this.loginProgress("waiting_password", { passwordHint: typeof state.password_hint === "string" ? state.password_hint : null });
      case "authorizationStateReady":
        return this.completeLogin();
      case "authorizationStateClosed":
        if (!this.ending) {
          this.logEvent("warn", "session_closed_unexpectedly");
          await this.store.releaseLease(this.fence, "unclean").catch(() => false);
          this.finish("retry");
        }
        return;
      default:
        if (UNSUPPORTED_LOGIN_STATES.has(name)) {
          await this.store.workerUpdate(this.fence, { status: "failed", last_error_code: "UNSUPPORTED_AUTH_STEP" });
          return this.destroyAndRemove(null);
        }
    }
  }

  private async loginProgress(status: OpenLoginStatus, extra: { qrLink?: string; passwordHint?: string | null; errorCode?: string } = {}) {
    const accepted = await this.store.loginUpdate(this.fence, { status, qrLink: extra.qrLink ?? null, passwordHint: extra.passwordHint ?? null, errorCode: extra.errorCode ?? null });
    if (accepted) {
      this.loginStatus = status;
      this.observedStatus = status;
      return;
    }
    // Late update for a login that was cancelled/expired, or the lease is gone.
    await this.tick();
  }

  private async completeLogin() {
    let identity;
    try {
      const me = await this.invoke({ _: "getMe" }, this.config.loginStepTimeoutMs, "get_me");
      const usernames = (me.usernames as { active_usernames?: string[] } | undefined)?.active_usernames ?? [];
      identity = {
        telegramUserId: String(me.id),
        displayName: [me.first_name, me.last_name].filter((part) => typeof part === "string" && part.trim()).join(" ").trim() || "Telegram user",
        username: usernames[0] ?? null,
        phoneMasked: maskPhone(typeof me.phone_number === "string" ? me.phone_number : null),
      };
    } catch (error) {
      this.logEvent("warn", "session_identity_unavailable", { error });
      // The owner cancelled (or the login expired) while Telegram authorized the
      // device: sign it out now rather than leaving it to a later retry.
      const status = await this.store.readStatus(this.sessionId).catch(() => null);
      if (status && !isOpenLogin(status)) return this.signOutAndRemove(null);
      // Authorized at Telegram but identity unknown: retry on the next claim.
      await this.closeClient("close");
      await this.store.releaseLease(this.fence, this.closed ? "clean" : "unclean").catch(() => false);
      return this.finish("retry");
    }

    const result = await this.store.activate(this.fence, identity);
    if (result.ok) {
      this.phase = "live";
      this.observedStatus = "connected";
      this.myUserId = Number(identity.telegramUserId);
      await this.invoke({ _: "setOption", name: "online", value: { _: "optionValueBoolean", value: false } }, this.config.loginStepTimeoutMs, "set_offline").catch(() => undefined);
      this.logEvent("info", "session_connected");
      await this.startChatSync();
      return;
    }
    if (result.code === "LEASE_LOST") return this.lostLease();
    // Telegram authorized this device but TENH refused it (duplicate owner,
    // capacity, cancelled meanwhile...). Sign it out so no orphan device remains.
    this.logEvent("warn", "session_activation_refused", { errorCode: result.code ?? "UNKNOWN" });
    return this.signOutAndRemove(null);
  }

  private async handleConnection(name: string) {
    this.connectionReady = name === "connectionStateReady";
    if (this.connectionReady) this.notReadySince = null;
    else this.notReadySince ??= Date.now();
    if (this.phase === "live" && this.lastAuth === "authorizationStateReady" && this.connectionReady) {
      await this.setLiveStatus("connected");
    }
  }

  private async setLiveStatus(status: "connected" | "reconnecting") {
    if (this.observedStatus === status || (this.observedStatus !== "connected" && this.observedStatus !== "reconnecting")) return;
    if (await this.store.workerUpdate(this.fence, { status })) {
      this.observedStatus = status;
      this.logEvent("info", status === "connected" ? "session_ready" : "session_reconnecting");
    }
  }

  // ---------------------------------------------------------------------------
  private async tick() {
    if (this.finished || this.ending) return;
    const status = await this.store.readStatus(this.sessionId);
    if (status === null) return this.sessionDeleted();
    this.observedStatus = status;

    if (this.phase === "login") {
      if (!status || !isOpenLogin(status)) return this.endLogin();
      const { input, deadlineAt } = await this.store.takeLoginInput(this.fence);
      if (deadlineAt && deadlineAt.getTime() <= Date.now()) {
        await this.store.workerUpdate(this.fence, { status: "expired", last_error_code: "LOGIN_EXPIRED" });
        return this.endLogin();
      }
      if (input) await this.applyLoginInput(input.kind, input.sealed);
      return;
    }

    if (this.phase === "live") {
      if (status === "pausing" && this.lastAuth) return this.pause();
      if (status === "disconnect_pending" && this.lastAuth) {
        return this.lastAuth === "authorizationStateReady" ? this.signOutAndRemove("disconnected") : this.destroyAndRemove("disconnected");
      }
      if (status && isTerminal(status)) return this.destroyAndRemove(null);
      if (this.observedStatus === "connected" && this.notReadySince !== null &&
          Date.now() - this.notReadySince >= this.config.reconnectGraceMs) {
        await this.setLiveStatus("reconnecting");
      }
      if (this.lastAuth === "authorizationStateReady" && this.connectionReady &&
          Date.now() - this.lastAuthProbe >= this.config.authProbeMs) {
        await this.probeAuthorization();
      }
      if (this.lastAuth === "authorizationStateReady" && !this.ending) {
        await this.refreshSharedChats(false);
        await this.processChatCommands();
        await this.sweepStaleSends();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // D1: shared chats and incoming messages

  private async startChatSync() {
    if (this.myUserId === null) {
      const me = await this.invoke({ _: "getMe" }, this.config.loginStepTimeoutMs, "get_me").catch(() => null);
      if (me) this.myUserId = Number(me.id);
    }
    await this.refreshSharedChats(true);
  }

  /** Reloads the shared chat list (at most every 5 s) and catches up newly shared or restarted chats. */
  private async refreshSharedChats(force: boolean) {
    if (!force && !this.sharesDirty && Date.now() - this.sharesLoadedAt < 5000) return;
    this.sharesLoadedAt = Date.now();
    this.sharesDirty = false;
    let chats: SharedChat[];
    try {
      chats = await this.store.sharedChats(this.fence);
    } catch (error) {
      this.logEvent("warn", "chat_shares_unavailable", { error });
      return;
    }
    this.sharedChats.clear();
    for (const chat of chats) this.sharedChats.set(chat.chatId, chat);
    for (const chat of chats) {
      if (this.caughtUp.has(chat.chatId) || this.ending) continue;
      this.caughtUp.add(chat.chatId);
      // Messages that arrived while this worker was not running. Idempotent.
      // Only messages after the share (or the last stored one): history "none" stays none.
      const after = [chat.lastMessageAt, chat.sharedAt].filter((v): v is string => Boolean(v)).sort().pop() ?? null;
      await this.importHistory(chat.chatId, 20, "catch_up", after);
    }
  }

  private async isPrivateChat(chatId: number) {
    const known = this.privateChats.get(chatId);
    if (known !== undefined) return known;
    try {
      const chat = await this.invoke({ _: "getChat", chat_id: chatId }, this.config.loginStepTimeoutMs, "get_chat");
      const isPrivate = (chat.type as TdObject | undefined)?._ === "chatTypePrivate";
      this.privateChats.set(chatId, isPrivate);
      return isPrivate;
    } catch {
      return false;
    }
  }

  private async handleNewMessage(message: TdObject) {
    if (this.phase !== "live" || this.ending) return;
    const row = mapMessage(message);
    if (!row) return;
    const chatId = Number(row.chatId);
    if (chatId === this.myUserId || !(await this.isPrivateChat(chatId))) return; // Saved Messages, groups, channels
    // Outgoing messages in unshared chats are not even counted.
    if (row.direction === "outgoing" && !this.sharedChats.has(row.chatId)) return;
    const { result } = await this.store.ingestMessage(this.fence, { ...row, countUnread: true });
    if (result === "LEASE_LOST") return this.lostLease();
  }

  private async importHistory(chatId: string, limit: number, reason: string, after: string | null = null) {
    // Telegram dates are whole seconds: compare from the start of that second.
    const cutoff = after ? Math.floor(Date.parse(after) / 1000) * 1000 : null;
    let messages: TdObject[];
    try {
      messages = await loadHistory((request, operation) => this.invoke(request, this.config.loginStepTimeoutMs, operation), chatId, limit);
    } catch (error) {
      this.logEvent("warn", "chat_history_failed", { reason, errorCode: tdErrorDetails(error)?.code ?? "timeout" });
      return false;
    }
    let inserted = 0;
    for (const message of messages) {
      const row = mapMessage(message);
      if (!row || row.chatId !== chatId) continue;
      if (cutoff !== null && Date.parse(row.sentAt) < cutoff) continue;
      // Catch-up messages are new to TENH; an explicit history import is not unread.
      const { result } = await this.store.ingestMessage(this.fence, { ...row, countUnread: reason !== "import" });
      if (result === "LEASE_LOST") {
        await this.lostLease();
        return false;
      }
      if (result === "INSERTED") inserted += 1;
    }
    this.logEvent("info", "chat_history_synced", { reason, count: inserted });
    return true;
  }

  private async processChatCommands() {
    let commands: Command[];
    try {
      commands = await this.store.claimCommands(this.fence, 5);
    } catch {
      return;
    }
    for (const command of commands) {
      if (this.ending) return;
      if (command.kind === "list_chats") {
        try {
          const chats = await listPrivateChats((request, operation) => this.invoke(request, this.config.loginStepTimeoutMs, operation), this.myUserId);
          await this.store.finishCommandResult(this.fence, command.id, "done", null, { chats });
          this.logEvent("info", "chat_list_ready", { count: chats.length });
        } catch (error) {
          await this.store.finishCommandResult(this.fence, command.id, "failed", error instanceof OperationTimeoutError ? "TELEGRAM_TIMEOUT" : "CHAT_LIST_FAILED", null);
        }
      } else if (command.kind === "import_history") {
        const chatId = String(command.payload?.chat_id ?? "");
        const limit = Math.min(50, Math.max(1, Number(command.payload?.limit) || 50));
        await this.refreshSharedChats(true);
        if (!/^-?[0-9]{1,20}$/.test(chatId) || !this.sharedChats.has(chatId)) {
          await this.store.finishCommandResult(this.fence, command.id, "failed", "CHAT_NOT_SHARED", null);
          continue;
        }
        const ok = await this.importHistory(chatId, limit, "import");
        await this.store.finishCommandResult(this.fence, command.id, ok ? "done" : "failed", ok ? null : "HISTORY_IMPORT_FAILED", null);
      } else if (command.kind === "send_text") {
        await this.sendText(command);
      }
      // pause/logout are driven by the session status and finished there.
    }
  }

  // ---------------------------------------------------------------------------
  // D2: replies from TENH. A send is attempted at most once: it is marked
  // "sending" before Telegram is called and a sending command is never claimed
  // again. When the outcome is unknown it becomes "uncertain", never retried.

  private async sendText(command: Command) {
    const payload = command.payload ?? {};
    const chatId = String(payload.chat_id ?? "");
    const text = typeof payload.text === "string" ? payload.text : "";
    await this.refreshSharedChats(true);
    if (!/^-?[0-9]{1,20}$/.test(chatId) || !this.sharedChats.has(chatId)) {
      await this.store.sendFail(this.fence, command.id, "failed", "CHAT_NOT_SHARED");
      return;
    }
    if (!text.trim() || text.length > 4096) {
      await this.store.sendFail(this.fence, command.id, "failed", "INVALID_TEXT");
      return;
    }
    if (!(await this.store.sendBegin(this.fence, command.id))) return; // lease lost or already in flight

    let sent: TdObject;
    try {
      sent = await this.invoke({
        _: "sendMessage",
        chat_id: Number(chatId),
        input_message_content: { _: "inputMessageText", text: { _: "formattedText", text }, clear_draft: false },
      }, this.config.loginStepTimeoutMs, "send_message");
    } catch (error) {
      const details = tdErrorDetails(error);
      // A 4xx answer means TDLib refused the request: nothing was sent. Anything
      // else (timeout, aborted request) leaves the outcome unknown.
      if (details && details.code >= 400 && details.code < 500) {
        await this.store.sendFail(this.fence, command.id, "failed", `TELEGRAM_${details.code}`);
      } else {
        await this.store.sendFail(this.fence, command.id, "uncertain", error instanceof OperationTimeoutError ? "TELEGRAM_TIMEOUT" : "OUTCOME_UNKNOWN");
      }
      this.logEvent("warn", "send_not_confirmed", { errorCode: details?.code ?? "timeout" });
      return;
    }
    const tempId = Number(sent.id);
    if (!Number.isSafeInteger(tempId)) {
      await this.store.sendFail(this.fence, command.id, "uncertain", "OUTCOME_UNKNOWN");
      return;
    }
    if ((sent.sending_state as TdObject | undefined)?._ === "messageSendingStateFailed") {
      await this.store.sendAccepted(this.fence, command.id, tempId);
      await this.store.sendFinish(this.fence, tempId, "failed", "TELEGRAM_REJECTED", null);
      return;
    }
    this.pendingSends.set(tempId, { commandId: command.id, payload });
    await this.store.sendAccepted(this.fence, command.id, tempId);
    if (!sent.sending_state) {
      // Already final (no temporary message): record it now.
      await this.handleSendSucceeded(tempId, sent);
    }
  }

  private async handleSendSucceeded(tempId: number, message: TdObject) {
    if (this.phase !== "live") return;
    const pending = this.pendingSends.get(tempId);
    this.pendingSends.delete(tempId);
    const row = mapMessage({ ...message, sending_state: undefined });
    if (pending && row) {
      const outcome = await this.store.ingestMessage(this.fence, {
        ...row,
        countUnread: false,
        clientRequestId: typeof pending.payload.client_request_id === "string" ? pending.payload.client_request_id : null,
        sentByMember: typeof pending.payload.member_id === "string" ? pending.payload.member_id : null,
      });
      if (outcome.result === "LEASE_LOST") return this.lostLease();
      await this.store.sendFinish(this.fence, tempId, "done", null, outcome.messageId);
      this.logEvent("info", "send_confirmed", {});
      return;
    }
    // After a restart (or a send that earlier timed out) the command is found by its temporary id.
    const finished = await this.store.sendFinish(this.fence, tempId, "done", null, null);
    if (!row) return;
    const { result } = await this.store.ingestMessage(this.fence, {
      ...row,
      countUnread: false,
      clientRequestId: typeof finished?.payload.client_request_id === "string" ? finished.payload.client_request_id : null,
      sentByMember: typeof finished?.payload.member_id === "string" ? finished.payload.member_id : null,
    });
    if (result === "LEASE_LOST") return this.lostLease();
  }

  private async handleSendFailed(tempId: number, code: number) {
    if (this.phase !== "live") return;
    this.pendingSends.delete(tempId);
    await this.store.sendFinish(this.fence, tempId, "failed", code ? `TELEGRAM_${code}` : "TELEGRAM_REJECTED", null);
    this.logEvent("warn", "send_failed", { errorCode: code || "unknown" });
  }

  /** Sends without an outcome for two minutes become "uncertain"; the holder checks Telegram. */
  private async sweepStaleSends() {
    if (Date.now() - this.lastStaleSweep < 60_000) return;
    this.lastStaleSweep = Date.now();
    try {
      const count = await this.store.sendMarkStale(this.fence, 120);
      if (count) this.logEvent("warn", "send_outcome_unknown", { count });
    } catch {
      // Retried on the next sweep.
    }
  }

  /**
   * An idle TDLib session only learns that it was terminated from another
   * device (Settings -> Devices) on its next server request. This small
   * authorized request makes that happen within authProbeMs. Network errors
   * are ignored; only an authorization error (401) means the session is gone.
   */
  private async probeAuthorization() {
    this.lastAuthProbe = Date.now();
    try {
      await this.invoke({ _: "getActiveSessions" }, this.config.loginStepTimeoutMs, "auth_probe");
    } catch (error) {
      if (tdErrorDetails(error)?.code === 401 && !this.ending) {
        await this.revoked();
      }
    }
  }

  private async applyLoginInput(kind: "phone" | "code" | "password", sealed: string) {
    let value: string;
    try {
      value = openSealed(this.config.sealPrivateKey, sealAad(this.sessionId, kind), sealed);
    } catch {
      return this.loginProgress(this.loginStatus, { errorCode: "LOGIN_INPUT_REJECTED" });
    }
    if (`waiting_${kind}` !== this.loginStatus) return this.loginProgress(this.loginStatus, { errorCode: "LOGIN_INPUT_UNEXPECTED" });

    const request: TdObject =
      kind === "phone" ? { _: "setAuthenticationPhoneNumber", phone_number: value, settings: null }
        : kind === "code" ? { _: "checkAuthenticationCode", code: value }
          : { _: "checkAuthenticationPassword", password: value };
    if (kind === "phone" && !/^\+?[0-9][0-9 ]{6,19}$/.test(value)) {
      return this.loginProgress(this.loginStatus, { errorCode: "PHONE_NUMBER_INVALID" });
    }
    try {
      await this.invoke(request, this.config.loginStepTimeoutMs, `login_${kind}`);
      // Success arrives as a new authorization state.
    } catch (error) {
      const errorCode = loginErrorCode(error);
      this.logEvent("warn", "login_step_failed", { errorCode });
      await this.loginProgress(this.loginStatus, { errorCode });
    } finally {
      value = "";
    }
  }

  // ---------------------------------------------------------------------------
  private async endLogin() {
    // If Telegram already authorized this device, sign it out instead of only
    // dropping local data, so no orphan device stays on the account.
    if (this.lastAuth === "authorizationStateReady") return this.signOutAndRemove(null);
    return this.destroyAndRemove(null);
  }

  private async pause() {
    this.ending = true;
    const clean = await this.closeClient("close");
    const ok = await this.store.workerUpdate(this.fence, { status: "paused" });
    await this.finishCommands(ok ? "done" : "failed", ok ? null : "PAUSE_NOT_RECORDED");
    await this.store.releaseLease(this.fence, clean ? "clean" : "unclean").catch(() => false);
    this.logEvent("info", "session_paused", { reason: clean ? "clean" : "unclean" });
    this.finish(ok ? "done" : "retry");
  }

  private async revoked() {
    this.ending = true;
    this.logEvent("warn", "session_revoked");
    await this.store.workerUpdate(this.fence, { status: "revoked", last_error_code: "SESSION_REVOKED" });
    await this.closeClient("destroy");
    return this.removeLocalAndFinish();
  }

  /** logOut at Telegram (revokes the device), then remove local data. */
  private async signOutAndRemove(finalStatus: "disconnected" | null) {
    this.ending = true;
    const confirmed = await this.closeClient("logout");
    if (!confirmed) {
      // Outcome unknown. Keep local data so a later attempt can sign out again.
      this.logEvent("warn", "session_logout_unconfirmed");
      await this.store.workerUpdate(this.fence, { last_error_code: "LOGOUT_UNCONFIRMED" });
      await this.finishCommands("failed", "LOGOUT_UNCONFIRMED");
      await this.store.releaseLease(this.fence, "unclean").catch(() => false);
      return this.finish("retry");
    }
    if (finalStatus) await this.store.workerUpdate(this.fence, { status: finalStatus, last_error_code: null });
    await this.finishCommands("done", null);
    return this.removeLocalAndFinish();
  }

  /** destroy without logOut: only for sessions that are not (or no longer) authorized. */
  private async destroyAndRemove(finalStatus: "disconnected" | null) {
    this.ending = true;
    await this.closeClient("destroy");
    if (finalStatus) await this.store.workerUpdate(this.fence, { status: finalStatus });
    await this.finishCommands("done", null);
    return this.removeLocalAndFinish();
  }

  private async removeLocalAndFinish() {
    this.ending = true;
    if (this.client && !this.closed) await this.closeClient("close");
    removeSessionDirectory(this.config.dataDir, this.sessionId);
    await this.store.workerUpdate(this.fence, { local_state: "removed", db_key_wrapped: null });
    await this.store.releaseLease(this.fence, this.closed || !this.client ? "clean" : "unclean").catch(() => false);
    this.logEvent("info", "session_local_data_removed");
    this.finish("done");
  }

  private async finishCommands(status: "done" | "failed", errorCode: string | null) {
    const commands = await this.store.claimCommands(this.fence, 20).catch(() => []);
    for (const command of commands) await this.store.finishCommand(this.fence, command.id, status, errorCode).catch(() => false);
  }

  // ---------------------------------------------------------------------------
  private async renew() {
    if (this.finished) return;
    let ok: boolean | null = null;
    try {
      ok = await this.store.renewLease(this.fence, this.config.leaseTtlSeconds);
    } catch {
      ok = null;
    }
    if (ok) {
      this.lastRenewOk = Date.now();
      return;
    }
    const safety = Math.min(5000, Math.floor(this.config.leaseTtlSeconds * 1000 / 3));
    if (ok === false || Date.now() - this.lastRenewOk >= this.config.leaseTtlSeconds * 1000 - safety) {
      await this.lostLease();
    }
  }

  /** Another worker may now own the session: stop touching it immediately. */
  private async lostLease() {
    if (this.finished) return;
    this.ending = true;
    this.stopTimers();
    const status = await this.store.readStatus(this.sessionId).catch(() => undefined);
    if (status === null) return this.sessionDeleted();
    this.logEvent("warn", "session_lease_lost");
    await this.closeClient("close");
    this.finish("retry");
  }

  /**
   * The session row is gone (workspace or account deleted). Nothing else will
   * ever clean up, so sign the device out at Telegram and wipe local files.
   */
  private async sessionDeleted() {
    this.ending = true;
    this.stopTimers();
    const confirmed = this.lastAuth === "authorizationStateReady" ? await this.closeClient("logout") : await this.closeClient("destroy");
    if (confirmed) removeSessionDirectory(this.config.dataDir, this.sessionId);
    this.logEvent(confirmed ? "info" : "error", "session_row_deleted", { reason: confirmed ? "signed_out_and_removed" : "logout_unconfirmed_files_kept" });
    this.finish("done");
  }

  /** Graceful shutdown. Reports clean only when TDLib confirmed authorizationStateClosed. */
  async stop(): Promise<"clean" | "unclean"> {
    if (this.finished) return "clean";
    this.ending = true;
    this.stopTimers();
    await withTimeout(this.queue, this.config.closeTimeoutMs, "drain_queue").catch(() => undefined);
    if (this.finished) return "clean";
    const clean = await this.closeClient("close");
    const outcome = clean ? "clean" : "unclean";
    await this.store.releaseLease(this.fence, outcome).catch(() => false);
    this.logEvent(clean ? "info" : "warn", "session_stopped", { reason: outcome });
    this.finish("retry");
    return outcome;
  }

  private stopTimers() {
    if (this.renewTimer) clearInterval(this.renewTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.renewTimer = null;
    this.tickTimer = null;
  }

  private finish(outcome: RunnerOutcome) {
    if (this.finished) return;
    this.finished = true;
    this.stopTimers();
    this.releaseLock?.();
    this.releaseLock = null;
    this.onDone(this.sessionId, outcome);
  }
}
