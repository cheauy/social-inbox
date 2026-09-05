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

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select(
      "id,business_id,platform_user_id,profile_picture_url",
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

  const contacts = (data ?? []) as {
    id: string;
    business_id: string;
    platform_user_id: string | null;
  }[];

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

  /*
   * The Page token is per social account, and every contact in a workspace
   * shares one. Resolving it once per business keeps this to a handful of token
   * reads rather than one per contact.
   */
  const tokenByBusiness = new Map<
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

    if (
      !tokenByBusiness.has(contact.business_id)
    ) {
      const { data: account } =
        await supabaseAdmin
          .from("social_accounts")
          .select("platform_account_id")
          .eq(
            "business_id",
            contact.business_id,
          )
          .eq("platform", "facebook")
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

      let token: string | null = null;

      if (account?.platform_account_id) {
        try {
          token =
            await getFacebookPageAccessToken(
              account.platform_account_id as string,
            );
        } catch {
          token = null;
        }
      }

      tokenByBusiness.set(
        contact.business_id,
        token,
      );
    }

    const pageAccessToken =
      tokenByBusiness.get(
        contact.business_id,
      ) ?? null;

    if (!pageAccessToken) {
      skipped += 1;
      reasons.set(
        "No active Page connection for this workspace.",
        (reasons.get(
          "No active Page connection for this workspace.",
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
      reasons.set(
        result.reason,
        (reasons.get(result.reason) ?? 0) + 1,
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
    reasons: Array.from(
      reasons.entries(),
    ).map(([reason, count]) => ({
      reason,
      count,
    })),
  });
}
