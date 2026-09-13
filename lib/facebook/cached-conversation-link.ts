import "server-only";
import { conversationLinkFromThread, getCustomerConversationThread } from "@/lib/facebook/customer-conversation-link";

type Context = {
  businessId: string;
  conversationId: string;
  socialAccountId: string;
  pageId: string;
  recipientId: string;
  connectionVersion: string | null;
};
type Result = Awaited<ReturnType<typeof getCustomerConversationThread>>;
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 256;
const cache = new Map<string, { expiresAt: number; result: Promise<Result> }>();

/** Call only after checking current membership and the connected Page.
 * Process-local, bounded cache: no tokens or browser observations are saved.
 * Cold server instances simply perform a fresh Meta lookup. */
export async function getCachedConversationThread(context: Context, accessToken: string, refresh = false) {
  const key = JSON.stringify([context.businessId, context.conversationId, context.socialAccountId,
    context.pageId, context.recipientId, context.connectionVersion, process.env.FACEBOOK_GRAPH_API_VERSION || "v26.0"]);
  const now = Date.now();
  for (const [oldKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(oldKey);
  if (refresh) cache.delete(key);
  const existing = cache.get(key);
  if (existing) return { thread: await existing.result, cacheUsed: true };
  while (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  const entry = { expiresAt: now + TTL_MS, result: getCustomerConversationThread(context.pageId, context.recipientId, { accessToken }) };
  cache.set(key, entry);
  try {
    const thread = await entry.result;
    if (cache.get(key) === entry) {
      if ("reason" in thread) cache.delete(key);
      else entry.expiresAt = Date.now() + TTL_MS;
    }
    return { thread, cacheUsed: false };
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }
}

export async function getCachedConversationLink(context: Context, accessToken: string, refresh = false) {
  const { thread, cacheUsed } = await getCachedConversationThread(context, accessToken, refresh);
  return { link: "reason" in thread ? thread : conversationLinkFromThread(thread, context.pageId, context.recipientId, { requireCustomerName: false }), cacheUsed };
}
