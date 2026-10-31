import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { returnFormContext } from "@/modules/sales";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { NewReturnForm } from "../forms";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";
export const metadata = { title: "New customer return" };

/** Start a customer return against the delivery the goods left on (W09-11). */
export default async function NewReturnPage({ searchParams }: { searchParams: Promise<{ shipmentId?: string; complaintId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.customer_return.create")) return <Forbidden what="customer returns" />;
  const sp = await searchParams;
  const f = await returnFormContext(ctx, { shipmentId: sp.shipmentId, complaintId: sp.complaintId });
  return (
    <>
      <PageHeader title="New customer return" actions={<><LinkButton href="/sales/returns" variant="ghost">Back to returns</LinkButton><Help screen="sales.return" /></>} />
      <PageIntro>This screen is for starting a customer return. Choose the delivery the goods came from and why they came back; on the next screen you scan each box.</PageIntro>
      {!f.shipments.length ? (
        <EmptyState title="Nothing was sent out from your sites yet" action={<LinkButton href="/sales/shipments" variant="secondary">See deliveries</LinkButton>}>
          A customer return always starts from a delivery that was sent out. If the goods came from another site, ask that site.
        </EmptyState>
      ) : (
        <Card className="max-w-2xl">
          <NewReturnForm
            shipments={f.shipments.map((s) => ({ id: s.id, drNumber: s.drNumber, orderNumber: s.orderNumber, customerName: s.customerName, siteCode: s.siteCode, dispatchedAt: fmtDate(s.dispatchedAt) }))}
            preselect={f.preselectShipmentId}
            complaint={f.complaint ? { id: f.complaint.id, number: f.complaint.number } : null}
            reasons={f.reasons}
            locations={f.locations}
          />
          {f.locations.length === 0 && <p className="mt-3 text-[13px] text-[var(--warn-fg)]">This site has no place to keep returned goods apart yet. Ask an administrator to set one up before starting a return.</p>}
        </Card>
      )}
    </>
  );
}
