import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowRightLeft, Factory, PackageCheck, PackageMinus, Scale, Truck, Undo2 } from "lucide-react";
import { daysUntil, fmtDate } from "@/lib/qty";
import { BOX_STATUS_WORDS, LOCATION_KIND_WORDS, LOT_STATUS_WORDS, MOVEMENT_LABEL, fmtLotQty, placeWords } from "./words";
import { Chip, StatusChip } from "@/ui/status";
import { lotDisplayStatus } from "./lot-status";

export { lotDisplayStatus };
export { BOX_STATUS_WORDS, LOCATION_KIND_WORDS, LOT_STATUS_WORDS, MOVEMENT_LABEL, fmtLotQty, placeWords };


/** Expiry date with days left: red when expired, amber within the warning window (30 days). */
export function Expiry({ date, warnDays = 30, compact = false }: { date: string | null; warnDays?: number; compact?: boolean }) {
  if (!date) return <span className="text-muted">No expiry</span>;
  const d = daysUntil(date)!;
  const tone = d < 0 ? "text-[var(--bad-fg)] font-semibold" : d <= warnDays ? "text-[var(--warn-fg)] font-semibold" : "text-muted";
  const left = d < 0 ? `expired ${-d} ${-d === 1 ? "day" : "days"} ago` : d === 0 ? "expires today" : `${d} ${d === 1 ? "day" : "days"} left`;
  return (
    <span className="whitespace-nowrap">
      {fmtDate(date)}
      <span className={`${compact ? "ml-1.5" : "block"} text-[12px] ${tone}`}>{left}</span>
    </span>
  );
}


/**
 * Lot quality status for lists. A lot whose expiry date has passed shows "Expired" even while its
 * stored status is still released / waiting / on hold (the nightly expiry job may not have run yet),
 * so a list never says "Ready to use" next to "expired 2 days ago". Icon + plain words.
 */
export function LotStatusChip({ status, expiresOn, className }: { status: string; expiresOn?: string | null; className?: string }) {
  const s = lotDisplayStatus(status, expiresOn ?? null);
  return <StatusChip status={s} label={LOT_STATUS_WORDS[s]} className={className} />;
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
  return <Chip tone={KIND_TONE[kind] ?? "neu"}>{LOCATION_KIND_WORDS[kind] ?? kind}</Chip>;
}


const MOVEMENT_LOOK: Record<string, { tone: "ok" | "info" | "warn" | "neu" | "appr"; icon: ReactNode }> = {
  receipt: { tone: "ok", icon: <ArrowDownToLine size={13} aria-hidden /> },
  issue: { tone: "info", icon: <Truck size={13} aria-hidden /> },
  transfer: { tone: "info", icon: <ArrowRightLeft size={13} aria-hidden /> },
  consumption: { tone: "appr", icon: <PackageMinus size={13} aria-hidden /> },
  output: { tone: "ok", icon: <Factory size={13} aria-hidden /> },
  adjustment: { tone: "warn", icon: <Scale size={13} aria-hidden /> },
  shipment: { tone: "neu", icon: <PackageCheck size={13} aria-hidden /> },
  reversal: { tone: "warn", icon: <Undo2 size={13} aria-hidden /> },
  return: { tone: "info", icon: <Undo2 size={13} aria-hidden /> },
};

/** A stock change type as a chip with an icon (never colour alone). */
export function MovementChip({ type }: { type: string }) {
  const l = MOVEMENT_LOOK[type] ?? { tone: "neu" as const, icon: null };
  return (
    <Chip tone={l.tone}>
      {l.icon}
      {MOVEMENT_LABEL[type] ?? type}
    </Chip>
  );
}


