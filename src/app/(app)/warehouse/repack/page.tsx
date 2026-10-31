import { requireContext } from "@/lib/auth/context";
import { listCustomers } from "@/modules/sales";
import { Card, Field, Input, PageHeader, Select, Textarea } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { repackAction } from "../../sales/fulfilment-actions";
import { Cmd } from "../../sales/fulfilment-forms";

export const metadata = { title: "Repack for a customer" };

/**
 * US-4-08 / W08-07: repack boxes (QA OK) to a customer's box size. The size comes from the customer's
 * approved requirement (or is entered under More details); the old labels are voided, new boxes get new
 * labels, lineage is kept and the original boxing note is made again as a new version. Grade-5 (ADR-088):
 * boxes are scanned, the customer is picked by name.
 */
export default async function RepackPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.container.edit") || !ctx.can("inventory.pack.create")) return <Forbidden what="repacking" />;
  const customers = ctx.can("masterdata.customer.view") ? [...(await listCustomers(ctx))].sort((a, b) => a.name.localeCompare(b.name)) : [];
  return (
    <div className="space-y-4">
      <PageHeader title="Repack for a customer" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for putting boxes of one product into new boxes of the size a customer wants. Scan the boxes, choose the customer, and say why. The old labels stop working; print the new ones.</PageIntro>
      <Card className="max-w-2xl">
        <Cmd action={repackAction} fields={{}} label="Repack" pending="Repacking…" variant="cta" size="lg" confirm="Repack these boxes? Their old labels stop working; print the new ones.">
          <Field label="Scan each box" htmlFor="boxes" hint="Scan the label of every box to repack. Same product, same shelf, QA OK.">
            <Textarea id="boxes" name="boxes" rows={4} required placeholder="Scan the box labels" />
          </Field>
          <Field label="For which customer?" htmlFor="customerId" hint="Their box size is used when it is known.">
            <Select id="customerId" name="customerId" defaultValue="">
              <option value="">No customer (choose the box size below)</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Why?" htmlFor="reason"><Input id="reason" name="reason" required minLength={3} maxLength={300} placeholder="e.g. Isla Spa takes boxes of 12" /></Field>
          <MoreDetails>
            <Field label="How many in each new box?" htmlFor="unitsPerBox" hint="Leave empty to use the customer's size or the product's usual size.">
              <Input id="unitsPerBox" name="unitsPerBox" inputMode="numeric" />
            </Field>
          </MoreDetails>
        </Cmd>
      </Card>
    </div>
  );
}
