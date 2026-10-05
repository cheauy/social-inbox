import type { LoginInputKind } from "./crypto.ts";

export const OPEN_LOGIN_STATUSES = ["connecting", "waiting_phone", "waiting_qr", "waiting_code", "waiting_password"] as const;
export const LIVE_STATUSES = ["connected", "reconnecting"] as const;
export const TERMINAL_STATUSES = ["cancelled", "expired", "failed", "revoked", "disconnected"] as const;

export type SessionStatus =
  | (typeof OPEN_LOGIN_STATUSES)[number]
  | (typeof LIVE_STATUSES)[number]
  | "pausing"
  | "paused"
  | "disconnect_pending"
  | (typeof TERMINAL_STATUSES)[number];

export type OpenLoginStatus = (typeof OPEN_LOGIN_STATUSES)[number];

export function isOpenLogin(status: string | null | undefined): status is OpenLoginStatus {
  return (OPEN_LOGIN_STATUSES as readonly string[]).includes(status ?? "");
}
export function isLive(status: string | null | undefined) {
  return (LIVE_STATUSES as readonly string[]).includes(status ?? "");
}
export function isTerminal(status: string | null | undefined) {
  return (TERMINAL_STATUSES as readonly string[]).includes(status ?? "");
}

export type ClaimedSession = {
  id: string;
  businessId: string;
  status: SessionStatus;
  loginMethod: "qr" | "phone";
  epoch: number;
  dbKeyWrapped: string | null;
  localState: "none" | "present" | "removed";
};

export type Fence = { sessionId: string; workerId: string; epoch: number };

export type WorkerPatch = {
  status?: SessionStatus;
  last_error_code?: string | null;
  local_state?: "none" | "present" | "removed";
  db_key_wrapped?: string | null;
};

export type LoginPatch = {
  status: OpenLoginStatus | null;
  qrLink?: string | null;
  passwordHint?: string | null;
  errorCode?: string | null;
};

export type LoginInput = { kind: LoginInputKind; sealed: string } | null;

export type Identity = {
  telegramUserId: string;
  displayName: string;
  username: string | null;
  phoneMasked: string | null;
};

export type Command = { id: string; kind: "pause" | "logout" | "list_chats" | "import_history"; payload?: Record<string, unknown> };

export type SharedChat = { chatId: string; rowId: string; lastMessageAt: string | null };

export type IngestResult = "INSERTED" | "DUPLICATE" | "NOT_SHARED" | "NOT_LIVE" | "LEASE_LOST" | "UNAVAILABLE";

export type IngestRow = {
  chatId: string;
  messageId: number;
  direction: "incoming" | "outgoing";
  type: "text" | "placeholder";
  body: string | null;
  placeholder: string | null;
  sentAt: string;
};

/** All worker writes are fenced: they return false once the lease is lost. */
export interface Store {
  claimSessions(workerId: string, ttlSeconds: number, limit: number): Promise<ClaimedSession[]>;
  renewLease(fence: Fence, ttlSeconds: number): Promise<boolean>;
  releaseLease(fence: Fence, shutdown: "clean" | "unclean" | null): Promise<boolean>;
  workerUpdate(fence: Fence, patch: WorkerPatch): Promise<boolean>;
  loginUpdate(fence: Fence, patch: LoginPatch): Promise<boolean>;
  takeLoginInput(fence: Fence): Promise<{ input: LoginInput; deadlineAt: Date | null }>;
  readStatus(sessionId: string): Promise<SessionStatus | null>;
  activate(fence: Fence, identity: Identity): Promise<{ ok: boolean; code?: string }>;
  claimCommands(fence: Fence, limit: number): Promise<Command[]>;
  finishCommand(fence: Fence, commandId: string, status: "done" | "failed", errorCode: string | null): Promise<boolean>;
  /** D1. Store a command result (e.g. the chat list) for the holder to read. */
  finishCommandResult(fence: Fence, commandId: string, status: "done" | "failed", errorCode: string | null, result: unknown): Promise<boolean>;
  /** D1. Chats the holder shares from this session's account. */
  sharedChats(fence: Fence): Promise<SharedChat[]>;
  /** D1. Idempotent, fenced message ingest. */
  ingestMessage(fence: Fence, row: IngestRow): Promise<IngestResult>;
  /** Subscribe to wake-ups (Postgres NOTIFY). Returns an unsubscribe function. */
  listen(onWake: (sessionId: string) => void): Promise<() => Promise<void>>;
}
