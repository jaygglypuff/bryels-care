"use client";
import { MoreDetails } from "@/ui/guide";
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
}>;

/** "135.000000" → "135". */
const plain = (v: string | undefined) => (v ? v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "");

export function ProductFields({ families, d = {}, months, locked = false }: { families: { value: string; label: string }[]; d?: Defaults; months?: number | null; locked?: boolean }) {
  // Shelf life is asked in months; a stored value that is not a whole number of months stays in days.
  const inDays = d.shelfLifeDays !== undefined && (months === null || months === undefined);
  return (
    <>
      <TextField name="name" label="What is it called?" defaultValue={d.name} placeholder="e.g. Calamansi Cream Soap 100 g" />
      <Grid>
        <SelectField name="family" label="What kind of product?" defaultValue={d.family ?? families[0]?.value} options={families} hint="To add a kind, go to Setup → Choice lists." />
        <TextField name="unitNetMassG" label="Size of one piece (grams)" defaultValue={plain(d.unitNetMassG)} inputMode="decimal" placeholder="e.g. 135" hint="What one bar or bottle holds." />
        <TextField name="unitsPerBox" label="How many go in one box?" defaultValue={d.unitsPerBox} inputMode="numeric" placeholder="e.g. 48" />
        {inDays ? (
          <TextField name="shelfLifeDays" label="Good for (days)" defaultValue={d.shelfLifeDays} inputMode="numeric" hint="QA confirms how long it stays good." />
        ) : (
          <TextField name="shelfLifeMonths" label="Good for (months)" defaultValue={months ?? undefined} inputMode="numeric" placeholder="e.g. 24" hint="QA confirms how long it stays good." />
        )}
      </Grid>
      <MoreDetails>
        <Grid>
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
      </MoreDetails>
    </>
  );
}
