import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestUsage = {
  businessId: string | null;
  route: string;
  databaseRequests: number;
  databaseResponseBytes: number;
  storageResponseBytes: number;
  uploadBytes: number;
};
export const usageContext = new AsyncLocalStorage<RequestUsage>();

export function attributeUsage(businessId: string) {
  const usage = usageContext.getStore();
  if (usage) usage.businessId = businessId;
}

// Counts the response stream already being consumed. No extra download, no
// credentials, URLs, message contents or response clones in the telemetry.
// Bytes are decoded application bytes, NOT Supabase's billable network bytes.
export const observedSupabaseFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const usage = usageContext.getStore();
  if (!usage) return response;
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const database = url.pathname.startsWith("/rest/v1/");
  const storage = url.pathname.startsWith("/storage/v1/");
  if (database) usage.databaseRequests++;
  if ((!database && !storage) || !response.body) return response;
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (database) usage.databaseResponseBytes += chunk.byteLength;
      else usage.storageResponseBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  }));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};

export function recordUploadBytes(bytes: number) {
  const usage = usageContext.getStore();
  if (usage && Number.isSafeInteger(bytes) && bytes > 0) usage.uploadBytes += bytes;
}
