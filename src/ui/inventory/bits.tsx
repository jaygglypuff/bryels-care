import { daysUntil, fmtDate, fmtMass, fmtQty } from "@/lib/qty";
import { Chip } from "@/ui/status";

/** Quantity in a lot's base unit: grams shown as kg above 1,000 g, pieces as whole numbers. */
export function fmtLotQty(v: string | null | undefined, uom: string): string {
  if (uom === "g") return fmtMass(v);
  if (uom === "pcs") return fmtQty(v, "pcs", 0);
  return fmtQty(v, uom, 1);
}

/** Expiry date with days left: red when expired, amber within the warning window (30 days). */
export function Expiry({ date, warnDays = 30, compact = false }: { date: string | null; warnDays?: number; compact?: boolean }) {
  if (!date) return <span className="text-muted">No expiry</span>;
  const d = daysUntil(date)!;
  const tone = d < 0 ? "text-[var(--bad-fg)] font-semibold" : d <= warnDays ? "text-[var(--warn-fg)] font-semibold" : "text-muted";
  const left = d < 0 ? `expired ${-d} d ago` : d === 0 ? "expires today" : `${d} d left`;
  return (
    <span className="whitespace-nowrap">
      {fmtDate(date)}
      <span className={`${compact ? "ml-1.5" : "block"} text-[12px] ${tone}`}>{left}</span>
    </span>
  );
}

const KIND_TONE: Record<string, "ok" | "q" | "hold" | "rej" | "info" | "neu" | "appr"> = {
  storage: "ok",
  quarantine: "q",
  hold: "hold",
  rejected: "rej",
  receiving: "info",
  production: "appr",
  shipping: "neu",
};

export function LocationKindChip({ kind }: { kind: string }) {
  return <Chip tone={KIND_TONE[kind] ?? "neu"}>{kind[0].toUpperCase() + kind.slice(1)}</Chip>;
}

export const MOVEMENT_LABEL: Record<string, string> = {
  receipt: "Receipt",
  issue: "Issue (inter-site out)",
  transfer: "Transfer",
  consumption: "Consumption",
  output: "Production output",
  adjustment: "Adjustment",
  shipment: "Shipment",
  reversal: "Reversal",
};
