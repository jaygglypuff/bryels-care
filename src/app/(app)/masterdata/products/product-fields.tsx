"use client";
import { FormSection } from "@/ui/form-section";
import { Grid, SelectField, TextField } from "../_org/form";

/**
 * The product form (ADR-088, grade-5 standard): five questions visible (name, kind, size of one
 * piece, how many in a box, how many months it stays good); storage and an own code are folded
 * under "More details". The server makes the code (PRD-nnnn, ADR-093), turns months into days
 * (A-RW-01) and checks everything; QA confirms the shelf life.
 */
type Defaults = Partial<{
  code: string;
  name: string;
  family: string;
  unitNetMassG: string;
  unitsPerBox: number;
  shelfLifeDays: number;
  storageConditions: string | null;
  labelling: string;
}>;

/** ADR-104 §2 "How do you label it?" (products.labelling). */
const LABELLING_OPTIONS = [
  { value: "per_box", label: "A label on each box (usual)" },
  { value: "per_piece", label: "A label on each piece (bar or bottle) and each box" },
];

/** "135.000000" → "135". */
const plain = (v: string | undefined) => (v ? v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "");

export function ProductFields({ families, d = {}, months, locked = false }: { families: { value: string; label: string }[]; d?: Defaults; months?: number | null; locked?: boolean }) {
  // Shelf life is asked in months; a stored value that is not a whole number of months stays in days.
  const inDays = d.shelfLifeDays !== undefined && (months === null || months === undefined);
  // ADR-123: titled sections; five questions on screen, how long it keeps and the code folded (round 4 rule).
  return (
    <>
      <FormSection title="What it is">
        <TextField name="name" label="What is it called?" defaultValue={d.name} placeholder="e.g. Calamansi Cream Soap 100 g" />
        <Grid>
          <SelectField name="family" label="What kind of product?" defaultValue={d.family ?? families[0]?.value} options={families} hint="To add a kind, go to Set-up › Choice lists." />
          <TextField name="unitNetMassG" label="Size of one piece (grams)" defaultValue={plain(d.unitNetMassG)} inputMode="decimal" placeholder="e.g. 135" hint="What one bar or bottle holds." />
        </Grid>
      </FormSection>
      <FormSection title="Boxes and labels">
        <Grid>
          <TextField name="unitsPerBox" label="How many go in one box?" defaultValue={d.unitsPerBox} inputMode="numeric" placeholder="e.g. 48" />
          <SelectField name="labelling" label="How do you label it?" defaultValue={d.labelling ?? "per_box"} options={LABELLING_OPTIONS} hint="Box labels are the usual. QA and the label adviser check what a label must show." />
        </Grid>
      </FormSection>
      <FormSection
        title="Keeping it and code"
        moreTitle="How long it keeps, how to store it, your own code"
        more={
          <Grid>
            {inDays ? (
              <TextField name="shelfLifeDays" label="Good for (days)" defaultValue={d.shelfLifeDays} inputMode="numeric" hint="QA confirms how long it stays good." />
            ) : (
              <TextField name="shelfLifeMonths" label="Good for (months)" defaultValue={months ?? undefined} inputMode="numeric" placeholder="e.g. 24" hint="QA confirms how long it stays good." />
            )}
            <TextField name="storageConditions" label="How to store it (optional)" defaultValue={d.storageConditions} placeholder="Cool, dry place" />
            <TextField
              name="code"
              label="Your own code (optional)"
              defaultValue={d.code}
              placeholder={d.code ? undefined : "The system gives one, e.g. PRD-0001"}
              mono
              readOnly={locked}
              hint={locked ? "In use: the code can no longer change." : "Leave empty and the system numbers it."}
            />
          </Grid>
        }
      />
    </>
  );
}
