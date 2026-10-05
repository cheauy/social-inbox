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
