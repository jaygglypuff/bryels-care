"use client";
import { CheckField, Grid, MultiCheckField, TextField, TextareaField } from "../_org/form";

type Defaults = Partial<{ code: string; name: string; description: string | null; appliesTo: string[]; requiresNote: boolean; requiresApproval: boolean; sortOrder: number; isActive: boolean }>;

/** Reason-code fields for the create and edit forms; the code is shown read-only once created. */
export function ReasonFields({ categories, d, editing = false }: { categories: { value: string; label: string }[]; d?: Defaults; editing?: boolean }) {
  return (
    <>
      <Grid>
        {editing ? (
          <p className="text-[13px]">
            Code <span className="font-mono font-semibold">{d?.code}</span> <span className="text-muted">(never changes)</span>
          </p>
        ) : (
          <TextField name="code" label="Code" placeholder="pest_found" mono hint="Lower-case letters, digits and underscore. Never changes once created." />
        )}
        <TextField name="name" label="Label people see" defaultValue={d?.name} placeholder="Pest found" />
        <TextField name="sortOrder" label="Sort order (optional)" defaultValue={d?.sortOrder} inputMode="numeric" />
      </Grid>
      <TextareaField name="description" label="Description (optional)" defaultValue={d?.description} />
      <MultiCheckField name="appliesTo" label="Offered on" options={categories} defaultValues={d?.appliesTo ?? []} />
      <Grid>
        <CheckField name="requiresNote" label="A note is required (max 500 characters)" defaultChecked={d?.requiresNote ?? false} />
        <CheckField name="requiresApproval" label="Records with this reason need approval" defaultChecked={d?.requiresApproval ?? false} hint="Read by the approval services." />
        {editing && <CheckField name="isActive" label="Active (can be chosen on new records)" defaultChecked={d?.isActive ?? true} />}
      </Grid>
    </>
  );
}
