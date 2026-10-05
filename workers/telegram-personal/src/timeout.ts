export class OperationTimeoutError extends Error {
  readonly operation: string;
  constructor(operation: string) {
    super(`${operation} did not finish in time (local timeout; Telegram outcome unknown)`);
    this.name = "OperationTimeoutError";
    this.operation = operation;
  }
}

/** Bounded wait. A local timeout never proves Telegram rejected the request. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OperationTimeoutError(operation)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
