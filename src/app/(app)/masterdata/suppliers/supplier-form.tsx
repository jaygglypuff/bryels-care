"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Card, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { saveSupplierAction } from "./actions";

export type SupplierFormValues = {
  id?: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  country: string | null;
  paymentTermsDays: number | null;
  defaultLeadTimeDays: number | null;
  qualityStatus: string;
  qualityStatusReason: string | null;
  isActive: boolean;
  notes: string | null;
  category?: string | null;
};

const STATUSES = [
  ["new", "New (not yet evaluated)"],
  ["approved", "Approved"],
  ["conditional", "Conditional"],
  ["suspended", "Suspended (receipts blocked)"],
] as const;

export function SupplierForm({ initial, categories }: { initial?: SupplierFormValues; categories: { value: string; label: string }[] }) {
  const [state, dispatch] = useActionState<ActionState, FormData>(saveSupplierAction, null);
  const [status, setStatus] = useState(initial?.qualityStatus ?? "new");
  const fe = state?.fieldErrors ?? {};
  const v = (k: keyof SupplierFormValues) => (initial?.[k] ?? "") as string;
  return (
    <form action={dispatch} className="space-y-4">
      <input type="hidden" name="supplierId" value={initial?.id ?? ""} />
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="code" error={fe.code} hint="e.g. SUP-0008. Letters, digits, dot, dash.">
            <Input id="code" name="code" required defaultValue={v("code")} autoComplete="off" className="uppercase" />
          </Field>
          <Field label="Name" htmlFor="name" error={fe.name}>
            <Input id="name" name="name" required defaultValue={v("name")} autoComplete="organization" />
          </Field>
          <Field label="Category (optional)" htmlFor="category" error={fe.category} hint="To add a category, go to Master data → Lists.">
            <Select id="category" name="category" defaultValue={initial?.category ?? ""}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Contact person" htmlFor="contactName" error={fe.contactName}>
            <Input id="contactName" name="contactName" defaultValue={v("contactName")} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={fe.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={v("phone")} />
          </Field>
          <Field label="Email" htmlFor="email" error={fe.email}>
            <Input id="email" name="email" type="email" defaultValue={v("email")} />
          </Field>
          <Field label="Address" htmlFor="addressLine1" error={fe.addressLine1}>
            <Input id="addressLine1" name="addressLine1" defaultValue={v("addressLine1")} />
          </Field>
          <Field label="City" htmlFor="city" error={fe.city}>
            <Input id="city" name="city" defaultValue={v("city")} />
          </Field>
          <Field label="Country" htmlFor="country" error={fe.country}>
            <Input id="country" name="country" defaultValue={v("country") || "Philippines"} />
          </Field>
          <Field label="Payment terms (days)" htmlFor="paymentTermsDays" error={fe.paymentTermsDays}>
            <Input id="paymentTermsDays" name="paymentTermsDays" inputMode="numeric" defaultValue={initial?.paymentTermsDays ?? ""} />
          </Field>
          <Field label="Lead time (days)" htmlFor="defaultLeadTimeDays" error={fe.defaultLeadTimeDays}>
            <Input id="defaultLeadTimeDays" name="defaultLeadTimeDays" inputMode="numeric" defaultValue={initial?.defaultLeadTimeDays ?? ""} />
          </Field>
          <Field label="Quality status" htmlFor="qualityStatus" error={fe.qualityStatus} hint="Suspended blocks receipt lines from this supplier (V-ASL).">
            <Select id="qualityStatus" name="qualityStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map(([s, t]) => (
                <option key={s} value={s}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label={status === "suspended" ? "Reason for suspension" : "Quality note (optional)"} htmlFor="qualityStatusReason" error={fe.qualityStatusReason}>
            <Input id="qualityStatusReason" name="qualityStatusReason" defaultValue={v("qualityStatusReason")} required={status === "suspended"} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Notes" htmlFor="notes" error={fe.notes}>
            <Textarea id="notes" name="notes" defaultValue={v("notes")} maxLength={1000} />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-[14px]">
          <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="size-4" /> Active (can be chosen on receipts)
        </label>
      </Card>
      <FormMessage state={state} />
      <SubmitButton variant="cta" size="lg" pendingText="Saving…">{initial?.id ? "Save changes" : "Create supplier"}</SubmitButton>
    </form>
  );
}
