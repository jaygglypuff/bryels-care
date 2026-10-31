import { requireContext } from "@/lib/auth/context";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { listShipments, shipmentCounts } from "@/modules/sales";
import { Button, EmptyState, Field, Input, PageHeader, Select } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { ShipChip } from "../orders/sales-ui";

export const metadata = { title: "Deliveries" };

const TABS = [
  ["open", "Being prepared"],
  ["dispatched", "Sent out"],
  ["delivered", "Delivered"],
  ["reversed", "Sending undone"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

/** Deliveries (shipments) of the current site by state, and the accountant export (US-4-14). */
export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.shipment.view")) return <Forbidden what="deliveries" />;
  const { status = "open" } = await searchParams;
  const tab = TABS.some(([t]) => t === status) ? status : "open";
  const [rows, counts] = await Promise.all([listShipments(ctx, { status: tab }), shipmentCounts(ctx)]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const monthStart = today.slice(0, 8) + "01";
  return (
    <>
      <PageHeader title="Deliveries" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for every delivery to a customer: being prepared, sent out, or delivered. Tap one to see the next step.</PageIntro>
      <FilterTabs label="Delivery status" active={tab} tabs={TABS.map(([t, label]) => [t, `${label} (${counts[t] ?? 0})`, `/sales/shipments?status=${t}`] as const)} />
      {rows.length === 0 ? (
        <EmptyState title="No deliveries here">A delivery starts when the warehouse begins to get an order from the shelf (on the To get from shelf screen).</EmptyState>
      ) : (
        <PlainList label="Deliveries">
          {rows.map((s) => (
            <PlainRow
              key={s.id}
              href={`/sales/shipments/${s.id}`}
              title={s.customerName}
              code={[s.shipmentNumber, s.deliveryReceiptNumber, s.orderNumber].filter(Boolean).join(" · ")}
              status={<ShipChip status={s.status} />}
              facts={
                <>
                  {s.boxes} box(es) · {fmtQty(s.units, "pcs", 0)}
                  {s.dispatchedAt ? ` · sent ${fmtDateTime(s.dispatchedAt)}` : ""}
                </>
              }
            />
          ))}
        </PlainList>
      )}
      {ctx.can("sales.shipment.export") && (
        <div className="mt-4">
          <MoreDetails title="Download for the accountant">
            <p className="text-[13px] text-fg-2">Deliveries sent out in a period, with order, delivery receipt, customer, lots, boxes and amounts. Prices show only for people who may see prices.</p>
            <form method="get" action="/api/v1/sales/shipments/export" className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
              <input type="hidden" name="siteId" value={ctx.currentSiteId} />
              <Field label="From" htmlFor="from">
                <Input id="from" name="from" type="date" defaultValue={monthStart} required />
              </Field>
              <Field label="To" htmlFor="to">
                <Input id="to" name="to" type="date" defaultValue={today} required />
              </Field>
              <Field label="File" htmlFor="format">
                <Select id="format" name="format" defaultValue="xlsx">
                  <option value="xlsx">Excel</option>
                  <option value="csv">CSV</option>
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                Download
              </Button>
            </form>
          </MoreDetails>
        </div>
      )}
    </>
  );
}
