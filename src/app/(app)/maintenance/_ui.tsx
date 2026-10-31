import { AlertOctagon, Ban, CheckCircle2, CircleDashed, Clock, PauseCircle, Wrench } from "lucide-react";
import { type DueState, type MaintenanceWoStatus } from "@/modules/maintenance";
import { Chip } from "@/ui/status";

/**
 * Maintenance chips in grade-5 words (ADR-088): "regular maintenance" (PM plan) and "repair job" (maintenance
 * work order). Label + icon + colour + border, never colour alone. The stored states stay.
 */
const DUE_TONE: Record<DueState, "ok" | "info" | "warn" | "bad"> = { ok: "ok", due_soon: "info", due: "warn", overdue: "bad" };
const DUE_WORD: Record<DueState, string> = { ok: "Not due yet", due_soon: "Due soon", due: "Due today", overdue: "Late" };
const DUE_ICON = { ok: CheckCircle2, due_soon: Clock, due: Clock, overdue: AlertOctagon } as const;
export function DueChip({ state }: { state: string }) {
  const I = DUE_ICON[state as DueState] ?? Clock;
  return (
    <Chip tone={DUE_TONE[state as DueState] ?? "neu"}>
      <I size={13} aria-hidden />
      {DUE_WORD[state as DueState] ?? state}
    </Chip>
  );
}

const WO_TONE: Record<MaintenanceWoStatus, "info" | "appr" | "hold" | "ok" | "neu"> = { open: "info", in_progress: "appr", on_hold: "hold", completed: "ok", cancelled: "neu" };
const WO_WORD: Record<MaintenanceWoStatus, string> = { open: "To do", in_progress: "Being worked on", on_hold: "Paused", completed: "Done", cancelled: "Cancelled" };
const WO_ICON = { open: CircleDashed, in_progress: Wrench, on_hold: PauseCircle, completed: CheckCircle2, cancelled: Ban } as const;
export function WoStatusChip({ status }: { status: string }) {
  const I = WO_ICON[status as MaintenanceWoStatus] ?? CircleDashed;
  return (
    <Chip tone={WO_TONE[status as MaintenanceWoStatus] ?? "neu"}>
      <I size={13} aria-hidden />
      {WO_WORD[status as MaintenanceWoStatus] ?? status}
    </Chip>
  );
}
export const woWord = (s: string) => WO_WORD[s as MaintenanceWoStatus]?.toLowerCase() ?? s.replace(/_/g, " ");

export function PriorityChip({ priority }: { priority: string }) {
  if (priority === "normal" || priority === "low") return <span className="text-[12px] text-muted">{priority === "low" ? "can wait" : "normal"}</span>;
  return (
    <Chip tone={priority === "urgent" ? "bad" : "warn"}>
      <AlertOctagon size={13} aria-hidden />
      {priority === "urgent" ? "Urgent" : "Soon"}
    </Chip>
  );
}

/** What kind of job, in plain words. */
export const KIND_WORD: Record<string, string> = { preventive: "Regular maintenance", corrective: "Repair (something is broken)", inspection: "Check" };

/** Equipment state in plain words. */
export const EQUIPMENT_WORD: Record<string, string> = { in_service: "Working", maintenance: "Being repaired", out_of_service: "Broken – do not use", retired: "No longer used" };

export const PRIORITY_OPTIONS = [
  ["normal", "Normal"],
  ["high", "Soon"],
  ["urgent", "Urgent – production is stopped"],
  ["low", "Can wait"],
] as const;
