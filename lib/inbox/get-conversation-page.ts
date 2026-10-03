import { getSearchMatches } from "./get-search-matches";
import "server-only";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getConversations, getInboxConversationScope } from "@/lib/inbox/get-conversations";
import { sanitizeFilters, restrictFiltersToBusinesses } from "@/lib/inbox/page-filter-normalization";
import { CONVERSATION_PAGE_SIZE, type ConversationPage, type ConversationPageRequest } from "@/lib/inbox/conversation-page-contract";
import { uuidPattern } from "@/lib/inbox/live-sync";

export class ConversationPagingUnavailable extends Error {}

export async function getConversationPage(request: ConversationPageRequest, snapshot = false): Promise<ConversationPage> {
  const auth = await getCurrentMember();
  if (!auth.success) throw new Error("Unauthorized.");
  const scope = await getInboxConversationScope();
  for (const id of [request.workspaceId,request.workspaceContextId]) {
    if (id && !scope.accessibleBusinessIds.includes(id)) throw new Error("Workspace is outside your active Inbox access.");
  }
  const { data: members, error: memberError } = await supabaseAdmin.from("team_members").select("id,business_id")
    .eq("user_id",auth.user.id).eq("is_active",true).in("business_id",scope.accessibleBusinessIds);
  if (memberError) throw new Error("Unable to verify page memberships.");
  const { data: views, error: viewError } = await supabaseAdmin.from("inbox_saved_views").select("id,filters")
    .in("business_id",scope.accessibleBusinessIds).in("member_id",(members ?? []).map(row => row.id));
  if (viewError) {
    if (viewError.code === "42P01" || viewError.code === "PGRST205") throw new ConversationPagingUnavailable("Personal Smart Views migration is not installed.");
    throw new Error("Unable to load personal Smart Views.");
  }
  const normalizedViews = (views ?? []).map(row => ({ id: row.id, filters: restrictFiltersToBusinesses(sanitizeFilters(row.filters),scope.accessibleBusinessIds) }));
  const { data, error } = await supabaseAdmin.rpc("tenh_inbox_page", {
    p_user_id: auth.user.id, p_business_ids: scope.accessibleBusinessIds,
    p_request: { ...request, workspaceContextId: request.workspaceContextId ?? scope.currentBusinessId,
      memberIds: Object.fromEntries((members ?? []).map(row => [row.business_id,row.id])), size: CONVERSATION_PAGE_SIZE },
    p_views: normalizedViews, p_snapshot: snapshot,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new ConversationPagingUnavailable("Server paging migration is not installed.");
    throw new Error("Unable to query the Inbox page.");
  }
  const result = data as Omit<ConversationPage,"conversations"> & { ids: string[] };
  if (!result || !Array.isArray(result.ids) || result.ids.length > CONVERSATION_PAGE_SIZE || result.ids.some(id => typeof id !== "string" || !uuidPattern.test(id)) || !result.counts) throw new Error("Invalid Inbox page response.");
  const matchedKnownIds = result.matchedKnownIds ?? [];
  if (!Array.isArray(matchedKnownIds) || matchedKnownIds.length > 200 || matchedKnownIds.some(id => !request.knownIds?.includes(id))) throw new Error("Invalid targeted Inbox response.");
  const hydrateIds = [...new Set([...result.ids,...matchedKnownIds])];
  const hydrated = hydrateIds.length ? await getConversations(scope.accessibleBusinessIds,{ conversationIds: hydrateIds }) : [];
  const rows = new Map(hydrated.map(row => [row.id,row]));
  const searchMatches = await getSearchMatches(request.search, hydrated);
  return { ...result, searchMatches, matchedKnownIds, updates: matchedKnownIds.flatMap(id => rows.has(id) ? [rows.get(id)!] : []), conversations: result.ids.flatMap(id => rows.has(id) ? [rows.get(id)!] : []) };
}
