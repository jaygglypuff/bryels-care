import { randomUUID } from "node:crypto";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { receivingFormData } from "@/modules/inventory";
import { getPurchaseOrder } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { receivePoAction } from "../../actions";
import { SubNav, fmtBase } from "../../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receive against PO" };

const DISCREPANCIES = [
  ["", "No discrepancy"],
  ["short", "Short delivery"],
  ["over", "Over-delivery (procurement approves before posting)"],
  ["damaged", "Damaged"],
  ["wrong_item", "Wrong item / not on the PO (procurement approves)"],
  ["missing_documents", "Missing documents"],
] as const;

/**
 * Goods receipt against a purchase order (US-6-03, W01 with a PO). One row per open PO line; a row
 * without a quantity is not received. A delivery above the open quantity plus the tolerance is refused
 * on "Post" (V-OVER): save it as a draft with an over-delivery discrepancy instead, procurement
 * approves it on the receipt page, then it posts.
 */
export default async function ReceivePoPage({ params }: { params: Promise<{ poId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.goods_receipt.create") || !ctx.can("procurement.purchase_order.view")) return <Forbidden what="receiving against purchase orders" />;
  const { poId } = await params;
  let v: Awaited<ReturnType<typeof getPurchaseOrder>>;
  try {
    v = await getPurchaseOrder(ctx, poId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Purchase order not found">It does not exist or is not at one of your sites.</EmptyState>;
    throw e;
  }
  if (!v.can.receive) {
    return (
      <EmptyState title="Not receivable here" action={<LinkButton href={`/procurement/orders/${v.po.id}`} variant="secondary">Open the PO</LinkButton>}>
        {v.po.siteId !== ctx.currentSiteId ? "Switch to the purchase order's site to receive it." : "Goods are received against sent or partially received orders only."}
      </EmptyState>
    );
  }
  const form = await receivingFormData(ctx);
  const locs = form.locations.filter((l) => ["receiving", "quarantine", "hold"].includes(l.kind));
  const defaultLoc = locs.find((l) => l.kind === "quarantine") ?? locs[0];
  const open = v.lines.filter((l) => l.lineStatus === "open");
  const td = "py-1 pr-2 align-top";
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Receive ${v.po.poNumber}`} subtitle={`${v.supplier.name} · ${ctx.currentSite.code}`} actions={<LinkButton href={`/procurement/orders/${v.po.id}`} variant="secondary">Back to PO</LinkButton>} />
      <SubNav />
      {!defaultLoc ? (
        <EmptyState title="Receiving is not set up for this site">This site has no receiving, quarantine or hold location.</EmptyState>
      ) : (
        <Card>
          <CardTitle>Delivery</CardTitle>
          <Banner tone="q" title="Lots are created in quarantine">QA releases them after incoming inspection; labels print from the receipt page.</Banner>
          <ActionForm action={receivePoAction} hidden={{ purchaseOrderId: v.po.id, idempotencyKey: randomUUID() }} submit="Post receipt" pending="Posting…" variant="cta" className="mt-3 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Supplier delivery note (DR / invoice no.)" htmlFor="supplierDocumentNumber">
                <Input id="supplierDocumentNumber" name="supplierDocumentNumber" required />
              </Field>
              <Field label="Save as" htmlFor="intent" hint="Choose draft for an over-delivery or a line not on the PO.">
                <Select id="intent" name="intent" defaultValue="post">
                  <option value="post">Post now</option>
                  <option value="draft">Draft (procurement approves discrepancies first)</option>
                </Select>
              </Field>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 pr-2">PO line</th>
                    <th className="py-1 pr-2">Qty received</th>
                    <th className="py-1 pr-2">Unit</th>
                    <th className="py-1 pr-2">Supplier lot</th>
                    <th className="py-1 pr-2">Mfg / expiry</th>
                    <th className="py-1 pr-2">Containers</th>
                    <th className="py-1 pr-2">Put into</th>
                    <th className="py-1 pr-2">Discrepancy</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((l, i) => (
                    <tr key={l.id}>
                      <td className={td}>
                        <input type="hidden" name={`lines.${i}.purchaseOrderLineId`} value={l.id} />
                        <input type="hidden" name={`lines.${i}.materialId`} value={l.materialId} />
                        {l.lineNo}. {l.materialCode}
                        <div className="text-[12px] text-muted">
                          {l.materialName} · open {fmtBase(l.remainingBase, l.baseUom)}
                        </div>
                      </td>
                      <td className={td}>
                        <Input name={`lines.${i}.qty`} inputMode="decimal" aria-label="Quantity received" />
                      </td>
                      <td className={td}>
                        <Input name={`lines.${i}.uom`} defaultValue={l.uomEntered} aria-label="Unit" />
                      </td>
                      <td className={td}>
                        <Input name={`lines.${i}.supplierLotNumber`} aria-label="Supplier lot" />
                      </td>
                      <td className={td}>
                        <Input type="date" name={`lines.${i}.manufacturedOn`} aria-label="Manufacture date" />
                        <Input type="date" name={`lines.${i}.expiresOn`} aria-label="Expiry date" className="mt-1" />
                      </td>
                      <td className={td}>
                        <Input name={`lines.${i}.containerCount`} inputMode="numeric" aria-label="Containers" />
                        <label className="mt-1 flex items-center gap-1 text-[12px]">
                          <input type="checkbox" name={`lines.${i}.storageConditionsConfirmed`} value="yes" /> storage OK
                        </label>
                      </td>
                      <td className={td}>
                        <Select name={`lines.${i}.locationId`} defaultValue={defaultLoc.id} aria-label="Location">
                          {locs.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.code}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className={td}>
                        <Select name={`lines.${i}.discrepancyKind`} defaultValue="" aria-label="Discrepancy">
                          {DISCREPANCIES.map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </Select>
                        <Input name={`lines.${i}.discrepancyNote`} placeholder="What happened" aria-label="Discrepancy note" className="mt-1" />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className={td}>
                      <Select name={`lines.${open.length}.materialId`} defaultValue="" aria-label="Material not on the PO">
                        <option value="">Not on the PO (optional)…</option>
                        {form.materials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} · {m.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className={td}>
                      <Input name={`lines.${open.length}.qty`} inputMode="decimal" aria-label="Quantity received" />
                    </td>
                    <td className={td}>
                      <Input name={`lines.${open.length}.uom`} placeholder="unit" aria-label="Unit" />
                    </td>
                    <td className={td}>
                      <Input name={`lines.${open.length}.supplierLotNumber`} aria-label="Supplier lot" />
                    </td>
                    <td className={td}>
                      <Input type="date" name={`lines.${open.length}.expiresOn`} aria-label="Expiry date" />
                    </td>
                    <td className={td}>
                      <label className="flex items-center gap-1 text-[12px]">
                        <input type="checkbox" name={`lines.${open.length}.storageConditionsConfirmed`} value="yes" /> storage OK
                      </label>
                    </td>
                    <td className={td}>
                      <Select name={`lines.${open.length}.locationId`} defaultValue={defaultLoc.id} aria-label="Location">
                        {locs.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.code}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className={td}>
                      <input type="hidden" name={`lines.${open.length}.discrepancyKind`} value="wrong_item" />
                      <Input name={`lines.${open.length}.discrepancyNote`} placeholder="Why it came (required)" aria-label="Discrepancy note" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Field label="Notes" htmlFor="notes">
              <Textarea id="notes" name="notes" rows={2} />
            </Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
