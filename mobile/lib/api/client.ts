import { File as FileSystemFile, UploadType } from "expo-file-system";

import { authCookieName, supabase } from "../supabase/client";
import { sessionCookie } from "./session-cookie";

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

/*
 * A sentence, whatever shape the server put the failure in.
 *
 * Most routes answer { error: "..." }, some answer { error: { message } } and
 * a few nest the platform's own reply. Handing any of those straight to
 * Error() produced "[object Object]" on screen -- a failure that tells
 * somebody nothing at all, and tells whoever they report it to even less.
 */
export function describeError(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    for (const key of ["message", "error", "details", "description"]) {
      const nested = describeError(record[key], "");
      if (nested) return nested;
    }
  }

  return fallback;
}
export async function api<T>(path: string, workspaceId?: string | null, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}, retried = false): Promise<T> {
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

    /*
     * A session the server will not accept.
     *
     * getSession() hands back whatever is in storage, and the access token in
     * it can be one the server has already stopped honouring -- expired while
     * the app was closed, or superseded because the same account signed in on
     * another device and rotated the refresh token. The request then comes
     * back 401 "Unauthorized." and nothing here noticed: the app still held a
     * session object, so it stayed on the workspace chooser showing an error
     * with a Retry that could only fail again, and no way to sign in.
     *
     * So: refresh once and repeat the request. If the refresh is refused too,
     * the session is genuinely dead -- sign out, which drops the app back to
     * the sign-in screen where somebody can do something about it.
     */
    if (response.status === 401 && !retried) {
      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession();

      if (!refreshError && refreshed.session) {
        return api<T>(path, workspaceId, init, true);
      }

      await supabase.auth.signOut();
      throw new ApiError("Your session has expired. Please sign in again.", 401);
    }

    let result;
    try { result = await response.json(); } catch { throw new ApiError("TENH returned an unexpected response. Check the API address and deployment.", response.status); }
    if (!response.ok || result.success === false) throw new ApiError(describeError(result.error ?? result, "Request failed. Please try again."), response.status);
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
export async function upload<T>(path: string, workspaceId: string | null | undefined, file: { uri: string; mimeType: string }, parameters: Record<string, string> = {}): Promise<T> {
  const base = new URL(process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com");
  if (base.protocol !== "https:" && !(__DEV__ && ["localhost", "127.0.0.1", "10.0.2.2"].includes(base.hostname))) throw new Error("TENH API must use HTTPS.");
  if (!path.startsWith("/api/") || path.includes("..") || path.includes("\\")) throw new Error("Invalid API path.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ApiError("Please sign in again.", 401);
  const result = await new FileSystemFile(file.uri).upload(new URL(path, base).toString(), {
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.mimeType,
    parameters,
    headers: { Accept: "application/json", Cookie: sessionCookie(authCookieName, data.session, workspaceId) },
  });
  let body;
  try { body = JSON.parse(result.body); } catch { throw new ApiError("TENH returned an unexpected response.", result.status); }
  if (result.status >= 400 || body.success === false) throw new ApiError(describeError(body.error ?? body, "Upload failed. Please try again."), result.status);
  return body as T;
}

/**
 * Upload an album in one multipart request.
 *
 * File.upload is the reliable, streaming path for one file. An album needs
 * several file parts in the same request, so use Expo File objects here. They
 * implement the Blob byte contract understood by Expo's patched FormData;
 * the old React Native `{ uri, name, type }` object does not.
 */
export async function uploadMany<T>(
  path: string,
  workspaceId: string | null | undefined,
  files: { uri: string; mimeType: string; name: string; fieldName: string }[],
  parameters: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();

  for (const [name, value] of Object.entries(parameters)) {
    form.append(name, value);
  }

  for (const item of files) {
    form.append(
      item.fieldName,
      new FileSystemFile(item.uri) as unknown as Blob,
      item.name,
    );
  }

  return api<T>(path, workspaceId, { method: "POST", body: form });
}
