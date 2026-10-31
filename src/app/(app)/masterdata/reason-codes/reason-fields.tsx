"use client";
import { MoreDetails } from "@/ui/guide";
import { CheckField, Grid, MultiCheckField, TextField, TextareaField } from "../_org/form";

type Defaults = Partial<{ code: string; name: string; description: string | null; appliesTo: string[]; requiresNote: boolean; requiresApproval: boolean; sortOrder: number; isActive: boolean }>;

/**
 * Reason fields for the create and edit forms (ADR-088): the words people see and where the reason is
 * offered. The stored code is made from the words (pest_found) and never changes once created.
 */
export function ReasonFields({ categories, d, editing = false }: { categories: { value: string; label: string }[]; d?: Defaults; editing?: boolean }) {
  return (
    <>
      <TextField name="name" label="The reason, in plain words" defaultValue={d?.name} placeholder="e.g. Pest found" />
      <MultiCheckField name="appliesTo" label="Offer it when…" options={categories} defaultValues={d?.appliesTo ?? []} />
      <CheckField name="requiresNote" label="People must also write a short note" defaultChecked={d?.requiresNote ?? false} />
      {editing && <CheckField name="isActive" label="Offer it on new records" defaultChecked={d?.isActive ?? true} hint="Old records keep it either way." />}
      <MoreDetails>
        <Grid>
          {editing ? (
            <p className="text-[13px]">
              Stored as <span className="font-mono">{d?.code}</span> <span className="text-muted">(never changes)</span>
            </p>
          ) : (
            <TextField name="code" label="Your own code (optional)" placeholder="Made from the words, e.g. pest_found" mono hint="Lower-case letters, digits and underscore. Never changes once created." />
          )}
          <TextField name="sortOrder" label="Position in the list (optional)" defaultValue={d?.sortOrder} inputMode="numeric" hint="Smaller numbers come first." />
        </Grid>
        <TextareaField name="description" label="Explanation (optional)" defaultValue={d?.description} />
        <CheckField name="requiresApproval" label="Records with this reason need approval" defaultChecked={d?.requiresApproval ?? false} />
      </MoreDetails>
    </>
  );
}
