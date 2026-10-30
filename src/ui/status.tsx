import { AlertOctagon, Ban, CheckCircle2, CircleDashed, Clock, Lock, PauseCircle, Truck, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./core";

type Tone = "ok" | "warn" | "bad" | "info" | "neu" | "q" | "hold" | "exp" | "rej" | "appr";
const TONE: Record<Tone, string> = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok-fg)] border-[var(--ok-bd)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn-fg)] border-[var(--warn-bd)]",
  bad: "bg-[var(--bad-bg)] text-[var(--bad-fg)] border-[var(--bad-bd)]",
  info: "bg-[var(--info-bg)] text-[var(--info-fg)] border-[var(--info-bd)]",
  neu: "bg-[var(--neu-bg)] text-[var(--neu-fg)] border-[var(--neu-bd)]",
  q: "bg-[var(--q-bg)] text-[var(--q-fg)] border-[var(--q-bd)]",
  hold: "bg-[var(--hold-bg)] text-[var(--hold-fg)] border-[var(--hold-bd)]",
  exp: "bg-[var(--exp-bg)] text-[var(--exp-fg)] border-[var(--exp-bd)]",
  rej: "bg-[var(--rej-bg)] text-[var(--rej-fg)] border-[var(--rej-bd)]",
  appr: "bg-[var(--appr-bg)] text-[var(--appr-fg)] border-[var(--appr-bd)]",
};

/** Icon + label + colour + border: risk states are never shown by colour alone. */
const STATES: Record<string, { tone: Tone; label: string; icon: ReactNode }> = {
  released: { tone: "ok", label: "Released", icon: <CheckCircle2 size={13} /> },
  quarantine: { tone: "q", label: "Waiting for QA", icon: <Lock size={13} /> },
  quarantined: { tone: "q", label: "In hold area", icon: <Lock size={13} /> },
  on_hold: { tone: "hold", label: "On quality hold", icon: <PauseCircle size={13} /> },
  expired: { tone: "exp", label: "Expired", icon: <Clock size={13} /> },
  recalled: { tone: "bad", label: "Recalled", icon: <AlertOctagon size={13} /> },
  rejected: { tone: "rej", label: "Rejected", icon: <XCircle size={13} /> },
  // batch / order states
  draft: { tone: "neu", label: "Draft", icon: <CircleDashed size={13} /> },
  planned: { tone: "neu", label: "Planned", icon: <CircleDashed size={13} /> },
  materials_staged: { tone: "info", label: "Materials ready", icon: <CircleDashed size={13} /> },
  in_process: { tone: "info", label: "Being made", icon: <CircleDashed size={13} /> },
  awaiting_qc: { tone: "appr", label: "Waiting for quality check", icon: <PauseCircle size={13} /> },
  closed: { tone: "neu", label: "Closed", icon: <CheckCircle2 size={13} /> },
  confirmed: { tone: "info", label: "Confirmed", icon: <CheckCircle2 size={13} /> },
  allocated: { tone: "appr", label: "Stock reserved", icon: <CheckCircle2 size={13} /> },
  shipped: { tone: "ok", label: "Shipped", icon: <Truck size={13} /> },
  cancelled: { tone: "neu", label: "Cancelled", icon: <Ban size={13} /> },
  pending: { tone: "neu", label: "Pending", icon: <CircleDashed size={13} /> },
  dispensed: { tone: "ok", label: "Weighed", icon: <CheckCircle2 size={13} /> },
  exception: { tone: "warn", label: "Exception", icon: <AlertOctagon size={13} /> },
  // W3E fulfilment: order, pick, pack, shipment and delivery receipt states
  picking: { tone: "info", label: "Picking", icon: <CircleDashed size={13} /> },
  packed: { tone: "appr", label: "Packed", icon: <CheckCircle2 size={13} /> },
  partially_shipped: { tone: "warn", label: "Partly shipped", icon: <Truck size={13} /> },
  picked: { tone: "info", label: "Picked", icon: <CheckCircle2 size={13} /> },
  dispatched: { tone: "ok", label: "Dispatched", icon: <Truck size={13} /> },
  delivered: { tone: "ok", label: "Delivered", icon: <CheckCircle2 size={13} /> },
  returned: { tone: "warn", label: "Returned", icon: <Truck size={13} /> },
  reversed: { tone: "neu", label: "Reversed", icon: <Ban size={13} /> },
  in_progress: { tone: "info", label: "In progress", icon: <CircleDashed size={13} /> },
  completed: { tone: "ok", label: "Completed", icon: <CheckCircle2 size={13} /> },
  open: { tone: "info", label: "Open", icon: <CircleDashed size={13} /> },
  verified: { tone: "ok", label: "Verified", icon: <CheckCircle2 size={13} /> },
  issued: { tone: "info", label: "Issued", icon: <CheckCircle2 size={13} /> },
  acknowledged: { tone: "ok", label: "Acknowledged", icon: <CheckCircle2 size={13} /> },
  voided: { tone: "neu", label: "Voided", icon: <Ban size={13} /> },
  // R3 record header: purchase order, goods receipt and sales order states without an entry above
  submitted: { tone: "appr", label: "Submitted", icon: <PauseCircle size={13} /> },
  pending_approval: { tone: "warn", label: "Pending approval", icon: <PauseCircle size={13} /> },
  approved: { tone: "info", label: "Approved", icon: <CheckCircle2 size={13} /> },
  sent: { tone: "info", label: "Sent", icon: <Truck size={13} /> },
  partially_received: { tone: "q", label: "Partly received", icon: <CircleDashed size={13} /> },
  received: { tone: "ok", label: "Received", icon: <CheckCircle2 size={13} /> },
  posted: { tone: "ok", label: "Posted", icon: <CheckCircle2 size={13} /> },
  invoiced: { tone: "ok", label: "Invoiced", icon: <CheckCircle2 size={13} /> },
};

export function StatusChip({ status, label, className }: { status: string; label?: string; className?: string }) {
  const s = STATES[status] ?? { tone: "neu" as Tone, label: status, icon: null };
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium", TONE[s.tone], className)}>
      {s.icon}
      {label ?? s.label}
    </span>
  );
}

export function Chip({ tone = "neu", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium", TONE[tone])}>{children}</span>;
}

export function Banner({ tone = "info", title, children, action }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx("flex flex-wrap items-start gap-3 rounded-[12px] border border-l-4 px-4 py-3", TONE[tone])}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-[13px]">{children}</div>}
      </div>
      {action}
    </div>
  );
}
