import { File as FileSystemFile, UploadType } from "expo-file-system";

import { authCookieName, supabase } from "../supabase/client";
import { sessionCookie } from "./session-cookie";

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, workspaceId?: string | null, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const base = new URL(process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com");
  if (base.protocol !== "https:" && !(__DEV__ && ["localhost", "127.0.0.1", "10.0.2.2"].includes(base.hostname))) throw new Error("TENH API must use HTTPS.");
  if (!path.startsWith("/api/") || path.includes("..") || path.includes("\\")) throw new Error("Invalid API path.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ApiError("Please sign in again.", 401);
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort);
  if (init.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 60000);
  try {
    const multipart = init.body instanceof FormData;
    const response = await fetch(new URL(path, base).toString(), {
      method: init.method || "GET", signal: controller.signal, credentials: "omit", redirect: "error",
      headers: { Accept: "application/json", Cookie: sessionCookie(authCookieName, data.session, workspaceId), ...(init.body && !multipart ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? multipart ? init.body as FormData : JSON.stringify(init.body) : undefined,
    });
    let result;
    try { result = await response.json(); } catch { throw new ApiError("TENH returned an unexpected response. Check the API address and deployment.", response.status); }
    if (!response.ok || result.success === false) throw new ApiError(result.error || "Request failed. Please try again.", response.status);
    return result as T;
  } finally { clearTimeout(timeout); init.signal?.removeEventListener("abort", abort); }
}

/*
 * Upload one file, natively.
 *
 * React Native's FormData rejects the {uri, name, type} part shape under this
 * runtime -- "Unsupported FormDataPart implementation" -- so the file never
 * left the phone. expo-file-system builds the multipart body in native code
 * and streams it off disk, which also means a 20 MB video never has to sit in
 * JS memory on its way out.
 *
 * The base-URL check and the session cookie are the same as api(): this is a
 * second transport, not a second set of rules.
 */
export async function upload<T>(path: string, workspaceId: string | null | undefined, file: { uri: string; mimeType: string }): Promise<T> {
  const base = new URL(process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com");
  if (base.protocol !== "https:" && !(__DEV__ && ["localhost", "127.0.0.1", "10.0.2.2"].includes(base.hostname))) throw new Error("TENH API must use HTTPS.");
  if (!path.startsWith("/api/") || path.includes("..") || path.includes("\\")) throw new Error("Invalid API path.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ApiError("Please sign in again.", 401);
  const result = await new FileSystemFile(file.uri).upload(new URL(path, base).toString(), {
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.mimeType,
    headers: { Accept: "application/json", Cookie: sessionCookie(authCookieName, data.session, workspaceId) },
  });
  let body;
  try { body = JSON.parse(result.body); } catch { throw new ApiError("TENH returned an unexpected response.", result.status); }
  if (result.status >= 400 || body.success === false) throw new ApiError(body.error || "Upload failed. Please try again.", result.status);
  return body as T;
}
