import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TdRequestError, type TdClient, type TdClientFactory, type TdClientOptions, type TdObject } from "../../src/tdlib-port.ts";

/**
 * Offline stand-in for Telegram + TDLib. It keeps "server-side" authorization
 * per database directory so restarts, revocation and sign-out can be tested
 * without any network, account or credential.
 */
export type FakeUser = { id: number; firstName: string; phone: string; password?: string };

export class FakeTelegram implements TdClientFactory {
  readonly clients: FakeTdClient[] = [];
  readonly authorized = new Map<string, FakeUser>(); // databaseDirectory -> user
  readonly keys = new Map<string, string>(); // databaseDirectory -> encryption key
  readonly loggedOut: string[] = [];
  readonly destroyed: string[] = [];
  users = new Map<string, FakeUser>([["+85512345678", { id: 5550001, firstName: "Fake Owner", phone: "85512345678", password: "correct-horse" }]]);
  closeHangs = false;
  logoutHangs = false;
  invokeHangs = new Set<string>();
  eventDelayMs = 2;
  private qrCounter = 0;
  // Chats visible to every fake account: id -> chat; history newest first.
  chats = new Map<number, { title: string; type: "private" | "group"; userId?: number; userType?: string; username?: string; photoFileId?: number }>([
    [5001, { title: "Customer A", type: "private", userId: 5001, userType: "userTypeRegular", username: "cust_a" }],
    [5002, { title: "Customer B", type: "private", userId: 5002, userType: "userTypeRegular" }],
    [6001, { title: "Some Bot", type: "private", userId: 6001, userType: "userTypeBot" }],
    [777000, { title: "Telegram", type: "private", userId: 777000, userType: "userTypeRegular" }],
    [-100123, { title: "Team group", type: "group" }],
  ]);
  history = new Map<number, TdObject[]>();
  /**
   * D2. How Telegram treats the next sendMessage:
   *   succeed  accepted, then updateMessageSendSucceeded
   *   fail     accepted, then updateMessageSendFailed
   *   silent   accepted, but no outcome ever arrives
   *   reject   TDLib refuses the request (400): nothing sent
   */
  sendOutcome: "succeed" | "fail" | "silent" | "reject" = "succeed";
  /** Files on "Telegram's servers": id -> bytes. downloadFile writes them to fileDir. */
  readonly files = new Map<number, Uint8Array>();
  readonly fileDir = mkdtempSync(join(tmpdir(), "fake-tg-files-"));
  readonly deletedFiles: number[] = [];
  private fileCounter = 70_000;

  addFile(bytes: Uint8Array) {
    const id = ++this.fileCounter;
    this.files.set(id, bytes);
    return id;
  }

  static photoMessage(chatId: number, id: number, fileId: number, size: number, caption = "", options: { outgoing?: boolean; date?: number } = {}): TdObject {
    return {
      _: "message", id, chat_id: chatId, is_outgoing: options.outgoing === true, date: options.date ?? Math.floor(Date.now() / 1000),
      content: { _: "messagePhoto", caption: { _: "formattedText", text: caption },
        photo: { sizes: [{ type: "s", width: 90, height: 90, photo: { id: fileId + 100000, size: 10 } }, { type: "x", width: 800, height: 600, photo: { id: fileId, size } }] } },
    };
  }

  static documentMessage(chatId: number, id: number, fileId: number, size: number, name: string, options: { outgoing?: boolean; date?: number } = {}): TdObject {
    return {
      _: "message", id, chat_id: chatId, is_outgoing: options.outgoing === true, date: options.date ?? Math.floor(Date.now() / 1000),
      content: { _: "messageDocument", caption: { _: "formattedText", text: "" }, document: { file_name: name, mime_type: "application/pdf", document: { id: fileId, size } } },
    };
  }
  /** Every message Telegram actually delivered (to detect duplicate sends). */
  readonly delivered: Array<{ chatId: number; text: string; kind?: string; bytes?: number; replyTo?: number }> = [];
  private messageCounter = 9000;
  private tempCounter = 1_000_000;

  nextMessageId() {
    return ++this.messageCounter;
  }

  nextTempId() {
    return ++this.tempCounter;
  }

  static textMessage(chatId: number, id: number, text: string, options: { outgoing?: boolean; date?: number } = {}): TdObject {
    return { _: "message", id, chat_id: chatId, is_outgoing: options.outgoing === true, date: options.date ?? Math.floor(Date.now() / 1000), content: { _: "messageText", text: { _: "formattedText", text } } };
  }

  create(options: TdClientOptions): TdClient {
    const client = new FakeTdClient(this, options);
    this.clients.push(client);
    client.boot();
    return client;
  }

  clientFor(databaseDirectory: string) {
    return [...this.clients].reverse().find((client) => client.options.databaseDirectory === databaseDirectory);
  }

  nextQrLink() {
    this.qrCounter += 1;
    return `tg://login?token=FAKEQR${this.qrCounter}SECRET`;
  }
}

export class FakeTdClient implements TdClient {
  readonly options: TdClientOptions;
  readonly requests: TdObject[] = [];
  private readonly telegram: FakeTelegram;
  private listeners: Array<(update: TdObject) => void> = [];
  private closed = false;
  private pendingUser: FakeUser | null = null;
  authState = "none";

  constructor(telegram: FakeTelegram, options: TdClientOptions) {
    this.telegram = telegram;
    this.options = options;
  }

  boot() {
    const dir = this.options.databaseDirectory;
    const knownKey = this.telegram.keys.get(dir);
    this.later(() => {
      this.auth("authorizationStateWaitTdlibParameters");
      if (knownKey && knownKey !== this.options.databaseEncryptionKey) {
        // Wrong key: TDLib refuses to open the database.
        this.auth("authorizationStateClosed");
        return;
      }
      this.telegram.keys.set(dir, this.options.databaseEncryptionKey);
      if (this.telegram.authorized.has(dir)) {
        this.connection("connectionStateUpdating");
        this.auth("authorizationStateReady");
        this.connection("connectionStateReady");
      } else {
        this.auth("authorizationStateWaitPhoneNumber");
      }
    });
  }

  private later(fn: () => void) {
    setTimeout(() => {
      if (!this.closed) fn();
    }, this.telegram.eventDelayMs);
  }

  emit(update: TdObject) {
    for (const listener of this.listeners) listener(update);
  }

  auth(name: string, extra: Record<string, unknown> = {}) {
    this.authState = name;
    if (name === "authorizationStateClosed") this.closed = true;
    this.emit({ _: "updateAuthorizationState", authorization_state: { _: name, ...extra } });
  }

  connection(name: string) {
    this.emit({ _: "updateConnectionState", state: { _: name } });
  }

  /** Simulates the user scanning the QR code with their phone. */
  approveQr(user: FakeUser) {
    if (user.password) {
      this.pendingUser = user;
      this.auth("authorizationStateWaitPassword", { password_hint: "pet name", has_recovery_email_address: false });
    } else {
      this.authorize(user);
    }
  }

  authorize(user: FakeUser) {
    this.telegram.authorized.set(this.options.databaseDirectory, user);
    this.auth("authorizationStateReady");
    this.connection("connectionStateReady");
  }

  /** A message arrives (or is sent from the phone): stored in history and pushed as an update. */
  receive(message: TdObject) {
    const chatId = Number(message.chat_id);
    const list = this.telegram.history.get(chatId) ?? [];
    list.unshift(message);
    this.telegram.history.set(chatId, list);
    this.emit({ _: "updateNewMessage", message });
  }

  /** Terminated on Telegram's side, but TDLib has not noticed yet (idle session). */
  revokeSilently() {
    this.telegram.authorized.delete(this.options.databaseDirectory);
  }

  /** Session terminated from another device (Settings -> Devices). */
  revokeRemotely() {
    this.telegram.authorized.delete(this.options.databaseDirectory);
    this.auth("authorizationStateLoggingOut");
    this.auth("authorizationStateClosing");
    this.auth("authorizationStateClosed");
  }

  invoke(request: TdObject): Promise<TdObject> {
    this.requests.push(request);
    if (this.closed) return Promise.reject(new TdRequestError(500, "Request aborted"));
    if (this.telegram.invokeHangs.has(request._)) return new Promise(() => undefined);
    const dir = this.options.databaseDirectory;
    switch (request._) {
      case "requestQrCodeAuthentication":
        this.later(() => this.auth("authorizationStateWaitOtherDeviceConfirmation", { link: this.telegram.nextQrLink() }));
        return Promise.resolve({ _: "ok" });
      case "setAuthenticationPhoneNumber": {
        const user = this.telegram.users.get(String(request.phone_number));
        if (!user) return Promise.reject(new TdRequestError(400, "PHONE_NUMBER_INVALID"));
        this.pendingUser = user;
        this.later(() => this.auth("authorizationStateWaitCode", { code_info: { _: "authenticationCodeInfo" } }));
        return Promise.resolve({ _: "ok" });
      }
      case "checkAuthenticationCode":
        if (request.code !== "12345") return Promise.reject(new TdRequestError(400, "PHONE_CODE_INVALID"));
        this.later(() => {
          const user = this.pendingUser as FakeUser;
          if (user.password) this.auth("authorizationStateWaitPassword", { password_hint: "pet name" });
          else this.authorize(user);
        });
        return Promise.resolve({ _: "ok" });
      case "checkAuthenticationPassword":
        if (request.password !== this.pendingUser?.password) return Promise.reject(new TdRequestError(400, "PASSWORD_HASH_INVALID"));
        this.later(() => this.authorize(this.pendingUser as FakeUser));
        return Promise.resolve({ _: "ok" });
      case "getMe": {
        const user = this.telegram.authorized.get(dir);
        if (!user) return Promise.reject(new TdRequestError(401, "Unauthorized"));
        return Promise.resolve({ _: "user", id: user.id, first_name: user.firstName, last_name: "", phone_number: user.phone, usernames: { _: "usernames", active_usernames: ["fakeowner"] } });
      }
      case "setOption":
        return Promise.resolve({ _: "ok" });
      case "loadChats":
        return Promise.reject(new TdRequestError(404, "Not Found"));
      case "getChats":
        return Promise.resolve({ _: "chats", total_count: this.telegram.chats.size, chat_ids: [...this.telegram.chats.keys()] });
      case "getChat": {
        const chat = this.telegram.chats.get(Number(request.chat_id));
        if (!chat && Number(request.chat_id) === this.telegram.authorized.get(dir)?.id) {
          return Promise.resolve({ _: "chat", id: request.chat_id, title: "Saved Messages", type: { _: "chatTypePrivate", user_id: request.chat_id } });
        }
        if (!chat) return Promise.reject(new TdRequestError(400, "Chat not found"));
        const last = this.telegram.history.get(Number(request.chat_id))?.[0];
        return Promise.resolve({
          _: "chat", id: request.chat_id, title: chat.title,
          type: chat.type === "private" ? { _: "chatTypePrivate", user_id: chat.userId } : { _: "chatTypeSupergroup", supergroup_id: 123 },
          last_message: last ?? null,
          photo: chat.photoFileId ? { small: { id: chat.photoFileId, size: this.telegram.files.get(chat.photoFileId)?.byteLength ?? 0 } } : null,
        });
      }
      case "getUser": {
        const chat = [...this.telegram.chats.values()].find((c) => c.userId === Number(request.user_id));
        if (!chat) return Promise.reject(new TdRequestError(404, "User not found"));
        return Promise.resolve({ _: "user", id: request.user_id, type: { _: chat.userType }, usernames: chat.username ? { active_usernames: [chat.username] } : null });
      }
      case "getChatHistory": {
        const list = this.telegram.history.get(Number(request.chat_id)) ?? [];
        const from = Number(request.from_message_id);
        // Like TDLib with offset 0: the page starts at from_message_id itself.
        const start = from ? Math.max(0, list.findIndex((m) => Number(m.id) === from)) : 0;
        return Promise.resolve({ _: "messages", messages: list.slice(start, start + Number(request.limit)) });
      }
      case "downloadFile": {
        const id = Number(request.file_id);
        const bytes = this.telegram.files.get(id);
        if (!bytes) return Promise.reject(new TdRequestError(400, "File not found"));
        const path = join(this.telegram.fileDir, `file-${id}`);
        writeFileSync(path, bytes);
        return Promise.resolve({ _: "file", id, size: bytes.byteLength, local: { path, is_downloading_completed: true } });
      }
      case "deleteFile":
        this.telegram.deletedFiles.push(Number(request.file_id));
        return Promise.resolve({ _: "ok" });
      case "sendMessage": {
        const chatId = Number(request.chat_id);
        const content = request.input_message_content as TdObject;
        const replyTo = Number(((request.reply_to as TdObject | undefined)?.message_id) ?? 0) || null;
        const localPath = String(((Object.values(content ?? {}).find((v) => (v as TdObject)?._ === "inputFileLocal") as TdObject | undefined)?.path) ?? "");
        const text = String(((((content?.text ?? content?.caption) as TdObject | undefined))?.text) ?? "");
        if (this.telegram.sendOutcome === "reject") return Promise.reject(new TdRequestError(400, "CHAT_WRITE_FORBIDDEN"));
        if (localPath && !existsSync(localPath)) return Promise.reject(new TdRequestError(400, "File not found"));
        const fileBytes = localPath ? new Uint8Array(readFileSync(localPath)) : null;
        const tempId = this.telegram.nextTempId();
        const build = (id: number): TdObject => {
          const base = fileBytes
            ? content._ === "inputMessagePhoto"
              ? FakeTelegram.photoMessage(chatId, id, this.telegram.addFile(fileBytes), fileBytes.byteLength, text, { outgoing: true })
              : FakeTelegram.documentMessage(chatId, id, this.telegram.addFile(fileBytes), fileBytes.byteLength, "file.bin", { outgoing: true })
            : FakeTelegram.textMessage(chatId, id, text, { outgoing: true });
          return replyTo ? { ...base, reply_to: { _: "messageReplyToMessage", chat_id: chatId, message_id: replyTo } } : base;
        };
        const temp: TdObject = { ...build(tempId), sending_state: { _: "messageSendingStatePending" } };
        const outcome = this.telegram.sendOutcome;
        this.emit({ _: "updateNewMessage", message: temp });
        this.later(() => {
          if (outcome === "succeed") {
            const final = build(this.telegram.nextMessageId());
            this.telegram.delivered.push({ chatId, text, ...(fileBytes ? { kind: String(content._), bytes: fileBytes.byteLength } : {}), ...(replyTo ? { replyTo } : {}) });
            const list = this.telegram.history.get(chatId) ?? [];
            list.unshift(final);
            this.telegram.history.set(chatId, list);
            this.emit({ _: "updateMessageSendSucceeded", message: final, old_message_id: tempId });
          } else if (outcome === "fail") {
            this.emit({ _: "updateMessageSendFailed", message: { ...temp, sending_state: { _: "messageSendingStateFailed" } }, old_message_id: tempId, error: { _: "error", code: 403, message: "USER_PRIVACY_RESTRICTED" } });
          }
        });
        return Promise.resolve(temp);
      }
      case "getActiveSessions":
        if (!this.telegram.authorized.has(dir)) return Promise.reject(new TdRequestError(401, "Unauthorized"));
        return Promise.resolve({ _: "sessions", sessions: [] });
      case "logOut":
        if (this.telegram.logoutHangs) return new Promise(() => undefined);
        this.telegram.authorized.delete(dir);
        this.telegram.loggedOut.push(dir);
        this.later(() => {
          this.auth("authorizationStateLoggingOut");
          this.auth("authorizationStateClosing");
          this.auth("authorizationStateClosed");
        });
        return Promise.resolve({ _: "ok" });
      case "destroy":
        this.telegram.destroyed.push(dir);
        this.telegram.authorized.delete(dir);
        this.telegram.keys.delete(dir);
        this.later(() => this.auth("authorizationStateClosed"));
        return Promise.resolve({ _: "ok" });
      default:
        return Promise.reject(new TdRequestError(400, `Unsupported in fake: ${request._}`));
    }
  }

  onUpdate(listener: (update: TdObject) => void) {
    this.listeners.push(listener);
  }

  close(): Promise<void> {
    this.requests.push({ _: "close" });
    if (this.telegram.closeHangs) return new Promise(() => undefined);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!this.closed) {
          this.auth("authorizationStateClosing");
          this.auth("authorizationStateClosed");
        }
        resolve();
      }, this.telegram.eventDelayMs);
    });
  }

  isClosed() {
    return this.closed;
  }
}
