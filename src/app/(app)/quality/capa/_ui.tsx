import { CAPA_STATUS_LABEL, CHANGE_CONTROL_STATUS_LABEL, RECALL_CASE_STATUS_LABEL, type CapaStatus, type ChangeControlStatus, type RecallCaseStatus } from "@/modules/quality/capa-rules";
import { Chip } from "@/ui/status";

/** State chips of the W4C quality-system records: text label + colour + border, never colour alone. */
const CAPA_TONE: Record<CapaStatus, "info" | "appr" | "neu" | "ok" | "warn"> = { open: "info", in_progress: "info", verification: "appr", closed: "ok", cancelled: "neu" };
export function CapaStatusChip({ status }: { status: string }) {
  return <Chip tone={CAPA_TONE[status as CapaStatus] ?? "neu"}>{CAPA_STATUS_LABEL[status as CapaStatus] ?? status}</Chip>;
}

const CC_TONE: Record<ChangeControlStatus, "info" | "appr" | "neu" | "ok" | "rej"> = { draft: "neu", submitted: "appr", approved: "info", rejected: "rej", implemented: "ok", closed: "ok", cancelled: "neu" };
export function ChangeStatusChip({ status }: { status: string }) {
  return <Chip tone={CC_TONE[status as ChangeControlStatus] ?? "neu"}>{CHANGE_CONTROL_STATUS_LABEL[status as ChangeControlStatus] ?? status}</Chip>;
}

const RC_TONE: Record<RecallCaseStatus, "info" | "appr" | "neu" | "ok" | "bad" | "warn"> = { draft: "neu", submitted: "appr", approved: "warn", notifying: "bad", recovering: "warn", closed: "ok", cancelled: "neu" };
export function RecallStatusChip({ status }: { status: string }) {
  return <Chip tone={RC_TONE[status as RecallCaseStatus] ?? "neu"}>{RECALL_CASE_STATUS_LABEL[status as RecallCaseStatus] ?? status}</Chip>;
}

export const filterLinkCls = (active: boolean) => `rounded-full border px-3 py-1 text-[13px] ${active ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2"}`;
export const exportLinkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";
