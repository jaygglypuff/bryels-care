import { CAPA_STATUS_LABEL, CHANGE_CONTROL_STATUS_LABEL, RECALL_CASE_STATUS_LABEL, type CapaStatus, type ChangeControlStatus, type RecallCaseStatus } from "@/modules/quality/capa-rules";
import { AlertOctagon, Ban, CheckCircle2, CircleDashed, PauseCircle, Search, Truck, Wrench, XCircle } from "lucide-react";
import { Chip } from "@/ui/status";

/** State chips of the W4C quality-system records: text label + colour + border, never colour alone. */
const CAPA_TONE: Record<CapaStatus, "info" | "appr" | "neu" | "ok" | "warn"> = { open: "warn", in_progress: "info", verification: "appr", closed: "ok", cancelled: "neu" };
/** Grade-5 words (ADR-088): the stored states stay. */
const CAPA_WORD: Record<CapaStatus, string> = { open: "New – add what to do", in_progress: "Being fixed", verification: "Checking the fix works", closed: "Done", cancelled: "Cancelled" };
const CAPA_ICON = { open: AlertOctagon, in_progress: Wrench, verification: Search, closed: CheckCircle2, cancelled: Ban } as const;
export function CapaStatusChip({ status }: { status: string }) {
  const I = CAPA_ICON[status as CapaStatus] ?? CircleDashed;
  return (
    <Chip tone={CAPA_TONE[status as CapaStatus] ?? "neu"}>
      <I size={13} aria-hidden />
      {CAPA_WORD[status as CapaStatus] ?? CAPA_STATUS_LABEL[status as CapaStatus] ?? status}
    </Chip>
  );
}

const CC_TONE: Record<ChangeControlStatus, "info" | "appr" | "neu" | "ok" | "rej"> = { draft: "neu", submitted: "appr", approved: "info", rejected: "rej", implemented: "ok", closed: "ok", cancelled: "neu" };
const CC_WORD: Record<ChangeControlStatus, string> = { draft: "Being written", submitted: "Waiting for approval", approved: "Approved – do the change", rejected: "Not approved", implemented: "Change made – to confirm", closed: "Done", cancelled: "Cancelled" };
const CC_ICON = { draft: CircleDashed, submitted: PauseCircle, approved: CheckCircle2, rejected: XCircle, implemented: Wrench, closed: CheckCircle2, cancelled: Ban } as const;
export function ChangeStatusChip({ status }: { status: string }) {
  const I = CC_ICON[status as ChangeControlStatus] ?? CircleDashed;
  return (
    <Chip tone={CC_TONE[status as ChangeControlStatus] ?? "neu"}>
      <I size={13} aria-hidden />
      {CC_WORD[status as ChangeControlStatus] ?? CHANGE_CONTROL_STATUS_LABEL[status as ChangeControlStatus] ?? status}
    </Chip>
  );
}

const RC_TONE: Record<RecallCaseStatus, "info" | "appr" | "neu" | "ok" | "bad" | "warn"> = { draft: "neu", submitted: "appr", approved: "warn", notifying: "bad", recovering: "warn", closed: "ok", cancelled: "neu" };
const RC_WORD: Record<RecallCaseStatus, string> = { draft: "Being prepared", submitted: "Waiting for approval", approved: "Approved – stop the stock", notifying: "Telling customers", recovering: "Getting the products back", closed: "Done", cancelled: "Cancelled" };
const RC_ICON = { draft: CircleDashed, submitted: PauseCircle, approved: AlertOctagon, notifying: AlertOctagon, recovering: Truck, closed: CheckCircle2, cancelled: Ban } as const;
export function RecallStatusChip({ status }: { status: string }) {
  const I = RC_ICON[status as RecallCaseStatus] ?? CircleDashed;
  return (
    <Chip tone={RC_TONE[status as RecallCaseStatus] ?? "neu"}>
      <I size={13} aria-hidden />
      {RC_WORD[status as RecallCaseStatus] ?? RECALL_CASE_STATUS_LABEL[status as RecallCaseStatus] ?? status}
    </Chip>
  );
}

export const filterLinkCls = (active: boolean) => `inline-flex min-h-[44px] items-center rounded-full border px-4 text-[14px] ${active ? "border-ring bg-primary-soft font-semibold" : "border-line hover:bg-surface-2"}`;
export const exportLinkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";
