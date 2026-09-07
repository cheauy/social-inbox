import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/*
 * Is Meta actually sending us anything?
 *
 * Every webhook Facebook delivers is stored before it is processed, together
 * with whether it processed and why it did not. Nothing displays any of it, so
 * the one question that matters when a customer says "messages stopped" --
 * did the message ever reach us -- could only be answered by hand-written SQL.
 *
 * The headline is not the event list. It is the Pages that are connected,
 * healthy by every check TENH can make, and silent. A Page whose webhooks
 * Meta has stopped delivering looks perfectly fine from the inside: valid
 * token, complete subscription, no errors anywhere. The only visible symptom
 * is an absence, and an absence is exactly what a list of events cannot show
 * you. So this counts what arrived per Page and names the ones where the
 * answer is nothing.
 */

const DEFAULT_HOURS = 24;
const MAX_HOURS = 24 * 14;

/*
 * Events are read in one bounded page rather than aggregated in the database,
 * because the page id lives inside the JSON payload and there is no index on
 * it. At a few thousand events a day that is cheap; the cap is what keeps it
 * cheap if this table grows by an order of magnitude.
 */
const MAX_EVENTS_SCANNED = 4000;

type WebhookEventRow = {
  id: string;
  platform: string | null;
  event_type: string | null;
  processing_status: string | null;
  processing_error: string | null;
  created_at: string;
  payload: unknown;
};

function noStoreJson(
  body: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/*
 * Facebook nests the Page id at entry[0].id. Telegram events are shaped
 * differently and simply have no Page, which is correct rather than missing.
 */
function pageIdFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const entry = (payload as { entry?: unknown }).entry;

  if (!Array.isArray(entry) || entry.length === 0) {
    return null;
  }

  const first = entry[0];

  if (!first || typeof first !== "object") {
    return null;
  }

  const id = (first as { id?: unknown }).id;

  return typeof id === "string" && id.trim()
    ? id.trim()
    : null;
}

export async function GET(request: NextRequest) {
  const admin = await getTenhAdminUser();

  if (!admin.success) {
    return noStoreJson(
      { success: false, error: admin.error },
      admin.status,
    );
  }

  const requestedHours = Number(
    request.nextUrl.searchParams.get("hours"),
  );
  const hours = Math.min(
    MAX_HOURS,
    Math.max(
      1,
      Number.isFinite(requestedHours) && requestedHours > 0
        ? Math.round(requestedHours)
        : DEFAULT_HOURS,
    ),
  );

  const since = new Date(
    Date.now() - hours * 60 * 60 * 1000,
  ).toISOString();

  const [eventsResult, accountsResult] = await Promise.all([
    supabaseAdmin
      .from("webhook_events")
      .select(
        "id,platform,event_type,processing_status,processing_error,created_at,payload",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTS_SCANNED),
    supabaseAdmin
      .from("social_accounts")
      .select(
        "id,platform,account_name,platform_account_id,is_active,business_id,businesses(name)",
      )
      .eq("is_active", true),
  ]);

  if (eventsResult.error) {
    console.error(
      `Webhook events could not be read — ${eventsResult.error.message}`,
    );

    return noStoreJson(
      {
        success: false,
        error: "Unable to read webhook events.",
      },
      500,
    );
  }

  const events = (eventsResult.data ??
    []) as unknown as WebhookEventRow[];

  const accounts = (accountsResult.data ?? []) as unknown as {
    id: string;
    platform: string | null;
    account_name: string | null;
    platform_account_id: string | null;
    business_id: string;
    businesses?: { name?: string | null } | null;
  }[];

  /* ------------------------------------------------ per-page tallies */
  type Tally = {
    pageId: string;
    events: number;
    failed: number;
    latest: string | null;
  };

  const byPage = new Map<string, Tally>();
  let failedTotal = 0;
  let withoutPage = 0;

  for (const event of events) {
    if (event.processing_status === "failed") {
      failedTotal += 1;
    }

    const pageId = pageIdFromPayload(event.payload);

    if (!pageId) {
      withoutPage += 1;
      continue;
    }

    const tally = byPage.get(pageId) ?? {
      pageId,
      events: 0,
      failed: 0,
      latest: null,
    };

    tally.events += 1;

    if (event.processing_status === "failed") {
      tally.failed += 1;
    }

    /* Rows arrive newest first, so the first one seen is the latest. */
    tally.latest = tally.latest ?? event.created_at;
    byPage.set(pageId, tally);
  }

  /*
   * Every connected Facebook Page, whether or not it appeared above. The ones
   * with nothing are the point of this screen.
   */
  const pages = accounts
    .filter((account) => account.platform === "facebook")
    .map((account) => {
      const pageId =
        account.platform_account_id?.trim() ?? "";
      const tally = byPage.get(pageId);

      return {
        socialAccountId: account.id,
        pageId,
        pageName:
          account.account_name ?? "Facebook Page",
        workspaceName:
          account.businesses?.name ?? "Unknown workspace",
        events: tally?.events ?? 0,
        failed: tally?.failed ?? 0,
        latest: tally?.latest ?? null,
        silent: (tally?.events ?? 0) === 0,
      };
    })
    .sort((first, second) => {
      /* Silent Pages first: they are the reason to open this page. */
      if (first.silent !== second.silent) {
        return first.silent ? -1 : 1;
      }

      return second.events - first.events;
    });

  /*
   * Events arriving for a Page that is no longer connected here. Usually a
   * Page released to another workspace, occasionally a subscription nobody
   * remembered to remove.
   */
  const connectedPageIds = new Set(
    pages.map((page) => page.pageId).filter(Boolean),
  );

  const unknownPages = Array.from(byPage.values())
    .filter((tally) => !connectedPageIds.has(tally.pageId))
    .sort((first, second) => second.events - first.events);

  /* ---------------------------------------------------- failures */
  const failureReasons = new Map<
    string,
    { reason: string; count: number; latest: string }
  >();

  for (const event of events) {
    if (event.processing_status !== "failed") {
      continue;
    }

    /*
     * Meta names the offending row in some errors, so forty identical
     * failures would otherwise arrive as forty distinct strings and the
     * grouping that makes this readable would report a count of one each.
     */
    const reason = (
      event.processing_error ?? "Unknown error"
    )
      .replace(/'[^']{8,}'/g, "'…'")
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, "…")
      .slice(0, 200);

    const existing = failureReasons.get(reason);

    if (existing) {
      existing.count += 1;
    } else {
      failureReasons.set(reason, {
        reason,
        count: 1,
        latest: event.created_at,
      });
    }
  }

  return noStoreJson({
    success: true,
    hours,
    scanned: events.length,
    truncated: events.length >= MAX_EVENTS_SCANNED,
    totals: {
      events: events.length,
      failed: failedTotal,
      withoutPage,
    },
    pages,
    unknownPages,
    failures: Array.from(failureReasons.values()).sort(
      (first, second) => second.count - first.count,
    ),
    recent: events.slice(0, 40).map((event) => ({
      id: event.id,
      platform: event.platform,
      eventType: event.event_type,
      status: event.processing_status,
      error: event.processing_error,
      pageId: pageIdFromPayload(event.payload),
      createdAt: event.created_at,
    })),
  });
}
