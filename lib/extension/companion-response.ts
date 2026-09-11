/** Wait only for this request; explicit bridge failures must settle immediately. */
export function awaitCompanionAnswer<T>(
  type: string,
  requestId: string,
  timeout: number,
  host: Window = window,
): Promise<T | null> {
  return new Promise((resolve) => {
    const done = (value: T | null) => {
      host.removeEventListener("message", listener);
      host.clearTimeout(timer);
      resolve(value);
    };
    const listener = (event: MessageEvent) => {
      if (event.source !== host || event.origin !== host.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.source !== "TENH_EXTENSION" || data.type !== type || data.requestId !== requestId) return;
      if (data.error || data.requiresRefresh) {
        done({
          ...data,
          opened: false,
          resolved: false,
          reason: data.requiresRefresh ? "extension_refresh_required" : "extension_request_failed",
        } as T);
        return;
      }
      done(data as T);
    };
    const timer = host.setTimeout(() => done(null), timeout);
    host.addEventListener("message", listener);
  });
}
