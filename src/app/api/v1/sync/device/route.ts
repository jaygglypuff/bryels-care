import { requestDeviceRegistration } from "@/lib/offline/server/devices";
import { syncRoute, unauthenticated } from "@/lib/offline/server/http";

/** US-7-06: ask for this device to be registered at a site (self-service; an administrator activates it). */
export const POST = syncRoute("platform.device.request", "POST", async ({ ctx, body }) => {
  if (!ctx) return unauthenticated();
  return { status: 200, body: { ok: true, data: await requestDeviceRegistration(ctx, body) } };
});
