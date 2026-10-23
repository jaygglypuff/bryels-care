"use client";
import { useActionState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, LinkButton, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { createMaterialAction } from "./actions";

export function MaterialForm() {
  const [state, action] = useActionState<ActionState, FormData>(createMaterialAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" htmlFor="code" error={fe.code} hint="Unique, printed on labels as BC:MAT:<code>.">
          <Input id="code" name="code" required autoComplete="off" placeholder="MAT-0070" className="font-mono uppercase" />
        </Field>
        <Field label="Name" htmlFor="name" error={fe.name}>
          <Input id="name" name="name" required placeholder="Shea Butter" />
        </Field>
        <Field label="INCI name (optional)" htmlFor="inciName" error={fe.inciName} hint="As declared by the supplier; verified by QA/regulatory.">
          <Input id="inciName" name="inciName" placeholder="Butyrospermum Parkii Butter" />
        </Field>
        <Field label="Kind" htmlFor="materialKind" error={fe.materialKind}>
          <Select id="materialKind" name="materialKind" defaultValue="raw_material">
            <option value="raw_material">Raw material</option>
            <option value="intermediate">Intermediate</option>
            <option value="packaging">Packaging</option>
          </Select>
        </Field>
        <Field label="Base unit" htmlFor="baseUom" error={fe.baseUom} hint="Stock is always counted in this unit.">
          <Select id="baseUom" name="baseUom" defaultValue="g">
            <option value="g">g (grams)</option>
            <option value="mL">mL (millilitres)</option>
            <option value="pcs">pcs (pieces)</option>
          </Select>
        </Field>
        <Field label="Shelf life in days (optional)" htmlFor="shelfLifeDays" error={fe.shelfLifeDays} hint="Used as the default expiry when receiving.">
          <Input id="shelfLifeDays" name="shelfLifeDays" inputMode="numeric" placeholder="730" />
        </Field>
      </div>
      <Field label="Storage conditions (optional)" htmlFor="storageConditions" error={fe.storageConditions}>
        <Input id="storageConditions" name="storageConditions" placeholder="Store below 25 °C, away from light" />
      </Field>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="cta" pendingText="Creating…">Create material</SubmitButton>
        <LinkButton href="/masterdata/materials" variant="secondary">Cancel</LinkButton>
      </div>
    </form>
  );
}
