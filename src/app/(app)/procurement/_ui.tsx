import Link from "next/link";
import type { ReactNode } from "react";
import Decimal from "decimal.js";
import { PO_STATUS_LABEL, PR_STATUS_LABEL, SR_STATUS_LABEL, type PoStatus, type PrStatus, type SrStatus } from "@/modules/procurement";
import { cx } from "@/ui/core";
import { Chip } from "@/ui/status";

/** Shared display helpers of the procurement screens (Wave 4 W4A). No business logic here. */

const PO_TONE: Record<PoStatus, "neu" | "appr" | "info" | "q" | "ok" | "warn"> = { draft: "neu", submitted: "appr", approved: "info", sent: "info", partially_received: "q", received: "ok", closed: "neu", cancelled: "neu" };
const PR_TONE: Record<PrStatus, "neu" | "appr" | "ok" | "bad" | "info"> = { draft: "neu", submitted: "appr", approved: "ok", rejected: "bad", converted: "info", cancelled: "neu" };
const SR_TONE: Record<SrStatus, "neu" | "appr" | "info" | "ok"> = { draft: "neu", submitted: "appr", approved: "info", posted: "ok", cancelled: "neu" };

export const PoChip = ({ status }: { status: string }) => <Chip tone={PO_TONE[status as PoStatus] ?? "neu"}>{PO_STATUS_LABEL[status as PoStatus] ?? status}</Chip>;
export const PrChip = ({ status }: { status: string }) => <Chip tone={PR_TONE[status as PrStatus] ?? "neu"}>{PR_STATUS_LABEL[status as PrStatus] ?? status}</Chip>;
export const SrChip = ({ status }: { status: string }) => <Chip tone={SR_TONE[status as SrStatus] ?? "neu"}>{SR_STATUS_LABEL[status as SrStatus] ?? status}</Chip>;

/** Base-unit quantity shown in the purchase unit people use (g → kg, mL → L). */
export function fmtBase(qty: string | number | null | undefined, uom: string): string {
  if (qty === null || qty === undefined) return "—";
  const d = new Decimal(qty);
  if (uom === "g" && d.abs().gte(1000)) return `${d.div(1000).toDecimalPlaces(3).toString()} kg`;
  if (uom === "mL" && d.abs().gte(1000)) return `${d.div(1000).toDecimalPlaces(3).toString()} L`;
  return `${d.toDecimalPlaces(3).toString()} ${uom}`;
}

export function money(v: string | null | undefined, currency = "PHP"): string {
  if (v === null || v === undefined) return "—";
  return `${currency} ${new Decimal(v).toNumber().toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FilterPills({ base, current, items }: { base: string; current: string; items: readonly (readonly [string, string])[] }) {
  return (
    <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter">
      {items.map(([v, label]) => (
        <Link key={v} href={`${base}?status=${v}`} className={cx("rounded-full border px-3 py-1 text-[13px]", current === v ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2")}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function SubNav() {
  const items: [string, string][] = [
    ["/procurement", "Overview"],
    ["/procurement/requests", "Requests"],
    ["/procurement/orders", "Purchase orders"],
    ["/procurement/expected", "Expected receipts"],
    ["/procurement/returns", "Supplier returns"],
    ["/procurement/suppliers", "Approved suppliers"],
    ["/procurement/reorder", "Reorder"],
    ["/procurement/performance", "Performance"],
    ["/procurement/forecast", "Forecast"],
  ];
  return (
    <nav aria-label="Procurement" className="mb-4 flex gap-2 overflow-x-auto pb-1 text-[13px]">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className="whitespace-nowrap rounded-full border border-line px-3 py-1 hover:bg-surface-2">
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function Steps({ steps }: { steps: { step: number; label: string; done: boolean; approvals: { name: string; at: Date }[] }[] }): ReactNode {
  if (!steps.length) return <p className="text-[13px] text-muted">No approval rule applies; one approver with the approve permission decides.</p>;
  return (
    <ol className="flex flex-col gap-1 text-[13px]">
      {steps.map((s) => (
        <li key={s.step}>
          <span className="font-medium">Step {s.step}:</span> {s.label} — {s.done ? `approved by ${s.approvals.map((a) => a.name).join(", ")}` : "waiting"}
        </li>
      ))}
    </ol>
  );
}
