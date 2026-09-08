import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { getInboxConversationScope } from "@/lib/inbox/get-conversations";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Which conversations contain this text anywhere in their history.
 *
 * The search box says it covers "conversations, contacts or messages", and
 * until now it covered the first two: the list holds each conversation's last
 * message and nothing before it, so a phrase from the middle of a thread
 * returned nothing. Typing a phone number an agent had read three messages
 * earlier found no result, which reads as the search being broken rather than
 * as it being narrower than its own placeholder.
 *
 * This answers only with conversation ids. The client already has every
 * conversation it is allowed to see and renders the rows itself; handing back
 * message bodies would duplicate that and put message text through a second
 * path for no gain.
 */

/*
 * Two characters match most of a busy inbox and cost a full scan to say so.
 * Three is where a search starts being a search.
 */
const MINIMUM_QUERY_LENGTH = 3;

/*
 * Enough to fill the list many times over. A query broad enough to exceed this
 * is one the agent will narrow anyway, and the cap keeps a single keystroke
 * from reading the whole message table.
 */
const MAX_CONVERSATIONS = 200;

/*
 * PostgREST treats these as wildcards inside ilike, so a customer searching
 * for a literal percent sign would otherwise match everything. Escaped rather
 * than stripped: the agent typed them, and they may be in the message.
 */
function escapeLikePattern(value: string) {
  return value.replace(
    /[%_\\]/g,
    (match) => "\\" + match,
  );
}

export async function GET(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const query =
    request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (query.length < MINIMUM_QUERY_LENGTH) {
    return NextResponse.json(
      { success: true, conversationIds: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const scope = await getInboxConversationScope();

  if (scope.accessibleBusinessIds.length === 0) {
    return NextResponse.json(
      { success: true, conversationIds: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  /*
   * Scoped to the workspaces this member belongs to, not to a business id
   * from the request. The admin client bypasses RLS, so the scope has to be
   * applied here or a search would read every workspace's messages.
   */
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("conversation_id")
    .in("business_id", scope.accessibleBusinessIds)
    .not("conversation_id", "is", null)
    .ilike(
      "message_text",
      `%${escapeLikePattern(query)}%`,
    )
    .order("platform_created_at", { ascending: false })
    .limit(MAX_CONVERSATIONS * 8);

  if (error) {
    console.error(
      "[TENH] Unable to search messages:",
      error.message,
    );

    return NextResponse.json(
      { success: false, error: "Unable to search messages." },
      { status: 500 },
    );
  }

  /*
   * One conversation can match on many messages; the caller wants the
   * conversation once. Ordered newest first above, so the ids that survive
   * the cap are the ones with the most recent match.
   */
  const conversationIds: string[] = [];
  const seen = new Set<string>();

  for (const row of data ?? []) {
    const id = row.conversation_id;

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    conversationIds.push(id);

    if (conversationIds.length >= MAX_CONVERSATIONS) {
      break;
    }
  }

  return NextResponse.json(
    { success: true, conversationIds },
    { headers: { "Cache-Control": "no-store" } },
  );
}
