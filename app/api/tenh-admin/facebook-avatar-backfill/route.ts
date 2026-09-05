import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { syncFacebookContactProfilePhoto } from "@/lib/facebook/facebook-profile-photo";
import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * One-off catch-up for contacts who messaged before avatars were fetched.
 *
 * From here on a photo is collected the first time someone writes, so this
 * exists only to clear the backlog. Left to the lazy path alone the inbox would
 * stay a wall of initials for weeks, with photos appearing one at a time, and
 * look like the fix had not worked.
 *
 * Paced rather than parallel. Meta's Page rate limit is shared with sending, so
 * firing hundreds of requests at once risks "Application request limit reached"
 * -- which would stop agents replying, a far worse outcome than a slow backfill.
 *
 * Safe to run repeatedly: contacts that already have a stored avatar are
 * skipped, so a second run only picks up what the first could not.
 */

const DEFAULT_BATCH = 50;
const MAX_BATCH = 200;
const PAUSE_BETWEEN_MS = 250;

function jsonError(
  error: string,
  status: number,
) {
  return NextResponse.json(
    { success: false, error },
    { status },
  );
}

function wait(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

export async function POST(
  request: NextRequest,
) {
  const admin = await getTenhAdminUser();

  if (!admin.success) {
    return jsonError(
      admin.error,
      admin.status,
    );
  }

  const requested = Number(
    request.nextUrl.searchParams.get("limit"),
  );
  const limit = Math.min(
    MAX_BATCH,
    Math.max(
      1,
      Number.isFinite(requested) && requested > 0
        ? Math.trunc(requested)
        : DEFAULT_BATCH,
    ),
  );

  /*
   * Take the contact's own Page with it.
   *
   * A PSID is issued by one Page and means nothing to another, so a workspace
   * running two Pages cannot share a token between them -- Meta answers
   * "Object with ID does not exist, cannot be loaded due to missing
   * permissions" for every contact looked up with the wrong one. The Page comes
   * from the contact's conversation, which is where that relationship is
   * actually recorded.
   */
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select(
      `
      id,
      business_id,
      platform_user_id,
      profile_picture_url,
      conversations!inner (
        social_account:social_accounts!inner (
          id,
          platform_account_id,
          is_active
        )
      )
    `,
    )
    .eq("platform", "facebook")
    .is("profile_picture_url", null)
    .not("platform_user_id", "is", null)
    .limit(limit);

  if (error) {
    console.error(
      `Unable to load contacts for avatar backfill — ${error.message}`,
    );

    return jsonError(
      "Unable to load contacts.",
      500,
    );
  }

  const contacts = (data ?? []) as unknown as {
    id: string;
    business_id: string;
    platform_user_id: string | null;
    conversations?: {
      social_account?: {
        platform_account_id?: string | null;
        is_active?: boolean | null;
      } | null;
    }[];
  }[];

  /*
   * A contact can have more than one conversation. Any of them names a Page
   * that issued this PSID, so the first active one is enough.
   */
  function pageIdFor(
    contact: (typeof contacts)[number],
  ) {
    for (const conversation of contact.conversations ??
      []) {
      const account =
        conversation.social_account;

      if (
        account?.is_active &&
        account.platform_account_id
      ) {
        return account.platform_account_id;
      }
    }

    return null;
  }

  if (contacts.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      stored: 0,
      skipped: 0,
      remaining: 0,
      message:
        "Every Facebook contact already has a stored avatar, or none can be fetched.",
    });
  }

  /* One token read per Page, however many of its contacts are in this batch. */
  const tokenByPage = new Map<
    string,
    string | null
  >();

  let stored = 0;
  let skipped = 0;
  const reasons = new Map<string, number>();

  for (const contact of contacts) {
    if (!contact.platform_user_id) {
      skipped += 1;
      continue;
    }

    const pageId = pageIdFor(contact);

    if (!pageId) {
      skipped += 1;
      reasons.set(
        "No active Page connection for this contact.",
        (reasons.get(
          "No active Page connection for this contact.",
        ) ?? 0) + 1,
      );
      continue;
    }

    if (!tokenByPage.has(pageId)) {
      let token: string | null = null;

      try {
        token =
          await getFacebookPageAccessToken(
            pageId,
          );
      } catch {
        token = null;
      }

      tokenByPage.set(pageId, token);
    }

    const pageAccessToken =
      tokenByPage.get(pageId) ?? null;

    if (!pageAccessToken) {
      skipped += 1;
      reasons.set(
        "That Page has no usable access token.",
        (reasons.get(
          "That Page has no usable access token.",
        ) ?? 0) + 1,
      );
      continue;
    }

    const result =
      await syncFacebookContactProfilePhoto({
        contactId: contact.id,
        businessId: contact.business_id,
        customerId: contact.platform_user_id,
        pageAccessToken,
      });

    if (result.stored) {
      stored += 1;
    } else {
      skipped += 1;

      /*
       * Meta names the customer in its error, so forty identical failures
       * arrive as forty distinct strings and "most common reason" reports a
       * count of one. Dropping the id restores the grouping, which is the whole
       * point of showing a reason rather than a list.
       */
      const groupedReason = result.reason
        .replace(
          /Object with ID '[^']*'/,
          "Object with ID",
        )
        .replace(/\(#\d+\)\s*/, "");

      reasons.set(
        groupedReason,
        (reasons.get(groupedReason) ?? 0) + 1,
      );
    }

    await wait(PAUSE_BETWEEN_MS);
  }

  const { count: remaining } =
    await supabaseAdmin
      .from("contacts")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("platform", "facebook")
      .is("profile_picture_url", null);

  return NextResponse.json({
    success: true,
    processed: contacts.length,
    stored,
    skipped,
    remaining: remaining ?? 0,

    /*
     * Grouped rather than listed. "412 have no photo on Meta" is a fact about
     * the customers; 412 identical lines is noise.
     */
    reasons: Array.from(reasons.entries())
      .sort(
        (first, second) =>
          second[1] - first[1],
      )
      .map(([reason, count]) => ({
        reason,
        count,
      })),
  });
}
