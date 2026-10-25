import { syncRoute } from "@/lib/offline/server/http";
import { replaySyncBatch } from "@/lib/offline/server/replay";

/** US-7-02: batch replay of offline commands (docs/offline-sync.md §4). Idempotent per command id. */
export const POST = syncRoute("platform.sync_command.replay", "POST", ({ ctx, body, deviceKey, requestId }) => replaySyncBatch(ctx, { body, deviceKey, requestId }));
