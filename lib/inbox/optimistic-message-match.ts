/** Never acknowledge our pending send using a teammate's matching text/time. */
export function matchesOptimisticMessage(candidate: { id: string; conversation_id: string; platform_message_id?: string | null }, server: Record<string, unknown>) {
  if (server.direction !== "outgoing" || candidate.conversation_id !== server.conversation_id) return false;
  if (candidate.platform_message_id && !candidate.platform_message_id.startsWith("optimistic:") && candidate.platform_message_id === server.platform_message_id) return true;
  const raw = server.raw_payload as Record<string, unknown> | null;
  const message = raw?.message as Record<string, unknown> | null;
  return raw?.tenh_client_request_id === candidate.id || message?.metadata === candidate.id;
}
