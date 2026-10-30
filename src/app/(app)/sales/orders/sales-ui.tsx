import { Lock } from "lucide-react";
import { fmtMoney, fmtQty } from "@/lib/qty";
import { Chip } from "@/ui/status";

/** Sales order, quote, price-list and requirement states with icon-free text + colour + border (never colour alone). */
const TONES: Record<string, { tone: "ok" | "warn" | "bad" | "info" | "neu" | "appr" | "hold" | "rej" | "q" | "exp"; label: string }> = {
  draft: { tone: "neu", label: "Draft" },
  submitted: { tone: "info", label: "Submitted" },
  pending_approval: { tone: "warn", label: "Pending approval" },
  confirmed: { tone: "info", label: "Confirmed" },
  allocated: { tone: "appr", label: "Allocated" },
  picking: { tone: "appr", label: "Picking" },
  packed: { tone: "appr", label: "Packed" },
  partially_shipped: { tone: "warn", label: "Partially shipped" },
  shipped: { tone: "ok", label: "Shipped" },
  invoiced: { tone: "ok", label: "Invoiced" },
  closed: { tone: "neu", label: "Closed" },
  cancelled: { tone: "neu", label: "Cancelled" },
  sent: { tone: "info", label: "Sent" },
  accepted: { tone: "ok", label: "Accepted" },
  rejected: { tone: "rej", label: "Rejected" },
  expired: { tone: "exp", label: "Expired" },
  converted: { tone: "ok", label: "Converted" },
  voided: { tone: "neu", label: "Voided" },
  approved: { tone: "ok", label: "Approved" },
  retired: { tone: "neu", label: "Retired" },
  effective: { tone: "ok", label: "Effective" },
  scheduled: { tone: "info", label: "Scheduled" },
  prospect: { tone: "info", label: "Prospect" },
  active: { tone: "ok", label: "Active" },
  on_hold: { tone: "hold", label: "Credit hold" },
  inactive: { tone: "neu", label: "Inactive" },
};

export function SalesStatus({ status }: { status: string }) {
  const t = TONES[status] ?? { tone: "neu" as const, label: status.replace(/_/g, " ") };
  return <Chip tone={t.tone}>{t.label}</Chip>;
}

/**
 * Customer order status in the owner's words (mockup panel 6 chips; same words as the order's step strip
 * in src/ui/record-steps.ts). Display only; the state machine is ORDER_TRANSITIONS in the sales module.
 */
const PLAIN_ORDER: Record<string, { tone: "ok" | "warn" | "info" | "neu" | "appr"; label: string }> = {
  draft: { tone: "neu", label: "Draft" },
  submitted: { tone: "warn", label: "Waiting for approval" },
  pending_approval: { tone: "warn", label: "Waiting for approval" },
  confirmed: { tone: "info", label: "Confirmed" },
  allocated: { tone: "appr", label: "Stock reserved" },
  picking: { tone: "appr", label: "Packing" },
  packed: { tone: "appr", label: "Packing" },
  partially_shipped: { tone: "warn", label: "Partly shipped" },
  shipped: { tone: "ok", label: "Shipped" },
  invoiced: { tone: "ok", label: "Billed" },
  closed: { tone: "neu", label: "Done" },
  cancelled: { tone: "neu", label: "Cancelled" },
};

export function OrderChip({ status }: { status: string }) {
  const t = PLAIN_ORDER[status] ?? { tone: "neu" as const, label: status.replace(/_/g, " ") };
  return <Chip tone={t.tone}>{t.label}</Chip>;
}

/** Money or a lock when the caller may not see prices (the value never reached the page). */
export function Money({ value, className }: { value: string | null | undefined; className?: string }) {
  if (value === undefined)
    return (
      <span className={`inline-flex items-center gap-1 text-muted ${className ?? ""}`} title="Hidden: needs price permission">
        <Lock size={12} aria-hidden /> <span className="sr-only">Price hidden</span>—
      </span>
    );
  return <span className={className}>{value === null ? "—" : fmtMoney(value)}</span>;
}

export function MaskedNote({ fields }: { fields?: string[] }) {
  if (!fields?.length) return null;
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-muted">
      <Lock size={12} aria-hidden /> Some fields are hidden for your role.
    </p>
  );
}

/** Red "Late N days" chip for an order past its requested delivery date (rule: orderDaysLate in the sales module). */
export function LateChip({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <span data-testid="order-late" className="inline-flex">
      <Chip tone="bad">Late {days} {days === 1 ? "day" : "days"}</Chip>
    </span>
  );
}

/** Products on an order in plain words: "Acapulco Soap 135 g × 48, …" (SKU codes stay on the order page). */
export function linesSummary(lines: { sku: string; productName?: string | null; qty: string }[]): string {
  return lines.map((l) => `${l.productName || l.sku} × ${fmtQty(l.qty, "", 0)}`).join(", ");
}

export { historyLabel } from "./order-history";
