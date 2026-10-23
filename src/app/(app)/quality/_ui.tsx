import { ArrowRight } from "lucide-react";
import { fmtMass, fmtQty } from "@/lib/qty";
import { Chip, StatusChip } from "@/ui/status";

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
