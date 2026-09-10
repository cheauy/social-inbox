import { NextResponse } from "next/server";

import { authenticateDevice } from "@/lib/extension/device-auth";
import { resolveThread } from "@/lib/extension/facebook-thread";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Everything the side panel shows, read from the tables TENH already keeps.
 *
 * There is no companion copy of a tag, a quick reply, a note or an assignment,
 * and there must never be one: the panel is a second window onto the same
 * rows, so a tag added in Facebook is the tag the Inbox shows a second later
 * and the tag the phone shows after that. What this route adds is the one
 * thing TENH cannot know on its own -- which of its conversations the browser
 * is currently looking at.
 *
 * An unmatched thread returns matched:false with the workspace's quick replies
 * still attached. Those are useful on any screen; a customer's tags and notes
 * are not useful until TENH is certain whose they are.
 */

/* Enough for a panel, small enough to send every few seconds. */
const QUICK_REPLY_LIMIT = 40;
const NOTE_LIMIT = 5;

export async function GET(request: Request) {
  const auth = await authenticateDevice(request);

  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { device, member } = auth;
  const url = new URL(request.url);

  const thread = await resolveThread(
    device.business_id,
    url.searchParams.get("pageId"),
    url.searchParams.get("threadId"),
  );

  /* The workspace's own quick replies -- the same rows the Inbox picker and
     the phone read. Text only: the panel types into Facebook's box, and an
     attachment cannot be typed. */
  const { data: savedReplies } = await supabaseAdmin
    .from("saved_replies")
    .select("id,title,shortcut,message_text,category,sort_index")
    .eq("business_id", device.business_id)
    .eq("is_active", true)
    .order("sort_index", { ascending: true })
    .limit(QUICK_REPLY_LIMIT);

  const { data: workspaceTags } = await supabaseAdmin
    .from("tags")
    .select("id,name,color,sort_index")
    .eq("business_id", device.business_id)
    .eq("is_active", true)
    .order("sort_index", { ascending: true });

  /*
   * The badge count. Reused, not recalculated: unread_count is the column the
   * Inbox, the live-state route and the phone all read, so the number on the
   * extension icon is the number on the screen.
   */
  const { data: unreadRows } = await supabaseAdmin
    .from("conversations")
    .select("unread_count")
    .eq("business_id", device.business_id)
    .gt("unread_count", 0);

  const unreadTotal = (unreadRows ?? []).reduce(
    (total, row) => total + Math.max(0, (row.unread_count as number) ?? 0),
    0,
  );

  const base = {
    success: true,
    workspace: { businessId: device.business_id },
    member: { id: member.id, name: member.full_name, role: member.role },
    unreadTotal,
    quickReplies: (savedReplies ?? []).map((reply) => ({
      id: reply.id,
      title: reply.title,
      shortcut: reply.shortcut,
      text: reply.message_text,
      category: reply.category,
    })),
    tags: workspaceTags ?? [],
  };

  if (!thread) {
    return NextResponse.json({
      ...base,
      matched: false,
      reason: "no_matching_conversation",
    });
  }

  const [
    { data: conversation },
    { data: contact },
    { data: contactTags },
    { data: notes },
  ] = await Promise.all([
    supabaseAdmin
      .from("conversations")
      .select(
        "id,status,unread_count,is_pinned,assigned_to,last_message_at,assigned_member:team_members!conversations_assigned_to_fkey(id,full_name)",
      )
      .eq("id", thread.conversationId)
      .maybeSingle(),
    supabaseAdmin
      .from("contacts")
      .select("id,full_name,profile_picture_url,customer_note,phone,email")
      .eq("id", thread.contactId)
      .maybeSingle(),
    supabaseAdmin
      .from("contact_tags")
      .select("tag_id,tags(id,name,color)")
      .eq("contact_id", thread.contactId),
    supabaseAdmin
      .from("contact_notes")
      .select("id,note_text,created_at")
      .eq("contact_id", thread.contactId)
      .order("created_at", { ascending: false })
      .limit(NOTE_LIMIT),
  ]);

  const assigned = Array.isArray(conversation?.assigned_member)
    ? conversation?.assigned_member[0]
    : conversation?.assigned_member;

  return NextResponse.json({
    ...base,
    matched: true,
    page: {
      id: thread.page.pageId,
      name: thread.page.pageName,
      socialAccountId: thread.page.socialAccountId,
    },
    conversation: {
      id: thread.conversationId,
      status: conversation?.status ?? null,
      unreadCount: conversation?.unread_count ?? 0,
      isPinned: conversation?.is_pinned ?? false,
      assignedTo: assigned
        ? {
            id: (assigned as { id: string }).id,
            name: (assigned as { full_name: string | null }).full_name,
          }
        : null,
      lastMessageAt: conversation?.last_message_at ?? null,
    },
    customer: {
      id: thread.contactId,
      name: contact?.full_name ?? thread.contactName,
      profilePictureUrl: contact?.profile_picture_url ?? null,
      customerNote: contact?.customer_note ?? null,
      phone: contact?.phone ?? null,
      email: contact?.email ?? null,
      tags: (contactTags ?? [])
        .map((row) => {
          const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;

          return tag as { id: string; name: string; color: string } | null;
        })
        .filter(Boolean),
    },
    notes: (notes ?? []).map((note) => ({
      id: note.id,
      text: note.note_text,
      createdAt: note.created_at,
    })),
  });
}
