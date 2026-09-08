import { NextRequest, NextResponse } from "next/server";
import { loadPermissionContext } from "@/lib/auth/require-permission";
import { getConversations, getInboxConversationScope } from "@/lib/inbox/get-conversations";

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
    const conversations = await getConversations([workspaceId], { workspaceId });
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
