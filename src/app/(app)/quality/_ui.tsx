import { ArrowRight } from "lucide-react";
import { fmtMass, fmtQty } from "@/lib/qty";
import { Chip, StatusChip } from "@/ui/status";
import { INSPECTION_STATUS_LABEL } from "@/modules/quality/inspection-rules";

/** Lot quantity in its base unit: grams shown as g/kg, pieces as whole numbers. */
export function fmtLotQty(v: string | null | undefined, uom: string | null | undefined) {
  if (uom === "g") return fmtMass(v);
  if (uom === "pcs") return fmtQty(v, "pcs", 0);
  return fmtQty(v, uom ?? "", 1);
}

const DECISION_LABEL: Record<string, string> = {
  release: "Release",
  release_from_hold: "Release from hold",
  hold: "Hold",
  reject: "Reject",
};

export function DecisionChip({ decision }: { decision: string }) {
  const tone = decision === "reject" ? "rej" : decision === "hold" ? "hold" : "ok";
  return <Chip tone={tone}>{DECISION_LABEL[decision] ?? decision}</Chip>;
}

export function Transition({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <StatusChip status={from} />
      <ArrowRight size={13} className="text-muted" aria-label="to" />
      <StatusChip status={to} />
    </span>
  );
}

/** Banner tone for a lot or batch status. */
export function statusTone(status: string) {
  return (
    ({ released: "ok", quarantine: "q", on_hold: "hold", rejected: "rej", expired: "exp", recalled: "bad", awaiting_qc: "appr" } as const)[status] ?? "neu"
  );
}

/** Inspection state (data-model §6.6) with the review outcome once approved. */
export function InspectionStatusChip({ status, outcome }: { status: string; outcome?: string | null }) {
  const tone = status === "approved" ? (outcome === "fail" ? "bad" : "ok") : status === "rejected" ? "rej" : status === "awaiting_review" ? "appr" : status === "cancelled" ? "neu" : "info";
  return (
    <Chip tone={tone}>
      {INSPECTION_STATUS_LABEL[status] ?? status}
      {status === "approved" && outcome ? ` · ${outcome}` : ""}
    </Chip>
  );
}

const DEVIATION_TONE = { open: "bad", investigating: "warn", closed: "neu" } as const;

/** Deviation state (open → investigating → closed). */
export function DeviationStatusChip({ status }: { status: string }) {
  return <Chip tone={DEVIATION_TONE[status as keyof typeof DEVIATION_TONE] ?? "neu"}>{status === "open" ? "Open" : status === "investigating" ? "Investigating" : "Closed"}</Chip>;
}
