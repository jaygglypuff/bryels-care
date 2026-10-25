import Link from "next/link";
import { portalStatusTone } from "@/modules/portal";
import { fmtDate } from "@/lib/qty";
import { Chip } from "@/ui/status";

/** Customer-facing order status (icon-free chip with words; never colour alone). */
export function PortalStatus({ status, label }: { status: string; label: string }) {
  return <Chip tone={portalStatusTone(status)}>{label}</Chip>;
}

/** "PHP 51,600.00" from a decimal string (never a float in arithmetic; formatting only). */
export function money(value: string, currency = "PHP") {
  const [int, dec = "00"] = value.split(".");
  return `${currency} ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec.padEnd(2, "0").slice(0, 2)}`;
}

export function pcs(qty: string) {
  return `${qty.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} pcs`;
}

/** Stacked order cards for phones and tables alike (no horizontal scrolling at 390 px). */
export function OrderCards({ orders }: { orders: { id: string; orderNumber: string; status: string; statusLabel: string; placedAt: Date; requestedDeliveryOn: string | null; customerPoNumber: string | null; totalAmount: string; currency: string; lineCount: number }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/portal/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[18px] border border-line bg-surface px-4 py-3 transition-colors hover:border-[var(--brand-300)] hover:bg-[var(--lime-50)]">
            <span className="min-w-0">
              <span className="block font-semibold text-fg">{o.orderNumber}</span>
              <span className="block text-[12px] text-muted">
                Placed {fmtDate(o.placedAt)} · {o.lineCount} line{o.lineCount === 1 ? "" : "s"}
                {o.customerPoNumber ? ` · PO ${o.customerPoNumber}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-right text-[13px] tabular">
                <span className="block font-medium">{money(o.totalAmount, o.currency)}</span>
                <span className="block text-[11.5px] text-muted">deliver {fmtDate(o.requestedDeliveryOn)}</span>
              </span>
              <PortalStatus status={o.status} label={o.statusLabel} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
