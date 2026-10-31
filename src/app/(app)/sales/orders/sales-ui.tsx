import type { ReactNode } from "react";
import { Ban, CheckCircle2, CircleDashed, Hourglass, Lock, PackageCheck, PauseCircle, Truck } from "lucide-react";
import { fmtMoney, fmtQty } from "@/lib/qty";
import { Chip } from "@/ui/status";

type Tone = "ok" | "warn" | "bad" | "info" | "neu" | "appr" | "hold" | "rej" | "q" | "exp";
type Word = { tone: Tone; label: string; icon: "wait" | "ok" | "stop" | "draft" | "truck" | "x" | "box" };

const ICONS: Record<Word["icon"], ReactNode> = {
  wait: <Hourglass size={13} aria-hidden />,
  ok: <CheckCircle2 size={13} aria-hidden />,
  stop: <PauseCircle size={13} aria-hidden />,
  draft: <CircleDashed size={13} aria-hidden />,
  truck: <Truck size={13} aria-hidden />,
  x: <Ban size={13} aria-hidden />,
  box: <PackageCheck size={13} aria-hidden />,
};

/**
 * Sales statuses in grade-5 words (ADR-088 sales pass), each with an icon, a colour and a border (never
 * colour alone). Display only: the state machines and the stored statuses are unchanged.
 */
const WORDS: Record<string, Word> = {
  draft: { tone: "neu", label: "Draft", icon: "draft" },
  submitted: { tone: "warn", label: "Waiting for approval", icon: "wait" },
  pending_approval: { tone: "warn", label: "Waiting for approval", icon: "wait" },
  confirmed: { tone: "info", label: "Confirmed", icon: "ok" },
  allocated: { tone: "appr", label: "Set aside", icon: "box" },
  picking: { tone: "appr", label: "Getting from shelf", icon: "box" },
  packed: { tone: "appr", label: "Box checked", icon: "box" },
  partially_shipped: { tone: "warn", label: "Partly sent out", icon: "truck" },
  shipped: { tone: "ok", label: "Sent out", icon: "truck" },
  invoiced: { tone: "ok", label: "Billed", icon: "ok" },
  closed: { tone: "neu", label: "Done", icon: "ok" },
  cancelled: { tone: "neu", label: "Cancelled", icon: "x" },
  sent: { tone: "info", label: "Sent to customer", icon: "truck" },
  accepted: { tone: "ok", label: "Customer said yes", icon: "ok" },
  rejected: { tone: "rej", label: "Not accepted", icon: "x" },
  expired: { tone: "exp", label: "Too old", icon: "x" },
  converted: { tone: "ok", label: "Made into an order", icon: "ok" },
  voided: { tone: "neu", label: "Cancelled", icon: "x" },
  approved: { tone: "ok", label: "Approved", icon: "ok" },
  retired: { tone: "neu", label: "No longer used", icon: "x" },
  effective: { tone: "ok", label: "In use now", icon: "ok" },
  scheduled: { tone: "info", label: "Starts later", icon: "wait" },
  prospect: { tone: "info", label: "New, not buying yet", icon: "draft" },
  active: { tone: "ok", label: "Active", icon: "ok" },
  on_hold: { tone: "hold", label: "Stopped: unpaid bills", icon: "stop" },
  inactive: { tone: "neu", label: "Not buying any more", icon: "x" },
};

/** The word alone (for option lists, banners and history). */
export const salesWord = (status: string) => WORDS[status]?.label ?? status.replace(/_/g, " ");

export function SalesStatus({ status }: { status: string }) {
  const t = WORDS[status] ?? { tone: "neu" as const, label: status.replace(/_/g, " "), icon: "draft" as const };
  return (
    <Chip tone={t.tone}>
      {ICONS[t.icon]}
      {t.label}
    </Chip>
  );
}

/** Customer order status (same words as the order's step strip in src/ui/record-steps.ts). */
export const OrderChip = SalesStatus;

/** Shipment and "get from shelf" status in grade-5 words: get from shelf, second check of the box, send out, delivered. */
const SHIP: Record<string, Word> = {
  draft: { tone: "info", label: "Getting from shelf", icon: "box" },
  picked: { tone: "warn", label: "Waiting for second check", icon: "wait" },
  packed: { tone: "appr", label: "Ready to send out", icon: "box" },
  dispatched: { tone: "ok", label: "Sent out", icon: "truck" },
  delivered: { tone: "ok", label: "Delivered", icon: "ok" },
  returned: { tone: "warn", label: "Came back", icon: "truck" },
  cancelled: { tone: "neu", label: "Cancelled", icon: "x" },
  reversed: { tone: "neu", label: "Sending undone", icon: "x" },
  in_progress: { tone: "info", label: "Getting from shelf", icon: "box" },
  completed: { tone: "ok", label: "Got everything", icon: "ok" },
};

export const shipWord = (status: string) => SHIP[status]?.label ?? salesWord(status);

export function ShipChip({ status }: { status: string }) {
  const t = SHIP[status] ?? WORDS[status] ?? { tone: "neu" as const, label: status.replace(/_/g, " "), icon: "draft" as const };
  return (
    <Chip tone={t.tone}>
      {ICONS[t.icon]}
      {t.label}
    </Chip>
  );
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

/** Products on an order in plain words: "Acapulco Soap 135 g × 48, …" (product codes stay on the order page). */
export function linesSummary(lines: { sku: string; productName?: string | null; qty: string }[]): string {
  return lines.map((l) => `${l.productName || l.sku} × ${fmtQty(l.qty, "", 0)}`).join(", ");
}

export { historyLabel } from "./order-history";
