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
}>;

/** Material fields shared by the create and edit forms (inside an ActionForm). */
export function MaterialFields({ baseUnits, d = {}, locked = false }: { baseUnits: { code: string; name: string }[]; d?: Defaults; locked?: boolean }) {
  return (
    <>
      <Grid>
        {d.code ? (
          <TextField name="code" label="Code" defaultValue={d.code} placeholder="MAT-0070" mono readOnly={locked} hint={locked ? "In use: the code can no longer change." : "Unique; printed on labels as BC:MAT:<code>."} />
        ) : (
          <TextField name="code" label="Code (optional)" placeholder="Automatic, e.g. MAT-0001" mono hint="Leave blank and the system gives the next number. Printed on labels as BC:MAT:<code>." />
        )}
        <TextField name="name" label="Name" defaultValue={d.name} placeholder="Shea Butter" />
        <TextField name="inciName" label="INCI name" defaultValue={d.inciName} placeholder="Butyrospermum Parkii Butter" hint="As declared by the supplier; verified by QA. Expected for ingredients, not for packaging." />
        <TextField name="commonName" label="Common name (optional)" defaultValue={d.commonName} />
        <SelectField name="materialKind" label="Class" defaultValue={d.materialKind ?? "raw_material"} options={CLASSES} />
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
