import { maintenanceModeOn } from "@/lib/maintenance-mode";

export const dynamic = "force-dynamic";
/** Liveness. Keeps answering while MAINTENANCE_MODE=1 and says so (ADR-115 §4). */
export function GET() {
  return Response.json({ ok: true, service: "web", maintenance: maintenanceModeOn(process.env.MAINTENANCE_MODE), time: new Date().toISOString() });
}
