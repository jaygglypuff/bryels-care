import { requireContext } from "@/lib/auth/context";
import { requestFormOptions } from "@/modules/procurement";
import { Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Forbidden } from "../../../forbidden";
import { createRequestAction } from "../../actions";
import { SubNav } from "../../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "New purchase request" };

const ROWS = 5;

/** New purchase request (W04-02): material, quantity and unit per line; needed-by date and reason. */
export default async function NewRequestPage() {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_request.create")) return <Forbidden what="creating purchase requests" />;
  const { materials, suppliers } = await requestFormOptions(ctx);
  const prices = ctx.can("masterdata.supplier_price.view");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New purchase request" subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name}`} actions={<LinkButton href="/procurement/requests" variant="secondary">Requests</LinkButton>} />
      <SubNav />
      {materials.length === 0 ? (
        <EmptyState title="No active materials">Create materials in master data first.</EmptyState>
      ) : (
        <Card>
          <ActionForm action={createRequestAction} submit="Save draft request" pending="Saving…" variant="cta">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Needed by" htmlFor="neededByDate">
                <Input id="neededByDate" type="date" name="neededByDate" />
              </Field>
              <Field label="Why is it needed?" htmlFor="justification">
                <Textarea id="justification" name="justification" rows={2} />
              </Field>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-[13px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 pr-2">Material</th>
                    <th className="py-1 pr-2">Qty</th>
                    <th className="py-1 pr-2">Unit</th>
                    <th className="py-1 pr-2">Suggested supplier</th>
                    {prices && <th className="py-1 pr-2">Estimated price</th>}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: ROWS }, (_, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                        <Select name={`lines.${i}.materialId`} defaultValue="" aria-label="Material">
                          <option value="">—</option>
                          {materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code} · {m.name} ({m.baseUom})
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1 pr-2">
                        <Input name={`lines.${i}.qty`} inputMode="decimal" aria-label="Quantity" />
                      </td>
                      <td className="py-1 pr-2">
                        <Input name={`lines.${i}.uom`} placeholder="base unit" aria-label="Unit" />
                      </td>
                      <td className="py-1 pr-2">
                        <Select name={`lines.${i}.suggestedSupplierId`} defaultValue="" aria-label="Supplier">
                          <option value="">—</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      {prices && (
                        <td className="py-1 pr-2">
                          <Input name={`lines.${i}.estimatedUnitAmount`} inputMode="decimal" aria-label="Estimated price per unit" />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-muted">Rows without a material are ignored. Units must convert to the material&apos;s base unit (e.g. kg for a material kept in g).</p>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
