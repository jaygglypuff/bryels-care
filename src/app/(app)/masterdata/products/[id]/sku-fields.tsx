"use client";
import { MoreDetails } from "@/ui/guide";
import { Grid, SelectField, TextField } from "../../_org/form";

type Unit = { id: string; code: string; name: string; dimension: string; isBase: boolean };
type SkuDefaults = {
  code?: string;
  name?: string;
  variantLabel?: string | null;
  packFormat?: string | null;
  netContentQty?: string | null;
  netContentUomId?: string | null;
  uomBaseId?: string;
  unitsPerBox?: number | null;
  boxesPerPallet?: number | null;
  gtin?: string | null;
  shelfLifeDays?: number | null;
  retestDays?: number | null;
  storageConditions?: string | null;
  allocationRule?: string;
};

const plain = (v: string | null | undefined) => (v ? v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "");

/**
 * The sellable item (SKU) form, shared by create and edit (ADR-088): four questions visible (name, pack
 * size, how much is inside and its unit); the barcode, stock unit, boxes, shelf life, storage and an
 * own code are folded under "More details" with defaults. The server makes the code (the product's
 * code for its first sellable item, else SKU-nnnn, ADR-093). Stock is always used first-expiry-first.
 */
export function SkuFields({ units, defaults = {}, locked = false }: { units: Unit[]; defaults?: SkuDefaults; locked?: boolean }) {
  const base = units.filter((u) => u.isBase);
  const pcs = base.find((u) => u.code === "pcs");
  const g = units.find((u) => u.code === "g");
  return (
    <>
      <TextField name="name" label="What is it called on the shelf and on invoices?" defaultValue={defaults.name} placeholder="e.g. Calamansi Soap 100 g, box of 12" />
      <Grid>
        <TextField name="variantLabel" label="Pack size" defaultValue={defaults.variantLabel} placeholder="e.g. 1 bar, box of 12" />
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <TextField name="netContentQty" label="How much is inside? (optional)" defaultValue={plain(defaults.netContentQty)} inputMode="decimal" placeholder="e.g. 100" />
          <SelectField name="netContentUomId" label="Unit" defaultValue={defaults.netContentUomId ?? (defaults.netContentQty ? undefined : g?.id)} emptyLabel="—" options={units.map((u) => ({ value: u.id, label: u.code }))} />
        </div>
      </Grid>
      <MoreDetails>
        <Grid>
          <TextField name="gtin" label="Barcode number (GTIN, optional)" defaultValue={defaults.gtin} inputMode="numeric" hint="The number under the shop barcode: 8, 12, 13 or 14 digits. The system checks the last digit." />
          <TextField name="packFormat" label="How it is packed (optional)" defaultValue={defaults.packFormat} placeholder="e.g. Wrapped bar" />
          <TextField name="unitsPerBox" label="How many in one box (optional)" defaultValue={defaults.unitsPerBox} inputMode="numeric" />
          <TextField name="boxesPerPallet" label="Boxes on one pallet (optional)" defaultValue={defaults.boxesPerPallet} inputMode="numeric" />
          <SelectField name="uomBaseId" label="We count it in" defaultValue={defaults.uomBaseId ?? pcs?.id} options={base.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))} hint="Almost always pieces." />
          <TextField name="shelfLifeDays" label="Good for (days, only if different from the product)" defaultValue={defaults.shelfLifeDays} inputMode="numeric" />
          <TextField name="retestDays" label="Check again after (days, optional)" defaultValue={defaults.retestDays} inputMode="numeric" />
          <TextField name="storageConditions" label="How to store it (optional)" defaultValue={defaults.storageConditions} />
          <TextField
            name="code"
            label="Your own code (optional)"
            defaultValue={defaults.code}
            placeholder={defaults.code ? undefined : "The system gives one"}
            mono
            readOnly={locked}
            hint={locked ? "In use: the code can no longer change." : "Leave empty: the first one gets the product's code, the next SKU-0001 and so on. Scanned as BC:SKU:<code>."}
          />
        </Grid>
        <input type="hidden" name="allocationRule" value={defaults.allocationRule ?? "fefo"} />
        <p className="text-[13px] text-muted">The system always sends out the stock that expires first.</p>
      </MoreDetails>
    </>
  );
}
