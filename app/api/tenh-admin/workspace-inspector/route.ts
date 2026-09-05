import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/*
 * Everything about one workspace, in one place.
 *
 * A support question is almost never "what is this customer's plan" -- it is
 * "why can this customer not send a photo", and answering that meant checking
 * the subscription, then the channels, then the webhook URLs, then whether the
 * conversation was a comment thread, across separate screens or none at all.
 * Every one of those was a hand-written query today.
 *
 * So this gathers the facts that actually get asked about and returns them
 * together. Read-only by design: it answers questions, it does not change
 * anything, which keeps it safe to open while on a call with a customer.
 */

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
 * PostgREST's `or` takes a comma-separated filter list, so a search term
 * carrying a comma or a paren would change the query's shape rather than be
 * matched. None of those appear in a workspace name or an email.
 */
function sanitize(value: string) {
  return value.replace(/[,()*\\]/g, "").trim();
}

export async function GET(
  request: NextRequest,
) {
  const admin = await getTenhAdminUser();

  if (!admin.success) {
    return noStoreJson(
      { success: false, error: admin.error },
      admin.status,
    );
  }

  const businessId =
    request.nextUrl.searchParams
      .get("businessId")
      ?.trim() ?? "";

  /* ---------------------------------------------------------------- search */
  if (!businessId) {
    const rawQuery =
      request.nextUrl.searchParams
        .get("query")
        ?.trim() ?? "";
    const query = sanitize(rawQuery);

    /*
     * A blank search lists the newest workspaces rather than erroring. Support
     * often wants "who signed up today" as much as a named customer.
     */
    let builder = supabaseAdmin
      .from("businesses")
      .select("id,name,created_at")
      .order("created_at", {
        ascending: false,
      })
      .limit(25);

    if (query.length >= 2) {
      builder = builder.or(
        [
          `name.ilike.%${query}%`,
          `slug.ilike.%${query}%`,
        ].join(","),
      );
    }

    const { data, error } = await builder;

    if (error) {
      console.error(
        `Workspace search failed — ${error.message}`,
      );

      return noStoreJson(
        {
          success: false,
          error: "Unable to search workspaces.",
        },
        500,
      );
    }

    /*
     * Searching by owner email as well, because that is what a customer gives
     * you when they write in -- rarely their workspace's exact name.
     */
    let byEmail: typeof data = [];

    if (query.length >= 2 && query.includes("@")) {
      const { data: members } =
        await supabaseAdmin
          .from("team_members")
          .select("business_id")
          .ilike("email", `%${query}%`)
          .eq("is_active", true)
          .limit(25);

      const ids = Array.from(
        new Set(
          (members ?? []).map(
            (row) => row.business_id as string,
          ),
        ),
      );

      if (ids.length > 0) {
        const { data: extra } =
          await supabaseAdmin
            .from("businesses")
            .select("id,name,created_at")
            .in("id", ids);

        byEmail = extra ?? [];
      }
    }

    const seen = new Set<string>();
    const workspaces = [
      ...(data ?? []),
      ...byEmail,
    ].filter((row) => {
      if (seen.has(row.id as string)) {
        return false;
      }

      seen.add(row.id as string);
      return true;
    });

    return noStoreJson({
      success: true,
      workspaces,
    });
  }

  /* ---------------------------------------------------------------- detail */
  const [
    businessResult,
    subscriptionResult,
    membersResult,
    channelsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id,name,slug,created_at")
      .eq("id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_subscriptions")
      .select(
        "plan_code,status,billing_cycle,member_limit,channel_limit,current_period_end,trial_ends_at,last_paid_amount,last_paid_currency",
      )
      .eq("business_id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("team_members")
      .select(
        "id,full_name,email,role,is_active,created_at",
      )
      .eq("business_id", businessId)
      .order("role", { ascending: true })
      .limit(50),
    supabaseAdmin
      .from("social_accounts")
      .select(
        "id,platform,account_name,platform_account_id,is_active,facebook_token_status,telegram_token_status,telegram_webhook_status,telegram_webhook_url,created_at",
      )
      .eq("business_id", businessId)
      .order("created_at", {
        ascending: true,
      }),
  ]);

  if (
    businessResult.error ||
    !businessResult.data
  ) {
    return noStoreJson(
      {
        success: false,
        error: "That workspace was not found.",
      },
      404,
    );
  }

  /*
   * Counts run together, head-only so none of them pulls rows back. This stays
   * fast on a workspace with tens of thousands of messages, which is the only
   * kind where the numbers are interesting.
   */
  const headCount = {
    count: "exact" as const,
    head: true,
  };

  const [
    conversations,
    openConversations,
    unassignedOpen,
    contacts,
    messages,
    failedMessages,
    savedReplies,
  ] = await Promise.all([
    supabaseAdmin
      .from("conversations")
      .select("id", headCount)
      .eq("business_id", businessId),
    supabaseAdmin
      .from("conversations")
      .select("id", headCount)
      .eq("business_id", businessId)
      .eq("status", "open"),
    supabaseAdmin
      .from("conversations")
      .select("id", headCount)
      .eq("business_id", businessId)
      .eq("status", "open")
      .is("assigned_to", null),
    supabaseAdmin
      .from("contacts")
      .select("id", headCount)
      .eq("business_id", businessId),
    supabaseAdmin
      .from("messages")
      .select("id", headCount)
      .eq("business_id", businessId),
    supabaseAdmin
      .from("messages")
      .select("id", headCount)
      .eq("business_id", businessId)
      .eq("delivery_status", "failed"),
    supabaseAdmin
      .from("saved_replies")
      .select("id", headCount)
      .eq("business_id", businessId),
  ]);

  /* The freshest sign of life, which is what "is this account working" means. */
  const { data: lastMessage } =
    await supabaseAdmin
      .from("messages")
      .select("created_at,direction")
      .eq("business_id", businessId)
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

  return noStoreJson({
    success: true,
    workspace: businessResult.data,
    subscription:
      subscriptionResult.data ?? null,
    members: membersResult.data ?? [],
    channels: channelsResult.data ?? [],
    usage: {
      conversations: conversations.count ?? 0,
      openConversations:
        openConversations.count ?? 0,
      unassignedOpen:
        unassignedOpen.count ?? 0,
      contacts: contacts.count ?? 0,
      messages: messages.count ?? 0,
      failedMessages:
        failedMessages.count ?? 0,
      savedReplies: savedReplies.count ?? 0,
      lastMessageAt:
        lastMessage?.created_at ?? null,
      lastMessageDirection:
        lastMessage?.direction ?? null,
    },
  });
}
