import { NextRequest, NextResponse } from "next/server";
import { getConversationPage, ConversationPagingUnavailable } from "@/lib/inbox/get-conversation-page";
import { parseConversationPageRequest } from "@/lib/inbox/conversation-page-contract";
import { withTenantReadScope } from "@/lib/server/tenant-read-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withTenantReadScope(async (request: NextRequest) => {
  let body, filter;
  try { body = await request.json(); filter = parseConversationPageRequest(body); }
  catch (error) { return NextResponse.json({ success:false,error:error instanceof Error ? error.message : "Invalid request." },{status:400}); }
  try {
    const page = await getConversationPage(filter,body.snapshot === true);
    return NextResponse.json({success:true,page},{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    return NextResponse.json({success:false,error:error instanceof ConversationPagingUnavailable ? error.message : "Unable to load this Inbox page."},
      {status:error instanceof ConversationPagingUnavailable ? 503 : 500,headers:{"Cache-Control":"private, no-store"}});
  }
});
