import { AlertOctagon, Ban, CheckCircle2, CircleDashed, PauseCircle, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { Chip } from "./status";

/** Status chips for receiving, holds and suppliers (icon + label + colour, never colour alone). */
export function ReceiptStatusChip({ status }: { status: string }) {
  switch (status) {
    case "draft":
      return <Chip tone="neu"><CircleDashed size={13} /> Draft</Chip>;
    case "posted":
      return <Chip tone="ok"><CheckCircle2 size={13} /> Posted</Chip>;
    case "reversed":
      return <Chip tone="rej"><RotateCcw size={13} /> Reversed</Chip>;
    case "cancelled":
      return <Chip tone="neu"><Ban size={13} /> Cancelled</Chip>;
    default:
      return <Chip>{status}</Chip>;
  }
}

export function HoldStatusChip({ status }: { status: string }) {
  switch (status) {
    case "open":
      return <Chip tone="hold"><PauseCircle size={13} /> Open</Chip>;
    case "investigating":
      return <Chip tone="appr"><Search size={13} /> Investigating</Chip>;
    case "closed":
      return <Chip tone="neu"><CheckCircle2 size={13} /> Closed</Chip>;
    default:
      return <Chip>{status}</Chip>;
  }
}

export function SupplierStatusChip({ status }: { status: string }) {
  switch (status) {
    case "approved":
      return <Chip tone="ok"><ShieldCheck size={13} /> Approved</Chip>;
    case "conditional":
      return <Chip tone="warn"><PauseCircle size={13} /> Conditional</Chip>;
    case "suspended":
      return <Chip tone="bad"><AlertOctagon size={13} /> Suspended</Chip>;
    case "new":
      return <Chip tone="neu"><CircleDashed size={13} /> New</Chip>;
    default:
      return <Chip>{status}</Chip>;
  }
}

export function fmtBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
