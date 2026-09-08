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
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") || scope.currentBusinessId;
    if (!scope.accessibleBusinessIds.includes(workspaceId) || workspaceId !== guard.context.member.business_id) {
      return NextResponse.json({ success: false, error: "Select an available workspace first." }, { status: 403 });
    }
    const rows = await getConversations([workspaceId], { workspaceId });

    /*
     * Projected down to what the phone draws. The loader is shared with the
     * web Inbox, which needs the whole row; sending all of it here costs
     * about half a megabyte on a workspace this size, and the phone reads
     * none of the difference. See MobileConversation.
     */
    const conversations: MobileConversation[] = rows.map((row) => ({
      id: row.id,
      status: row.status,
      unread_count: row.unread_count,
      last_message_text: row.last_message_text,
      last_message_at: row.last_message_at,
      is_pinned: row.is_pinned,
      assigned_to: row.assigned_to,
      source_type: row.source_type,

      contact: row.contact
        ? {
            id: row.contact.id,
            full_name: row.contact.full_name,
            profile_picture_url: row.contact.profile_picture_url,
            phone: row.contact.phone,
          }
        : null,

      social_account: row.social_account
        ? {
            id: row.social_account.id,
            platform: row.social_account.platform,
            account_name: row.social_account.account_name,
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
