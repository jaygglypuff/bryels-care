"use client";
import { CheckField, Grid, SelectField, TextField, TextareaField } from "../_org/form";

const CLASSES = [
  { value: "raw_material", label: "Raw material" },
  { value: "packaging", label: "Packaging" },
  { value: "intermediate", label: "Intermediate (e.g. lye solution)" },
  { value: "consumable", label: "Consumable" },
];

type Defaults = Partial<{
  code: string;
  name: string;
  inciName: string | null;
  commonName: string | null;
  materialKind: string;
  baseUom: string;
  shelfLifeDays: number | null;
  retestDays: number | null;
  storageConditions: string | null;
  allergenNotes: string | null;
  hazardNotes: string | null;
  requiresCoa: boolean;
  requiresIncomingInspection: boolean;
  allocationRule: string;
  category: string | null;
  brand: string | null;
  standardPackQty: string | null;
  standardPackUom: string | null;
}>;

export type MaterialFormOptions = { categories: { value: string; label: string }[]; packUnits: { code: string; name: string }[] };

/** "18.000000" → "18" for the form. */
const plainQty = (v: string | null | undefined) => (v ? v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "");

/** Material fields shared by the create and edit forms (inside an ActionForm). */
export function MaterialFields({ baseUnits, options, d = {}, locked = false }: { baseUnits: { code: string; name: string }[]; options: MaterialFormOptions; d?: Defaults; locked?: boolean }) {
  return (
    <>
      <Grid>
        <TextField name="code" label="Code" defaultValue={d.code} placeholder="MAT-0070" mono readOnly={locked} hint={locked ? "In use: the code can no longer change." : "Unique; printed on labels as BC:MAT:<code>."} />
        <TextField name="name" label="Name" defaultValue={d.name} placeholder="Shea Butter" />
        <TextField name="inciName" label="INCI name" defaultValue={d.inciName} placeholder="Butyrospermum Parkii Butter" hint="As declared by the supplier; verified by QA. Expected for ingredients, not for packaging." />
        <TextField name="commonName" label="Common name (optional)" defaultValue={d.commonName} />
        <SelectField name="materialKind" label="Class" defaultValue={d.materialKind ?? "raw_material"} options={CLASSES} />
        <SelectField name="category" label="Category (optional)" defaultValue={d.category} options={options.categories} emptyLabel="No category" hint="To add a category, go to Master data → Lists." />
        {locked ? (
          <TextField name="baseUom" label="Base unit" defaultValue={d.baseUom} readOnly hint="In use: the base unit can no longer change." />
        ) : (
          <SelectField name="baseUom" label="Base unit" defaultValue={d.baseUom ?? "g"} options={baseUnits.map((u) => ({ value: u.code, label: `${u.code} (${u.name})` }))} hint="Stock is always counted in this unit." />
        )}
        <TextField name="shelfLifeDays" label="Shelf life in days (optional)" defaultValue={d.shelfLifeDays} inputMode="numeric" hint="Default expiry when receiving; confirmed by QA." />
        <TextField name="retestDays" label="Retest interval in days (optional)" defaultValue={d.retestDays} inputMode="numeric" />
        <SelectField name="allocationRule" label="Allocation" defaultValue={d.allocationRule ?? "fefo"} options={[{ value: "fefo", label: "FEFO" }, { value: "fifo", label: "FIFO" }]} />
        <TextField name="storageConditions" label="Storage conditions (optional)" defaultValue={d.storageConditions} placeholder="Store below 25 °C, away from light" />
      </Grid>
      <fieldset className="rounded-[12px] border border-line p-3">
        <legend className="px-1 text-[14px] font-medium">Usual brand and pack size</legend>
        <p className="mb-3 text-[13px] text-muted">Filled in for you when receiving and ordering. You can still change them on each delivery.</p>
        <Grid>
          <TextField name="brand" label="Usual brand (optional)" defaultValue={d.brand} placeholder="e.g. Golden Palm" hint="Each delivery records the brand actually received." />
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <TextField name="standardPackQty" label="Standard pack size (optional)" defaultValue={plainQty(d.standardPackQty)} inputMode="decimal" placeholder="18" hint="e.g. 18 L tin, 25 kg bag." />
            <SelectField name="standardPackUom" label="Unit" defaultValue={d.standardPackUom} options={options.packUnits.map((u) => ({ value: u.code, label: u.code }))} emptyLabel="Base unit" />
          </div>
        </Grid>
      </fieldset>
      <Grid>
        <TextareaField name="allergenNotes" label="Allergen notes (content validated by QA)" defaultValue={d.allergenNotes} />
        <TextareaField name="hazardNotes" label="Hazard notes (content validated by QA)" defaultValue={d.hazardNotes} />
      </Grid>
      <Grid>
        <CheckField name="requiresCoa" label="Lots need a Certificate of Analysis before release" defaultChecked={d.requiresCoa ?? true} />
        <CheckField name="requiresIncomingInspection" label="Lots arrive in quarantine for incoming inspection" defaultChecked={d.requiresIncomingInspection ?? true} hint="QA decides which materials may be released on receipt." />
      </Grid>
    </>
  );
}
