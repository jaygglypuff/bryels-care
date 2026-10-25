import Link from "next/link";
import { fmtDateTime } from "@/lib/qty";
import { Card, CardTitle } from "./core";
import { Chip } from "./status";

export type SyncDiagnostics = {
  backlog: number;
  stuck: number;
  applied24h: number;
  refused24h: number;
  skewFlagged24h: number;
  openConflicts: number;
  oldestOpenConflictAt: Date | null;
  devices: { active: number; pending: number; suspended: number; stale: number; maxClockSkewSeconds: number };
};

/** Diagnostics Sync card (US-7-06, FR-platform-09 Phase 7 part): counts only, never payloads or device keys. */
export function SyncDiagnosticsCard({ d }: { d: SyncDiagnostics }) {
  const rows: [string, number, "ok" | "warn" | "bad"][] = [
    ["Commands waiting on the server", d.backlog, d.stuck ? "bad" : d.backlog ? "warn" : "ok"],
    ["Waiting more than 5 min", d.stuck, d.stuck ? "bad" : "ok"],
    ["Applied in 24 h", d.applied24h, "ok"],
    ["Refused in 24 h", d.refused24h, d.refused24h ? "warn" : "ok"],
    ["Clock difference flagged in 24 h", d.skewFlagged24h, d.skewFlagged24h ? "warn" : "ok"],
    ["Open conflicts", d.openConflicts, d.openConflicts ? "warn" : "ok"],
    ["Registered devices", d.devices.active, "ok"],
    ["Devices waiting for approval", d.devices.pending, d.devices.pending ? "warn" : "ok"],
    ["Registered devices without sync for 24 h", d.devices.stale, d.devices.stale ? "warn" : "ok"],
  ];
  return (
    <Card id="sync">
      <CardTitle action={<Link href="/sync/conflicts" className="text-[13px] font-medium text-primary-text hover:underline">Conflict queue</Link>}>Sync</CardTitle>
      <ul className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2" data-testid="sync-diagnostics">
        {rows.map(([k, v, tone]) => (
          <li key={k} className="flex items-center justify-between gap-2">
            <span className="text-fg-2">{k}</span>
            <Chip tone={tone}>{v}</Chip>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted">
        {d.oldestOpenConflictAt ? `Oldest open conflict ${fmtDateTime(d.oldestOpenConflictAt)}. ` : ""}
        {d.devices.maxClockSkewSeconds > 600 ? `A device clock was off by up to ${Math.round(d.devices.maxClockSkewSeconds / 60)} min. ` : ""}
        {d.devices.suspended ? `${d.devices.suspended} device(s) suspended.` : ""}
      </p>
    </Card>
  );
}
