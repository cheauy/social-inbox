import { NextRequest, NextResponse } from "next/server";
import { loadPermissionContext } from "@/lib/auth/require-permission";
import { getConversations, getInboxConversationScope } from "@/lib/inbox/get-conversations";
import type { MobileConversation } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A read-only adapter for the same loader used by the web Inbox. Authentication,
// membership, enabled channels and subscription eligibility remain server-owned.
export async function GET(request: NextRequest) {
  const guard = await loadPermissionContext();
  if (!guard.success) return guard.response;
  try {
    const scope = await getInboxConversationScope();
    const active = guard.context.member.business_id;

    /*
     * One workspace, or several merged into one list.
     *
     * The phone can ask for `workspaceIds` -- a comma-separated list -- when
     * somebody runs two shops and wants both inboxes in one place. Every id
     * is checked against the memberships this session actually has, and the
     * active workspace has to be among them: writing (send, assign, tag) is
     * still scoped by the active-business cookie server-side, so a merged
     * read that did not include the workspace being written to would show
     * threads nobody could safely answer.
     */
    const requested = (
      request.nextUrl.searchParams.get("workspaceIds") ||
      request.nextUrl.searchParams.get("workspaceId") ||
      scope.currentBusinessId
    )
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const workspaceIds = Array.from(new Set(requested));

    if (
      workspaceIds.length === 0 ||
      workspaceIds.some((id) => !scope.accessibleBusinessIds.includes(id)) ||
      !workspaceIds.includes(active)
    ) {
      return NextResponse.json({ success: false, error: "Select an available workspace first." }, { status: 403 });
    }

    /*
     * The single-id filter collapses the scope back down to one workspace, so
     * it is only passed when one was asked for.
     */
    const rows = await getConversations(
      workspaceIds,
      workspaceIds.length === 1 ? { workspaceId: workspaceIds[0] } : undefined,
    );

    /*
     * Projected down to what the phone draws. The loader is shared with the
     * web Inbox, which needs the whole row; sending all of it here costs
     * about half a megabyte on a workspace this size, and the phone reads
     * none of the difference. See MobileConversation.
     */
    const conversations: MobileConversation[] = rows.map((row) => ({
      id: row.id,
      /* Which workspace it belongs to -- the merged list needs it to label a
         row and to switch context before opening it. */
      business_id: row.business_id,
      status: row.status,
      unread_count: row.unread_count,
      last_message_text: row.last_message_text,
      last_message_at: row.last_message_at,
      is_pinned: row.is_pinned,
      assigned_to: row.assigned_to,
      source_type: row.source_type,
      facebook_post_id: row.facebook_post_id,
      facebook_comment_id: row.facebook_comment_id,
      parent_comment_id: row.parent_comment_id,

      contact: row.contact
        ? {
            id: row.contact.id,
            full_name: row.contact.full_name,
            profile_picture_url: row.contact.profile_picture_url,
            phone: row.contact.phone,
            platform_user_id: row.contact.platform_user_id,
            tags: (row.contact.tags ?? []).map((tag) => ({
              id: tag.id,
              name: tag.name,
              color: tag.color,
            })),
          }
        : null,

      social_account: row.social_account
        ? {
            id: row.social_account.id,
            platform: row.social_account.platform,
            account_name: row.social_account.account_name,
            platform_account_id: row.social_account.platform_account_id,
          }
        : null,
    }));

    const { member, permissions } = guard.context;
    return NextResponse.json({
      success: true,
      member: { id: member.id, full_name: member.full_name, email: member.email, role: member.role, profile_picture_url: member.profile_picture_url },
      permissions,
      conversations,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ success: false, error: "Unable to load Inbox. Please try again." }, { status: 500 });
  }
}
