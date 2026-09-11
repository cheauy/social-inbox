import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";
import { usageContext, type RequestUsage } from "@/lib/server/usage-context";

// This cache lives for ONE request. Never share authentication, permissions or
// workspace data between callers, or across an access/subscription change.
const requests = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function requestMemo<T>(key: string, read: () => Promise<T>): Promise<T> {
  const scope = requests.getStore();
  if (!scope) return read();
  const existing = scope.get(key);
  if (existing) return existing as Promise<T>;
  const pending = read();
  scope.set(key, pending);
  pending.catch(() => { if (scope.get(key) === pending) scope.delete(key); });
  return pending;
}

export function withRequestScope<A extends unknown[], R>(handler: (...args: A) => Promise<R>) {
  return (...args: A): Promise<R> => {
    const request = args[0];
    const route = request instanceof Request
      ? new URL(request.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")
      : handler.name;
    const usage: RequestUsage = { businessId: null, route, databaseRequests: 0, databaseResponseBytes: 0, storageResponseBytes: 0, uploadBytes: 0 };
    return requests.run(new Map(), () => usageContext.run(usage, async () => {
      try { return await handler(...args); }
      finally {
        // The response is never held up by telemetry or a missing migration.
        after(async () => {
          if (!usage.businessId || process.env.TENH_USAGE_MODE === "off") return;
          const { recordRequestUsage } = await import("@/lib/server/record-request-usage");
          await recordRequestUsage(usage);
        });
      }
    }));
  };
}
