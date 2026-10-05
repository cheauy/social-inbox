/**
 * The only surface the worker uses from TDLib. The real implementation is
 * tdl-adapter.ts; tests use a scripted fake so no Telegram network, account or
 * credential is ever involved in Phase B.
 */
export type TdObject = { _: string; [key: string]: unknown };

export interface TdClient {
  invoke(request: TdObject): Promise<TdObject>;
  onUpdate(listener: (update: TdObject) => void): void;
  /** Sends `close` and resolves once authorizationStateClosed was observed. */
  close(): Promise<void>;
  isClosed(): boolean;
}

export type TdClientOptions = {
  databaseDirectory: string;
  filesDirectory: string;
  /** base64 bytes, as TDLib's JSON interface expects. */
  databaseEncryptionKey: string;
};

export interface TdClientFactory {
  create(options: TdClientOptions): TdClient;
}

/** Error returned by TDLib for a request (code + message such as PHONE_CODE_INVALID). */
export class TdRequestError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "TdRequestError";
    this.code = code;
  }
}

export function tdErrorDetails(error: unknown): { code: number; message: string } | null {
  if (error instanceof TdRequestError) return { code: error.code, message: error.message };
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const code = Number((error as { code: unknown }).code);
    const message = String((error as { message: unknown }).message);
    if (Number.isFinite(code)) return { code, message };
  }
  return null;
}
