import { NextResponse } from "next/server";

import { memberHasPermission } from "@/lib/auth/require-permission";
import { authenticateDevice, recordExtensionEvent } from "@/lib/extension/device-auth";
import { resolveThread } from "@/lib/extension/facebook-thread";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Tagging a customer from the side panel.
 *
 * The same tables the Inbox writes -- contact_tags for the tag, and
 * conversation_activity for the history entry, so a tag added beside Facebook
 * appears in Change History and the customer's timeline exactly like one added
 * on the website. There is no companion tag store and there must never be one.
 *
 * The permission check is the website's own: the member behind the browser
 * needs the same "customers" permission they would need in the Inbox, so
 * pairing a browser never widens what somebody can do.
 */

type Body = {
  pageId?: unknown;
  threadId?: unknown;
  tagId?: unknown;
  action?: unknown;
};

export async function POST(request: Request) {
  const auth = await authenticateDevice(request);

  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { device, member } = auth;

  if (!(await memberHasPermission(member, "customers", "manage"))) {
    return NextResponse.json(
      {
        success: false,
        error: "You do not have permission to change customer tags.",
      },
      { status: 403 },
    );
  }

  let body: Body;

  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }

  const tagId = typeof body.tagId === "string" ? body.tagId.trim() : "";
  const action = body.action === "remove" ? "remove" : "add";

  if (!tagId) {
    return NextResponse.json(
      { success: false, error: "A tag is required." },
      { status: 400 },
    );
  }

  const thread = await resolveThread(
    device.business_id,
    body.pageId,
    body.threadId,
  );

  if (!thread) {
    return NextResponse.json(
      {
        success: false,
        error: "TENH does not have this Facebook conversation.",
      },
      { status: 404 },
    );
  }

  const { data: tag } = await supabaseAdmin
    .from("tags")
    .select("id,name,color")
    .eq("id", tagId)
    .eq("business_id", device.business_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!tag) {
    return NextResponse.json(
      { success: false, error: "That tag is not available here." },
      { status: 404 },
    );
  }

  if (action === "add") {
    const { data: existing } = await supabaseAdmin
      .from("contact_tags")
      .select("contact_id")
      .eq("contact_id", thread.contactId)
      .eq("tag_id", tag.id as string)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, alreadyPresent: true });
    }

    const { error } = await supabaseAdmin
      .from("contact_tags")
      .insert({ contact_id: thread.contactId, tag_id: tag.id as string });

    if (error) {
      return NextResponse.json(
        { success: false, error: "Unable to add that tag." },
        { status: 500 },
      );
    }
  } else {
    const { error } = await supabaseAdmin
      .from("contact_tags")
      .delete()
      .eq("contact_id", thread.contactId)
      .eq("tag_id", tag.id as string);

    if (error) {
      return NextResponse.json(
        { success: false, error: "Unable to remove that tag." },
        { status: 500 },
      );
    }
  }

  const customerName = thread.contactName?.trim() || "Facebook customer";
  const actorName = member.full_name ?? "A team member";

  /* History is TENH's, not the companion's: the same activity types the
     website writes, so one timeline tells the whole story. */
  try {
    await createConversationActivity({
      businessId: device.business_id,
      conversationId: thread.conversationId,
      contactId: thread.contactId,
      actorMemberId: member.id,
      activityType: action === "add" ? "tag_added" : "tag_removed",
      title:
        action === "add"
          ? `added tag "${tag.name}"`
          : `removed tag "${tag.name}"`,
      description:
        action === "add"
          ? `${actorName} added the "${tag.name}" tag to ${customerName} from TENH Companion.`
          : `${actorName} removed the "${tag.name}" tag from ${customerName} in TENH Companion.`,
      customerName,
      actorName,
      metadata: {
        action: action === "add" ? "added" : "removed",
        source: "tenh_companion",
        tag: { id: tag.id, name: tag.name, color: tag.color },
        actor: { memberId: member.id, name: actorName, role: member.role },
      },
    });
  } catch (activityError) {
    console.error(
      "[TENH Companion] Tag changed, but activity could not be recorded:",
      activityError,
    );
  }

  void recordExtensionEvent({
    businessId: device.business_id,
    deviceId: device.id,
    memberId: member.id,
    userId: device.user_id,
    socialAccountId: thread.page.socialAccountId,
    conversationId: thread.conversationId,
    eventType: action === "add" ? "tag_added" : "tag_removed",
    status: "ok",
    metadata: { tagId: tag.id, tagName: tag.name },
  });

  return NextResponse.json({ success: true, tag });
}
