/**
 * Realtime fan-out for live timing and paddock chat.
 *
 * Clients poll as the baseline, which works with no external service. When
 * Pusher credentials are present each update is also pushed over a channel so
 * boards refresh instantly instead of on the next poll tick.
 */

interface PusherConfig {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

function pusherConfig(): PusherConfig | null {
  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } =
    process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    return null;
  }
  return {
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
  };
}

export function isRealtimeConfigured(): boolean {
  return pusherConfig() !== null;
}

/**
 * Best-effort broadcast. A realtime failure must never fail the mutation that
 * produced the update — the data is already committed and pollers will pick
 * it up regardless.
 */
async function broadcast(channel: string, event: string): Promise<void> {
  const config = pusherConfig();
  if (!config) return;
  try {
    const { default: Pusher } = await import("pusher");
    const client = new Pusher({
      appId: config.appId,
      key: config.key,
      secret: config.secret,
      cluster: config.cluster,
      useTLS: true,
    });
    // The payload is intentionally empty: receivers refetch through tRPC so
    // authorization is applied on the way out.
    await client.trigger(channel, event, {});
  } catch (error) {
    console.error("Realtime broadcast failed (non-fatal):", error);
  }
}

export async function broadcastTimingUpdate(sessionId: string): Promise<void> {
  await broadcast(`timing-${sessionId}`, "update");
}

export async function broadcastChatMessage(eventId: string): Promise<void> {
  await broadcast(`paddock-${eventId}`, "message");
}
