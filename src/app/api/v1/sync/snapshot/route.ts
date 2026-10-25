import { syncRoute, unauthenticated } from "@/lib/offline/server/http";
import { buildAuthSnapshot } from "@/lib/offline/server/snapshot";

/** US-7-03: the authorization snapshot the device keeps for offline decisions (refreshed on every sync). */
export const GET = syncRoute("platform.sync_snapshot.get", "GET", async ({ ctx, deviceKey }) => {
  if (!ctx) return unauthenticated();
  return { status: 200, body: { ok: true, data: await buildAuthSnapshot(ctx, deviceKey) } };
});
