import { requireContext } from "@/lib/auth/context";
import { listCustomers } from "@/modules/sales";
import { Card, CardTitle, Field, Input, PageHeader, Select, Textarea } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { repackAction } from "../../sales/fulfilment-actions";
import { Cmd } from "../../sales/fulfilment-forms";

export const metadata = { title: "Repack for a customer" };

/**
 * US-4-08 / W08-07: repack released boxes to a customer's carton count. The count comes from the
 * customer's approved requirement (or is entered); the old labels are voided, new boxes get new
 * labels, lineage is kept and the original boxing note is regenerated as a new version.
 */
export default async function RepackPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.container.edit") || !ctx.can("inventory.pack.create")) return <Forbidden what="repacking" />;
  const customers = ctx.can("masterdata.customer.view") ? await listCustomers(ctx) : [];
  return (
    <>
      <PageHeader title="Repack for a customer" subtitle="Released boxes of one SKU at one location" />
      <Card className="max-w-2xl">
        <CardTitle>Boxes to repack</CardTitle>
        <Cmd action={repackAction} fields={{}} label="Repack" pending="Repacking…" variant="cta" size="lg" confirm="Repack these boxes? Their labels become void; print the new ones.">
          <Field label="Box numbers" htmlFor="boxes" hint="Scan each box label; one per line or separated by spaces">
            <Textarea id="boxes" name="boxes" rows={4} required placeholder={"BC:BOX:BX-00000012\nBC:BOX:BX-00000013"} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer (carton count from their approved requirement)" htmlFor="customerId">
              <Select id="customerId" name="customerId" defaultValue="">
                <option value="">— none —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </Select>
            </Field>
            <Field label="Units per new box" htmlFor="unitsPerBox" hint="Leave empty to use the customer's count or the SKU default">
              <Input id="unitsPerBox" name="unitsPerBox" inputMode="numeric" />
            </Field>
          </div>
          <Field label="Reason" htmlFor="reason"><Input id="reason" name="reason" required minLength={3} maxLength={300} placeholder="e.g. Isla Spa takes cartons of 12" /></Field>
        </Cmd>
      </Card>
    </>
  );
}
