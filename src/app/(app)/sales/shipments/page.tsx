import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { listShipments, shipmentCounts, SHIPMENT_STATUS_WORD, type ShipmentStatus } from "@/modules/sales";
import { Button, Card, CardTitle, EmptyState, Field, Input, PageHeader, Select, Table, Td } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Shipments" };

const TABS = ["open", "dispatched", "delivered", "reversed", "cancelled", "all"] as const;

/** Shipments of the current site by state, and the interim accountant export (US-4-14). */
export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.shipment.view")) return <Forbidden what="shipments" />;
  const { status = "open" } = await searchParams;
  const tab = (TABS as readonly string[]).includes(status) ? status : "open";
  const [rows, counts] = await Promise.all([listShipments(ctx, { status: tab }), shipmentCounts(ctx)]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const monthStart = today.slice(0, 8) + "01";
  return (
    <>
      <PageHeader title="Shipments" subtitle={`${ctx.currentSite.code} · pick → pack verification → dispatch → delivery receipt`} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Shipment status">
        {TABS.map((t) => (
          <Link key={t} href={`/sales/shipments?status=${t}`} className={`rounded-full border px-3 py-1.5 text-[13px] ${t === tab ? "border-primary bg-primary text-white" : "border-line"}`}>
            {t === "open" ? "In progress" : t === "all" ? "All" : SHIPMENT_STATUS_WORD[t as ShipmentStatus]} ({counts[t] ?? 0})
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No shipments here">Shipments are created when a pick starts for an allocated order.</EmptyState>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-line sm:hidden">
              {rows.map((s) => (
                <li key={s.id} className="py-3">
                  <Link href={`/sales/shipments/${s.id}`} className="font-medium text-primary-text">{s.shipmentNumber ?? s.deliveryReceiptNumber}</Link> <StatusChip status={s.status} />
                  <p className="text-[13px] text-fg-2">{s.orderNumber} · {s.customerName} · {fmtQty(s.units, "pcs", 0)}</p>
                </li>
              ))}
            </ul>
            <Table className="hidden sm:block" head={["Shipment", "DR", "Order", "Customer", "Status", "Boxes", "Units", "Dispatched"]}>
              {rows.map((s) => (
                <tr key={s.id}>
                  <Td><Link href={`/sales/shipments/${s.id}`} className="text-primary-text hover:underline">{s.shipmentNumber ?? "—"}</Link></Td>
                  <Td>{s.deliveryReceiptNumber ?? "—"}</Td>
                  <Td><Link href={`/sales/${s.orderId}`} className="hover:underline">{s.orderNumber}</Link></Td>
                  <Td>{s.customerName}</Td>
                  <Td><StatusChip status={s.status} /></Td>
                  <Td>{s.boxes}</Td>
                  <Td>{fmtQty(s.units, "pcs", 0)}</Td>
                  <Td>{fmtDateTime(s.dispatchedAt)}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
      {ctx.can("sales.shipment.export") && (
        <Card className="mt-4">
          <CardTitle>Export for the accountant</CardTitle>
          <p className="mb-3 text-[13px] text-fg-2">Dispatched and delivered shipments of a period with order, DR, customer, lots, boxes and quantities. Prices appear only for price-list viewers. Until invoicing is set up, billing works from this export, never from draft documents.</p>
          <form method="get" action="/api/v1/sales/shipments/export" className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
            <input type="hidden" name="siteId" value={ctx.currentSiteId} />
            <Field label="From" htmlFor="from"><Input id="from" name="from" type="date" defaultValue={monthStart} required /></Field>
            <Field label="To" htmlFor="to"><Input id="to" name="to" type="date" defaultValue={today} required /></Field>
            <Field label="Format" htmlFor="format"><Select id="format" name="format" defaultValue="xlsx"><option value="xlsx">Excel (XLSX)</option><option value="csv">CSV</option></Select></Field>
            <Button type="submit" variant="secondary">Download</Button>
          </form>
        </Card>
      )}
    </>
  );
}
