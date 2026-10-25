import { randomUUID } from "node:crypto";
import { requireContext } from "@/lib/auth/context";
import { approvedMaterialsFor, convertibleRequestLines, poFormOptions } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Forbidden } from "../../../forbidden";
import { createOrderAction } from "../../actions";
import { SubNav } from "../../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "New purchase order" };

const EXTRA_ROWS = 4;

/**
 * New purchase order (W04-04). Step 1 picks the supplier (a plain GET form, no script needed); step 2
 * lists only the materials on that supplier's approved list, with approved request lines of this site
 * offered for conversion. Price, MOQ and lead time come from the supplier terms; the server re-checks
 * every rule (V-ASL, V-UOM, request state).
 */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.create")) return <Forbidden what="creating purchase orders" />;
  const { supplier } = await searchParams;
  const opts = await poFormOptions(ctx);
  const chosen = opts.suppliers.find((s) => s.id === supplier) ?? null;
  const mats = chosen ? await approvedMaterialsFor(ctx, chosen.id) : [];
  const prLines = chosen ? (await convertibleRequestLines(ctx)).filter((l) => mats.some((m) => m.materialId === l.materialId)) : [];
  const prices = ctx.can("masterdata.supplier_price.view");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New purchase order" subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name}`} actions={<LinkButton href="/procurement/orders" variant="secondary">Purchase orders</LinkButton>} />
      <SubNav />
      <Card>
        <CardTitle>1. Supplier</CardTitle>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Supplier (approved list only)" htmlFor="supplier">
            <Select id="supplier" name="supplier" defaultValue={chosen?.id ?? ""} required>
              <option value="" disabled>
                Choose…
              </option>
              {opts.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code}) · {s.qualityStatus}
                </option>
              ))}
            </Select>
          </Field>
          <button className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" type="submit">
            Show approved materials
          </button>
        </form>
      </Card>
      {chosen &&
        (mats.length === 0 ? (
          <div className="mt-5">
            <EmptyState title="No approved materials for this supplier" action={<LinkButton href={`/procurement/suppliers/${chosen.id}`} variant="secondary">Approved list</LinkButton>}>
              Propose the supplier × material pair on the approved list; QA approves it before it can be ordered (V-ASL).
            </EmptyState>
          </div>
        ) : (
          <Card className="mt-5">
            <CardTitle>2. Lines for {chosen.name}</CardTitle>
            <ActionForm action={createOrderAction} hidden={{ supplierId: chosen.id, idempotencyKey: randomUUID() }} submit="Create draft PO" pending="Creating…" variant="cta">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Deliver to warehouse" htmlFor="shipToWarehouseId">
                  <Select id="shipToWarehouseId" name="shipToWarehouseId" defaultValue={opts.warehouses[0]?.id ?? ""}>
                    <option value="">Site default</option>
                    {opts.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} {w.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Payment terms (days)" htmlFor="paymentTermsDays" hint="Default from the supplier.">
                  <Input id="paymentTermsDays" name="paymentTermsDays" inputMode="numeric" defaultValue={chosen.paymentTermsDays ?? ""} />
                </Field>
                {prices && (
                  <Field label="Tax amount (from the quotation)" htmlFor="taxAmount" hint="No tax rule is computed here (accountant).">
                    <Input id="taxAmount" name="taxAmount" inputMode="decimal" placeholder="0.00" />
                  </Field>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="py-1 pr-2">Material</th>
                      <th className="py-1 pr-2">Qty</th>
                      <th className="py-1 pr-2">Unit</th>
                      {prices && <th className="py-1 pr-2">Unit price (blank = supplier price)</th>}
                      <th className="py-1 pr-2">Expected (blank = lead time)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prLines.map((l, i) => (
                      <tr key={l.id}>
                        <td className="py-1 pr-2">
                          <input type="hidden" name={`lines.${i}.materialId`} value={l.materialId} />
                          <input type="hidden" name={`lines.${i}.purchaseRequestLineId`} value={l.id} />
                          {l.materialCode} · {l.materialName}
                          <div className="text-[12px] text-muted">from {l.requestNumber} line {l.lineNo}</div>
                        </td>
                        <td className="py-1 pr-2">
                          <Input name={`lines.${i}.qty`} defaultValue={String(Number(l.qty))} inputMode="decimal" aria-label="Quantity" />
                        </td>
                        <td className="py-1 pr-2">
                          <Input name={`lines.${i}.uom`} defaultValue={l.uom} aria-label="Unit" />
                        </td>
                        {prices && (
                          <td className="py-1 pr-2">
                            <Input name={`lines.${i}.unitAmount`} inputMode="decimal" aria-label="Unit price" />
                          </td>
                        )}
                        <td className="py-1 pr-2">
                          <Input type="date" name={`lines.${i}.expectedDate`} aria-label="Expected date" />
                        </td>
                      </tr>
                    ))}
                    {Array.from({ length: EXTRA_ROWS }, (_, k) => prLines.length + k).map((i) => (
                      <tr key={i}>
                        <td className="py-1 pr-2">
                          <Select name={`lines.${i}.materialId`} defaultValue="" aria-label="Material">
                            <option value="">—</option>
                            {mats.map((m) => (
                              <option key={m.materialId} value={m.materialId}>
                                {m.code} · {m.name}
                                {m.leadTimeDays !== null ? ` · ${m.leadTimeDays} d` : ""}
                                {m.moqQty ? ` · MOQ ${Number(m.moqQty)} ${m.moqUom}` : ""}
                                {prices && m.unitPrice ? ` · ${Number(m.unitPrice).toFixed(2)}/${m.priceUom}` : ""}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="py-1 pr-2">
                          <Input name={`lines.${i}.qty`} inputMode="decimal" aria-label="Quantity" />
                        </td>
                        <td className="py-1 pr-2">
                          <Input name={`lines.${i}.uom`} placeholder="price unit" aria-label="Unit" />
                        </td>
                        {prices && (
                          <td className="py-1 pr-2">
                            <Input name={`lines.${i}.unitAmount`} inputMode="decimal" aria-label="Unit price" />
                          </td>
                        )}
                        <td className="py-1 pr-2">
                          <Input type="date" name={`lines.${i}.expectedDate`} aria-label="Expected date" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[12px] text-muted">Rows without a quantity are ignored. A quantity below the supplier&apos;s MOQ or a date earlier than the lead time is saved with a warning.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Notes for the supplier" htmlFor="notes">
                  <Textarea id="notes" name="notes" rows={2} />
                </Field>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" name="isUrgent" value="yes" /> Urgent (no request; the owner is notified)
                  </label>
                  <Field label="Urgent reason" htmlFor="urgentReason">
                    <Input id="urgentReason" name="urgentReason" />
                  </Field>
                </div>
              </div>
            </ActionForm>
          </Card>
        ))}
    </div>
  );
}
