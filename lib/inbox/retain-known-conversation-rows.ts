import type { InboxConversation } from "@/types/inbox";
import { isOlderConversationState } from "./live-sync";

/** Filtered/older server props are not a deletion signal for already hydrated
 * rows. Keep authorized rows for the client view predicates to qualify. */
export function retainKnownConversationRows(current: InboxConversation[], next: InboxConversation[],
  businessIds: string[], channelId: string, workspaceId: string) {
  const inScope = (row: InboxConversation) => businessIds.includes(row.business_id) &&
    (!channelId || row.social_account?.id === channelId) && (!workspaceId || row.business_id === workspaceId);
  const previous = new Map(current.map(row => [`${row.business_id}:${row.id}`, row]));
  const rows = next.filter(inScope).map(row => {
    const local = previous.get(`${row.business_id}:${row.id}`);
    return local && isOlderConversationState(local, row) ? local : row;
  });
  const keys = new Set(rows.map(row => `${row.business_id}:${row.id}`));
  for (const row of current) if (inScope(row) && !keys.has(`${row.business_id}:${row.id}`)) {
    rows.push(row); keys.add(`${row.business_id}:${row.id}`);
  }
  return rows;
}
