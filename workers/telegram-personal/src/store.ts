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

export type Command = { id: string; kind: "pause" | "logout" | "list_chats" | "import_history" | "send_text" | "send_media"; payload?: Record<string, unknown> };

export type SharedChat = { chatId: string; rowId: string; lastMessageAt: string | null; sharedAt: string | null };

export type IngestResult = "INSERTED" | "DUPLICATE" | "NOT_SHARED" | "NOT_LIVE" | "LEASE_LOST" | "UNAVAILABLE" | "INVALID";

export type AutoShareResult = "SHARED" | "OFF" | "EXCLUDED" | "NOT_LIVE" | "LEASE_LOST" | "UNAVAILABLE";

/** The ingest result and, in the unified inbox, the TENH message id. */
export type IngestOutcome = { result: IngestResult; messageId: string | null };

/** D2: what a finished send returns (the queued command it belonged to). */
export type FinishedSend = { commandId: string; payload: Record<string, unknown> };

export type IngestRow = {
  chatId: string;
  messageId: number;
  direction: "incoming" | "outgoing";
  type: "text" | "placeholder";
  body: string | null;
  placeholder: string | null;
  sentAt: string;
  /** Live and catch-up messages count as unread; imported history does not. */
  countUnread?: boolean;
  /** D2: set on a message sent from TENH, so the inbox can match it to the send. */
  clientRequestId?: string | null;
  sentByMember?: string | null;
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
  /** Idempotent, fenced message ingest into the TENH inbox. */
  ingestMessage(fence: Fence, row: IngestRow): Promise<IngestOutcome>;
  /** Automatic sharing: shares this chat if the holder switched it on (SHARED), else why not. */
  autoShareChat(fence: Fence, chatId: string, title: string, username: string | null): Promise<AutoShareResult>;
  /** Media copied into TENH storage: the message shows the real file. */
  setMessageMedia(fence: Fence, messageId: string, messageType: string, text: string, attachment: Record<string, unknown>): Promise<boolean>;
  /** Quote of the replied-to message (same chat). */
  setMessageReply(fence: Fence, messageId: string, chatId: string, replyTo: number): Promise<boolean>;
  /** Edited in Telegram. */
  editMessage(fence: Fence, chatId: string, messageId: number, text: string, editedAt: string): Promise<string>;
  /** Deleted in Telegram for everyone. */
  deleteMessages(fence: Fence, chatId: string, messageIds: number[]): Promise<number>;
  /** Contact of a shared chat (for the profile photo path), or null. */
  chatContact(fence: Fence, chatId: string): Promise<{ contactId: string; businessId: string } | null>;
  setContactPhoto(fence: Fence, chatId: string, hasPhoto: boolean): Promise<boolean>;
  /** D2. claimed -> sending, BEFORE calling Telegram. A sending command is never claimed again. */
  sendBegin(fence: Fence, commandId: string): Promise<boolean>;
  /** D2. Records TDLib's temporary message id so the outcome can be matched after a restart. */
  sendAccepted(fence: Fence, commandId: string, tempMessageId: number): Promise<boolean>;
  /** D2. Outcome by temporary id (also resolves an earlier "uncertain"). Null when no send matches. */
  sendFinish(fence: Fence, tempMessageId: number, status: "done" | "failed", errorCode: string | null, messageId: string | null): Promise<FinishedSend | null>;
  /** D2. A send that failed before Telegram accepted it, or whose outcome is unknown. */
  sendFail(fence: Fence, commandId: string, status: "failed" | "uncertain", errorCode: string): Promise<boolean>;
  /** D2. Sends in flight longer than this become "uncertain" (never retried). */
  sendMarkStale(fence: Fence, olderThanSeconds: number): Promise<number>;
  /** Subscribe to wake-ups (Postgres NOTIFY). Returns an unsubscribe function. */
  listen(onWake: (sessionId: string) => void): Promise<() => Promise<void>>;
}
