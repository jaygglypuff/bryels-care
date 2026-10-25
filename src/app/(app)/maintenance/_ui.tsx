import { DUE_STATE_LABEL, MWO_STATUS_LABEL, type DueState, type MaintenanceWoStatus } from "@/modules/maintenance";
import { Chip } from "@/ui/status";

/** Maintenance chips: label + colour + border (never colour alone). */
const DUE_TONE: Record<DueState, "ok" | "info" | "warn" | "bad"> = { ok: "ok", due_soon: "info", due: "warn", overdue: "bad" };
export function DueChip({ state }: { state: string }) {
  return <Chip tone={DUE_TONE[state as DueState] ?? "neu"}>{DUE_STATE_LABEL[state as DueState] ?? state}</Chip>;
}

const WO_TONE: Record<MaintenanceWoStatus, "info" | "appr" | "hold" | "ok" | "neu"> = { open: "info", in_progress: "appr", on_hold: "hold", completed: "ok", cancelled: "neu" };
export function WoStatusChip({ status }: { status: string }) {
  return <Chip tone={WO_TONE[status as MaintenanceWoStatus] ?? "neu"}>{MWO_STATUS_LABEL[status as MaintenanceWoStatus] ?? status}</Chip>;
}

export function PriorityChip({ priority }: { priority: string }) {
  if (priority === "normal" || priority === "low") return <span className="text-[12px] text-muted">{priority}</span>;
  return <Chip tone={priority === "urgent" ? "bad" : "warn"}>{priority}</Chip>;
}

export const tabCls = (active: boolean) => `rounded-full border px-3 py-1 text-[13px] ${active ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2"}`;
