import { z } from "zod";
import { errorResult } from "@/lib/api/server";
import { syncRoute, unauthenticated } from "@/lib/offline/server/http";
import { buildReference } from "@/lib/offline/server/reference";

/** US-7-01: reference data for the device cache of one site (DTO allow-list, no sensitive fields). */
export const GET = syncRoute("platform.sync_reference.get", "GET", async ({ ctx, deviceKey, url }) => {
  if (!ctx) return unauthenticated();
  const siteId = url.searchParams.get("siteId") ?? ctx.currentSiteId;
  if (!z.uuid().safeParse(siteId).success) return errorResult(422, "VALIDATION", "siteId must be a UUID.");
  return { status: 200, body: { ok: true, data: await buildReference(ctx, siteId, deviceKey) } };
});
