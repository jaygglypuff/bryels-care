"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Card, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { FormSection } from "@/ui/form-section";
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
  ["new", "New (not checked yet)"],
  ["approved", "Approved"],
  ["conditional", "Conditional"],
  ["suspended", "Suspended (receipts blocked)"],
] as const;

export function SupplierForm({ initial, categories, plain = false }: { initial?: SupplierFormValues; categories: { value: string; label: string }[]; /** Inside EditDetails on the record page: no card of its own. */ plain?: boolean }) {
  const [state, dispatch] = useActionState<ActionState, FormData>(saveSupplierAction, null);
  const [status, setStatus] = useState(initial?.qualityStatus ?? "new");
  const fe = state?.fieldErrors ?? {};
  const v = (k: keyof SupplierFormValues) => (initial?.[k] ?? "") as string;
  // A server error on a folded field opens its section's fold.
  const errIn = (keys: string[]) => Object.keys(fe).some((k) => keys.includes(k));
  // ADR-123: titled sections; four questions on screen, the rest folded per section (round 4 rule).
  const body = (
    <div className="flex flex-col gap-4">
      <FormSection title="Name and who to call">
        <Field label="Supplier name" htmlFor="name" error={fe.name}>
          <Input id="name" name="name" required defaultValue={v("name")} autoComplete="organization" placeholder="e.g. Island Oils Trading" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Who do you talk to? (optional)" htmlFor="contactName" error={fe.contactName}>
            <Input id="contactName" name="contactName" defaultValue={v("contactName")} />
          </Field>
          <Field label="Phone (optional)" htmlFor="phone" error={fe.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={v("phone")} />
          </Field>
          <Field label="Email (optional)" htmlFor="email" error={fe.email}>
            <Input id="email" name="email" type="email" defaultValue={v("email")} />
          </Field>
        </div>
      </FormSection>
      <FormSection
        title="Address and paying"
        moreTitle="Address, category, paying and delivery days (you can skip this)"
        open={errIn(["category", "addressLine1", "city", "country", "paymentTermsDays", "defaultLeadTimeDays"])}
        more={
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category (optional)" htmlFor="category" error={fe.category} hint="To add a category, go to Set-up › Choice lists.">
              <Select id="category" name="category" defaultValue={initial?.category ?? ""}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Address" htmlFor="addressLine1" error={fe.addressLine1}>
              <Input id="addressLine1" name="addressLine1" defaultValue={v("addressLine1")} />
            </Field>
            <Field label="Town or city" htmlFor="city" error={fe.city}>
              <Input id="city" name="city" defaultValue={v("city")} />
            </Field>
            <Field label="Country" htmlFor="country" error={fe.country}>
              <Input id="country" name="country" defaultValue={v("country") || "Philippines"} />
            </Field>
            <Field label="Pay within (days)" htmlFor="paymentTermsDays" error={fe.paymentTermsDays}>
              <Input id="paymentTermsDays" name="paymentTermsDays" inputMode="numeric" defaultValue={initial?.paymentTermsDays ?? ""} />
            </Field>
            <Field label="Days from order to delivery" htmlFor="defaultLeadTimeDays" error={fe.defaultLeadTimeDays}>
              <Input id="defaultLeadTimeDays" name="defaultLeadTimeDays" inputMode="numeric" defaultValue={initial?.defaultLeadTimeDays ?? ""} />
            </Field>
          </div>
        }
      />
      <FormSection
        title="QA, code and notes"
        moreTitle="QA status, your own code, notes, in use (you can skip this)"
        open={errIn(["qualityStatus", "qualityStatusReason", "code", "notes"])}
        more={
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="QA status" htmlFor="qualityStatus" error={fe.qualityStatus} hint="Suspended stops deliveries from this supplier.">
                <Select id="qualityStatus" name="qualityStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map(([s, t]) => (
                    <option key={s} value={s}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label={status === "suspended" ? "Why is it suspended?" : "QA note (optional)"} htmlFor="qualityStatusReason" error={fe.qualityStatusReason}>
                <Input id="qualityStatusReason" name="qualityStatusReason" defaultValue={v("qualityStatusReason")} required={status === "suspended"} />
              </Field>
              <Field label="Your own code (optional)" htmlFor="code" error={fe.code} hint="Leave empty and the system numbers it, e.g. SUP-0001.">
                <Input id="code" name="code" defaultValue={v("code")} autoComplete="off" className="font-mono uppercase" placeholder="The system gives one" />
              </Field>
            </div>
            <Field label="Notes" htmlFor="notes" error={fe.notes}>
              <Textarea id="notes" name="notes" defaultValue={v("notes")} maxLength={1000} />
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
              <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="size-5" /> In use (can be chosen on orders and deliveries)
            </label>
          </>
        }
      />
    </div>
  );
  return (
    <form action={dispatch} className="space-y-4">
      <input type="hidden" name="supplierId" value={initial?.id ?? ""} />
      {plain ? body : <Card>{body}</Card>}
      <FormMessage state={state} />
      <SubmitButton variant="cta" size="lg" pendingText="Saving…">{initial?.id ? "Save" : "Add supplier"}</SubmitButton>
    </form>
  );
}
