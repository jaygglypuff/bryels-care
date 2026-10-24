"use client";
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

/** The SKU fields shared by the create and edit forms (inside an ActionForm). */
export function SkuFields({ units, defaults = {} }: { units: Unit[]; defaults?: SkuDefaults }) {
  const base = units.filter((u) => u.isBase);
  const pcs = base.find((u) => u.code === "pcs");
  return (
    <Grid>
      <TextField name="code" label="SKU code" defaultValue={defaults.code} placeholder="CCS-100-12" mono hint="Unique; scanned as BC:SKU:<code>." />
      <TextField name="name" label="Name" defaultValue={defaults.name} />
      <TextField name="variantLabel" label="Variant (optional)" defaultValue={defaults.variantLabel} placeholder="100 g bar" />
      <TextField name="packFormat" label="Pack format (optional)" defaultValue={defaults.packFormat} placeholder="Wrapped bar" />
      <TextField name="netContentQty" label="Net content (optional)" defaultValue={defaults.netContentQty ? Number(defaults.netContentQty).toString() : ""} inputMode="decimal" />
      <SelectField name="netContentUomId" label="Net content unit" defaultValue={defaults.netContentUomId} emptyLabel="—" options={units.map((u) => ({ value: u.id, label: u.code }))} />
      <SelectField name="uomBaseId" label="Stock unit" defaultValue={defaults.uomBaseId ?? pcs?.id} options={base.map((u) => ({ value: u.id, label: `${u.code} (${u.name})` }))} hint="Usually pcs." />
      <SelectField name="allocationRule" label="Allocation" defaultValue={defaults.allocationRule ?? "fefo"} options={[{ value: "fefo", label: "FEFO (first expiry, first out)" }, { value: "fifo", label: "FIFO (first in, first out)" }]} />
      <TextField name="unitsPerBox" label="Units per box (optional)" defaultValue={defaults.unitsPerBox} inputMode="numeric" />
      <TextField name="boxesPerPallet" label="Boxes per pallet (optional)" defaultValue={defaults.boxesPerPallet} inputMode="numeric" />
      <TextField name="gtin" label="GTIN (optional)" defaultValue={defaults.gtin} inputMode="numeric" hint="8, 12, 13 or 14 digits; the check digit is verified." />
      <TextField name="shelfLifeDays" label="Shelf life days (optional)" defaultValue={defaults.shelfLifeDays} inputMode="numeric" />
      <TextField name="retestDays" label="Retest days (optional)" defaultValue={defaults.retestDays} inputMode="numeric" />
      <TextField name="storageConditions" label="Storage conditions (optional)" defaultValue={defaults.storageConditions} />
    </Grid>
  );
}
