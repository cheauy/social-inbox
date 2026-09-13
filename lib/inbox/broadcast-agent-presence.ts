import type { RealtimeChannel } from "@supabase/supabase-js";

/** Use the socket while joined, and opt in to REST explicitly during reconnect. */
export async function broadcastAgentPresence(
  channel: RealtimeChannel,
  event: string,
  payload: Record<string, unknown>,
) {
  if (channel.state === "joined" && channel.socket.isConnected()) {
    const status = await channel.send({ type: "broadcast", event, payload });
    if (status !== "ok") {
      throw new Error(`Presence broadcast failed: ${status}`);
    }
    return;
  }

  const result = await channel.httpSend(event, payload);
  if (!result.success) {
    throw new Error(`Presence broadcast failed: ${result.error}`);
  }
}
