"use client";
import { useState } from "react";
import { Explain, MoreDetails } from "@/ui/guide";
import { ChoiceField, Grid, SelectField, TextField, TextareaField } from "../_org/form";

/**
 * The material form (ADR-088, grade-5 standard). Three questions and one optional pair of boxes
 * are visible: what it is called, what kind it is, how it is bought and counted, and the usual
 * supplier with the pack size. Everything else has a default and sits under "More details".
 * The server decides the code (MAT-nnnn), the QA defaults per kind and every rule.
 */

type Kind = "raw_material" | "packaging" | "consumable" | "intermediate";
const KINDS: { value: Kind; label: string; help: string }[] = [
  { value: "raw_material", label: "Ingredient", help: "Goes into the product: oils, butters, scents, lye." },
  { value: "packaging", label: "Packaging", help: "Wrapper, bottle, jar, label, box." },
  { value: "consumable", label: "Supplies", help: "Cleaning things, gloves, spare parts. Not in the product." },
];
const INTERMEDIATE = { value: "intermediate" as const, label: "Made here, used again", help: "For example lye solution made for later batches." };

/** How it is bought → the unit stock is counted in (base unit) and the usual pack unit. */
const COUNT = [
  { value: "g", label: "By weight (kg)", help: "We count it in grams.", pack: "kg" },
  { value: "mL", label: "By volume (liters)", help: "We count it in milliliters.", pack: "L" },
  { value: "pcs", label: "By the piece", help: "We count pieces.", pack: "pcs" },
];
const DIMENSION: Record<string, string> = { g: "mass", mL: "volume", pcs: "count" };

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
  category: string | null;
  brand: string | null;
  standardPackQty: string | null;
  standardPackUom: string | null;
}>;

export type MaterialFormOptions = {
  categories: { value: string; label: string }[];
  packUnits: { code: string; name: string; dimension: string }[];
  /** Per kind: does a new lot need a CoA / wait for the QA check (server defaults, A-G5-MD-01). */
  kindDefaults: Record<string, { requiresCoa: boolean; requiresIncomingInspection: boolean }>;
  /** Active suppliers, only when the user may propose a supplier for a material. */
  suppliers?: { id: string; name: string }[];
};

/** "18.000000" → "18" for the form. */
const plainQty = (v: string | null | undefined) => (v ? v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "");

/** Yes/no box that always submits its value and follows the kind until the user touches it. */
function FollowBox({ name, label, hint, value, onChange }: { name: string; label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
        <input type="hidden" name={name} value={value ? "true" : "false"} />
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-[var(--color-primary,#2e7d32)]" />
        {label}
      </label>
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

/** Material fields shared by the create and edit forms (inside an ActionForm). */
export function MaterialFields({ options, d = {}, locked = false, creating = false }: { options: MaterialFormOptions; d?: Defaults; locked?: boolean; creating?: boolean }) {
  const [kind, setKind] = useState<string>(d.materialKind ?? "");
  const [base, setBase] = useState<string>(d.baseUom ?? "");
  const kd = options.kindDefaults[kind] ?? { requiresCoa: true, requiresIncomingInspection: true };
  const [coa, setCoa] = useState<boolean | null>(d.requiresCoa ?? null);
  const [qa, setQa] = useState<boolean | null>(d.requiresIncomingInspection ?? null);
  const kinds = d.materialKind === "intermediate" ? [...KINDS, INTERMEDIATE] : KINDS;
  const buy = COUNT.find((c) => c.value === base);
  const packUnits = options.packUnits.filter((u) => !base || u.dimension === DIMENSION[base]);
  const packDefault = d.standardPackUom ?? buy?.pack ?? "";
  const isIngredient = kind === "raw_material" || kind === "intermediate";
  return (
    <>
      <TextField name="name" label="What is it called?" defaultValue={d.name} placeholder="e.g. Shea butter" />
      <ChoiceField name="materialKind" label="What kind is it?" options={kinds} value={kind} onChange={setKind} />
      {locked ? (
        <div>
          <p className="text-[15px] font-semibold text-fg">We count it in</p>
          <p className="mt-1 text-[14px] text-fg-2">
            {{ g: "Grams.", mL: "Milliliters.", pcs: "Pieces." }[d.baseUom ?? ""] ?? d.baseUom} It is in use, so this can no longer change.
          </p>
          <input type="hidden" name="baseUom" value={d.baseUom} />
        </div>
      ) : (
        <ChoiceField name="baseUom" label="How do you buy and count it?" options={COUNT} value={base} onChange={setBase} />
      )}
      <fieldset className="rounded-[14px] border border-line p-3">
        <legend className="px-1 text-[15px] font-semibold">Usual supplier and pack size (optional)</legend>
        <p className="mb-3 text-[13px] text-muted">Filled in for you when ordering and receiving. You can still change them on each delivery.</p>
        <Grid>
          {creating && options.suppliers && options.suppliers.length > 0 && (
            <SelectField name="usualSupplierId" label="Usual supplier" options={options.suppliers.map((s) => ({ value: s.id, label: s.name }))} emptyLabel="Not now" hint="QA still approves the supplier for this item." />
          )}
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <TextField name="standardPackQty" label="One pack holds" defaultValue={plainQty(d.standardPackQty)} inputMode="decimal" placeholder={buy?.pack === "pcs" ? "e.g. 500" : "e.g. 25"} hint="e.g. 25 kg sack, 18 L tin." />
            <SelectField key={base} name="standardPackUom" label="Unit" defaultValue={packUnits.some((u) => u.code === packDefault) ? packDefault : undefined} options={packUnits.map((u) => ({ value: u.code, label: u.code }))} emptyLabel="—" />
          </div>
        </Grid>
      </fieldset>
      <MoreDetails>
        <Grid>
          <div>
            <TextField name="inciName" label="INCI name" defaultValue={d.inciName} placeholder="Butyrospermum Parkii Butter" hint={isIngredient ? "From the supplier's papers; QA checks it." : "Only for ingredients."} />
            <Explain term="inci" />
          </div>
          <TextField name="commonName" label="Other name people use" defaultValue={d.commonName} />
          <SelectField name="category" label="Category (optional)" defaultValue={d.category} options={options.categories} emptyLabel="No category" hint="To add a category, go to Setup → Choice lists." />
          <TextField name="brand" label="Usual brand" defaultValue={d.brand} placeholder="e.g. Golden Palm" hint="Each delivery records the brand that arrived." />
          <TextField name="shelfLifeDays" label="Good for (days)" defaultValue={d.shelfLifeDays} inputMode="numeric" hint="Sets the expiry date when it arrives; QA confirms." />
          <TextField name="retestDays" label="Check again after (days)" defaultValue={d.retestDays} inputMode="numeric" />
          <TextField name="storageConditions" label="How to store it" defaultValue={d.storageConditions} placeholder="Below 25 °C, away from light" />
          <TextField name="code" label="Your own code (optional)" defaultValue={d.code} placeholder={d.code ? undefined : "The system gives one, e.g. MAT-0001"} mono readOnly={locked} hint={locked ? "In use: the code can no longer change." : "Leave empty and the system numbers it."} />
        </Grid>
        <Grid>
          <TextareaField name="allergenNotes" label="Allergy notes (QA checks the wording)" defaultValue={d.allergenNotes} />
          <TextareaField name="hazardNotes" label="Safety notes (QA checks the wording)" defaultValue={d.hazardNotes} />
        </Grid>
        <Grid>
          <FollowBox name="requiresCoa" label="Each delivery needs a certificate (CoA)" value={coa ?? kd.requiresCoa} onChange={setCoa} />
          <FollowBox name="requiresIncomingInspection" label="Arrives waiting for the QA check" value={qa ?? kd.requiresIncomingInspection} onChange={setQa} hint="On for ingredients and packaging, off for supplies, unless QA says otherwise." />
        </Grid>
        {creating && <SelectField name="status" label="Start as" defaultValue="active" options={[{ value: "active", label: "Ready to use" }, { value: "draft", label: "Draft (still being set up)" }]} />}
        <p className="text-[13px] text-muted">The system always uses the lot that expires first.</p>
      </MoreDetails>
    </>
  );
}
