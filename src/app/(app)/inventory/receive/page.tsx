import { randomUUID } from "node:crypto";
import Link from "next/link";
import Decimal from "decimal.js";
import { ChevronRight, Zap } from "lucide-react";
import { Help } from "@/ui/help/help";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate } from "@/lib/qty";
import { receivingFormData } from "@/modules/inventory/receiving";
import { expectedReceipts, getPurchaseOrder } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ReceiveForm, type PoFormContext } from "./receive-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receive a delivery" };

const fmtNum = (d: Decimal) => d.toDecimalPlaces(3).toString();

type SP = { po?: string; nopo?: string };

/**
 * Receive a delivery (W01; S6 tablet redesign, ADR-077). Step 1: which delivery is it? A sent purchase
 * order of this site, or "no purchase order" (an urgent buy; purchasing makes the PO later from the
 * receipt). Step 2: the one-card-per-item form (receive-form.tsx).
 */
export default async function ReceivePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.goods_receipt.create")) return <Forbidden what="receiving materials" />;
  const sp = await searchParams;
  const data = await receivingFormData(ctx);
  const { materials, locations, suppliers, reasonCodes, storageBySection } = data;
  const defaultLocation = locations.find((l) => l.kind === "quarantine") ?? locations.find((l) => l.kind !== "storage") ?? locations[0];
  const canSeePos = ctx.can("procurement.purchase_order.view");
  const header = (subtitle: string) => (
    <PageHeader
      title="Receive a delivery"
      subtitle={`${ctx.currentSite.code} · ${subtitle}`}
      actions={
        <>
          <Help screen="inventory.receive" />
          {ctx.can("procurement.goods_receipt.view") && <LinkButton href="/inventory/receipts" variant="secondary">Receipts &amp; not finished</LinkButton>}
          {ctx.can("inventory.movement.post") && <LinkButton href="/inventory/receive/put-away" variant="secondary">Put away</LinkButton>}
        </>
      }
    />
  );
  if (materials.length === 0 || !defaultLocation) {
    return (
      <div className="mx-auto max-w-4xl">
        {header(ctx.currentSite.name)}
        <EmptyState title="Receiving is not set up for this site">
          {materials.length === 0 ? "No materials exist yet. Create materials in Master data first." : "This site has no receiving, QA or hold place."}
        </EmptyState>
      </div>
    );
  }

  // Step 2a: against a purchase order.
  if (sp.po && canSeePos) {
    let v: Awaited<ReturnType<typeof getPurchaseOrder>>;
    try {
      v = await getPurchaseOrder(ctx, sp.po);
    } catch (e) {
      if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Purchase order not found" action={<LinkButton href="/inventory/receive" variant="secondary">Back</LinkButton>}>It does not exist or is not at one of your sites.</EmptyState>;
      throw e;
    }
    if (!v.can.receive) {
      return (
        <div className="mx-auto max-w-4xl">
          {header(v.po.poNumber)}
          <EmptyState title="This order cannot be received here" action={<LinkButton href="/inventory/receive" variant="secondary">Choose another delivery</LinkButton>}>
            {v.po.siteId !== ctx.currentSiteId ? "Switch to the order's site to receive it." : "Only orders sent to the supplier and not fully received can be received."}
          </EmptyState>
        </div>
      );
    }
    const po: PoFormContext = {
      purchaseOrderId: v.po.id,
      poNumber: v.po.poNumber,
      supplierName: v.supplier.name,
      lines: v.lines
        .filter((l) => l.lineStatus === "open")
        .map((l) => {
          // Default quantity = what is still to come, in the unit of the order.
          const perUnit = new Decimal(l.qtyBase).div(l.qtyEntered);
          const open = new Decimal(l.remainingBase).div(perUnit);
          return {
            purchaseOrderLineId: l.id,
            lineNo: l.lineNo,
            materialId: l.materialId,
            orderedText: `${fmtNum(new Decimal(l.qtyEntered))} ${l.uomEntered}`,
            openText: `${fmtNum(open)} ${l.uomEntered}`,
            defaultQty: fmtNum(open),
            uom: l.uomEntered,
          };
        }),
    };
    // Items on the order that are not active any more are still offered (the server refuses them with a clear message).
    return (
      <div className="mx-auto max-w-5xl">
        {header(`${v.po.poNumber} · ${v.supplier.name}`)}
        <ReceiveForm idempotencyKey={randomUUID()} materials={materials} locations={locations} suppliers={suppliers} reasonCodes={reasonCodes} defaultLocationId={defaultLocation.id} canPost={ctx.can("procurement.goods_receipt.post")} printLabels={ctx.can("inventory.label_job.create")} po={po} storageBySection={storageBySection} />
      </div>
    );
  }

  // Step 1: which delivery? (only when there are orders to receive at this site)
  const open = canSeePos && !sp.nopo ? (await expectedReceipts(ctx, { siteId: ctx.currentSiteId })) : [];
  const orders = [...new Map(open.map((r) => [r.purchaseOrderId, r])).values()].map((r) => ({ ...r, lines: open.filter((x) => x.purchaseOrderId === r.purchaseOrderId) }));
  if (orders.length > 0) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {header("which delivery is this?")}
        <Card>
          <CardTitle>Orders waiting for delivery</CardTitle>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Purchase orders to receive">
            {orders.map((o) => (
              <li key={o.purchaseOrderId} className="min-w-0">
                <Link href={`/inventory/receive?po=${o.purchaseOrderId}`} className="flex min-h-[88px] items-center gap-3 rounded-[16px] border border-line p-4 hover:shadow-[var(--shadow-pop)] active:bg-surface-2" data-testid={`receive-po-${o.poNumber}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold">{o.supplierName}</span>
                    <span className="block text-[13px] text-muted">
                      {o.poNumber} · {o.lines.length} {o.lines.length === 1 ? "item" : "items"}: {o.lines.slice(0, 2).map((l) => l.materialName).join(", ")}
                      {o.lines.length > 2 ? "…" : ""}
                    </span>
                    {o.expectedDate && (
                      <span className="mt-1 block text-[12px]">
                        Expected {fmtDate(o.expectedDate)} {o.late && <Chip tone="warn">Late</Chip>}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={20} className="shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <Link href="/inventory/receive?nopo=1" className="flex min-h-[72px] items-center gap-3 rounded-[16px] p-1" data-testid="receive-no-po">
            <Zap size={20} className="shrink-0 text-[var(--warn-fg)]" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold">No purchase order (urgent buy)</span>
              <span className="block text-[13px] text-muted">Receive it now. Purchasing can make the purchase order later from the receipt.</span>
            </span>
            <ChevronRight size={20} className="shrink-0 text-muted" aria-hidden />
          </Link>
        </Card>
      </div>
    );
  }

  // Step 2b: no purchase order.
  return (
    <div className="mx-auto max-w-5xl">
      {header("delivery without a purchase order")}
      <ReceiveForm idempotencyKey={randomUUID()} materials={materials} locations={locations} suppliers={suppliers} reasonCodes={reasonCodes} defaultLocationId={defaultLocation.id} canPost={ctx.can("procurement.goods_receipt.post")} printLabels={ctx.can("inventory.label_job.create")} storageBySection={storageBySection} />
    </div>
  );
}
