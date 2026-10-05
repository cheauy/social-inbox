/*
 * Where a status link is going, read from the link itself.
 *
 * In paging mode the list title and the rows must describe the same filter.
 * The title used to follow the click while the rows followed the URL, so for
 * the length of a navigation the new title sat above the old filter's rows.
 * Parsing the destination from the href means the pager can request exactly
 * the scope the URL is about to have -- including what the link drops, such
 * as the view and workspace -- instead of the current scope with a new status.
 */

export type StatusFilterValue = "all" | "open" | "pending" | "resolved" | "closed" | "spam";

const STATUSES = new Set(["open", "pending", "resolved", "closed", "spam"]);

export function statusFromParam(value: string | null): StatusFilterValue {
  return value && STATUSES.has(value) ? value as StatusFilterValue : "all";
}

export type StatusDestination = {
  status: StatusFilterValue;
  view: string | null;
  channel: string | null;
  workspace: string | null;
};

type ParamReader = { get(name: string): string | null };

/* The same fields, read the same way, the list reads them from the live URL. */
export function destinationFromParams(params: ParamReader): StatusDestination {
  return {
    status: statusFromParam(params.get("status")),
    view: params.get("view"),
    channel: params.get("channel") ?? params.get("page"),
    workspace: params.get("workspace"),
  };
}

export function destinationFromHref(href: string): StatusDestination {
  return destinationFromParams(new URL(href, "http://tenh.local").searchParams);
}

export function sameDestination(a: StatusDestination, b: StatusDestination) {
  return a.status === b.status && a.view === b.view && a.channel === b.channel && a.workspace === b.workspace;
}
