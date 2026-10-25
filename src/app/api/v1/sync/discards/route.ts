import { recordDiscardedCommands } from "@/lib/offline/server/conflicts";
import { syncRoute, unauthenticated } from "@/lib/offline/server/http";

/** US-7-06: audit queued commands the person discards on the device (logout warning, remove from queue). */
export const POST = syncRoute("platform.sync_command.discard", "POST", async ({ ctx, body }) => {
  if (!ctx) return unauthenticated();
  return { status: 200, body: { ok: true, data: await recordDiscardedCommands(ctx, body) } };
});
