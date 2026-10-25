import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { workerHeartbeats } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Seconds without a heartbeat after which the worker counts as down (docs/deployment-railway.md §8.3: 300 s). */
const STALE_SECONDS = Number(process.env.WORKER_HEARTBEAT_STALE_SECONDS ?? 300);

/**
 * Worker liveness for the external uptime monitor (US-9-04, runbook §12.5). The worker cannot raise an
 * alert about itself being down, so the monitor polls this path: 200 while the newest heartbeat is
 * fresh, 503 when it is stale, missing, or the database does not answer. Public like /api/health and
 * /api/ready; it returns an age in seconds and nothing else (no host names, releases or variables).
 */
export async function GET() {
  try {
    const [hb] = await db.select({ at: workerHeartbeats.lastHeartbeatAt }).from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastHeartbeatAt)).limit(1);
    if (!hb) return Response.json({ ok: false, worker: "never_seen" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const age = Math.max(0, Math.round((Date.now() - hb.at.getTime()) / 1000));
    const ok = age <= STALE_SECONDS;
    return Response.json({ ok, worker: ok ? "up" : "stale", heartbeatAgeSeconds: age }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, database: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
