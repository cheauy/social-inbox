import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

type Cursor = { createdAt: string; id: string; key: string };
export type WorkspaceStorageQuery = {
  paged: boolean; limit: number; search: string;
  view: "recent" | "favorites" | `category:${string}`;
  kind: "all" | "media" | "files"; cursor: Cursor | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseWorkspaceStorageQuery(params: URLSearchParams): WorkspaceStorageQuery {
  const keys = ["limit", "q", "view", "kind", "cursor"];
  if (keys.some(key => params.getAll(key).length > 1)) throw new Error("Specify each Storage filter only once.");
  const paged = keys.some(key => params.has(key));
  const rawLimit = params.get("limit") ?? "30";
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) throw new Error("Storage page limit must be between 1 and 100.");
  const search = (params.get("q") ?? "").trim();
  if (search.length > 120) throw new Error("Storage search is limited to 120 characters.");
  const view = params.get("view") ?? "recent";
  if (view !== "recent" && view !== "favorites" && !(view.startsWith("category:") && UUID.test(view.slice(9)))) throw new Error("Choose a valid Storage view.");
  const kind = params.get("kind") ?? "all";
  if (!["all", "media", "files"].includes(kind)) throw new Error("Choose a valid Storage file type.");
  let cursor: Cursor | null = null;
  const encoded = params.get("cursor");
  if (encoded !== null) {
    if (!encoded || encoded.length > 512 || !/^[\w-]+$/.test(encoded)) throw new Error("Invalid Storage cursor.");
    try {
      const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Cursor;
      if (!value || typeof value.createdAt !== "string" || !TIMESTAMP.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.id !== "string" || !UUID.test(value.id) || !/^[0-9a-f]{64}$/.test(value.key)) throw new Error();
      cursor = value;
    } catch { throw new Error("Invalid Storage cursor."); }
  }
  return { paged, limit: paged ? Number(rawLimit) : 200, search, view: view as WorkspaceStorageQuery["view"], kind: kind as WorkspaceStorageQuery["kind"], cursor };
}

export function workspaceStorageQueryKey(businessId: string, memberId: string, query: WorkspaceStorageQuery) {
  return createHash("sha256").update(JSON.stringify([businessId, memberId, query.search, query.view, query.kind])).digest("hex");
}
export function workspaceStorageCursor(row: { created_at: string; id: string }, key: string) {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id, key })).toString("base64url");
}
export function storageSearchPattern(search: string) { return `%${search.replace(/[\\%_]/g, "\\$&")}%`; }
