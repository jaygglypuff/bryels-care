import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { returnFormContext } from "@/modules/sales";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { NewReturnForm } from "../forms";

export const dynamic = "force-dynamic";

/** Open a customer return against a delivery receipt (W09-11). */
export default async function NewReturnPage({ searchParams }: { searchParams: Promise<{ shipmentId?: string; complaintId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.customer_return.create")) return <Forbidden what="customer returns" />;
  const sp = await searchParams;
  const f = await returnFormContext(ctx, { shipmentId: sp.shipmentId, complaintId: sp.complaintId });
  if (!f.shipments.length) {
    return (
      <EmptyState title="No shipments at your sites" action={<LinkButton href="/sales" variant="secondary">Sales orders</LinkButton>}>
        A return is always opened against a dispatched shipment (delivery receipt).
      </EmptyState>
    );
  }
  return (
    <>
      <PageHeader title="New customer return" subtitle="Choose the delivery receipt the goods left on; then scan each returned box or lot." />
      <Card className="max-w-3xl">
        <CardTitle>Return</CardTitle>
        <NewReturnForm
          shipments={f.shipments.map((s) => ({ id: s.id, drNumber: s.drNumber, orderNumber: s.orderNumber, customerName: s.customerName, siteCode: s.siteCode, dispatchedAt: fmtDate(s.dispatchedAt) }))}
          preselect={f.preselectShipmentId}
          complaint={f.complaint ? { id: f.complaint.id, number: f.complaint.number } : null}
          reasons={f.reasons}
          locations={f.locations}
        />
        {f.locations.length === 0 && <p className="mt-3 text-[13px] text-[var(--warn-fg)]">This site has no active quarantine location for returns; ask an administrator to set one up before opening a return.</p>}
      </Card>
    </>
  );
}
