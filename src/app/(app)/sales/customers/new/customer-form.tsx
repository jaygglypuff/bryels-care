"use client";
import { useState } from "react";
import { Button, Card, CardTitle, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { useActionForm } from "../../use-action-form";
import { createCustomerW3dAction } from "../actions";

const SEGMENTS: [string, string][] = [
  ["", "Choose…"],
  ["pharmacy_chain", "Pharmacy chain"],
  ["salon_spa", "Salon / spa"],
  ["distributor", "Distributor"],
  ["online_reseller", "Online reseller"],
  ["retail_store", "Retail store"],
  ["other", "Other"],
];

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** New customer (US-4-01): profile, primary contact and the first address (default ship-to and bill-to). Credit terms are set by finance afterwards. */
export function CustomerForm({ suggestedCode }: { suggestedCode: string }) {
  const { state, pending, onSubmit } = useActionForm(createCustomerW3dAction);
  const [key] = useState(newKey);
  const [v, setV] = useState<Record<string, string>>({
    code: suggestedCode,
    name: "",
    status: "active",
    segment: "",
    contactName: "",
    phone: "",
    email: "",
    minShelfLifeDays: "180",
    defaultLeadTimeDays: "",
    notesInternal: "",
    "shipTo.label": "Main",
    "shipTo.line1": "",
    "shipTo.line2": "",
    "shipTo.city": "",
    "shipTo.province": "",
    "shipTo.postalCode": "",
  });
  const fe = state?.fieldErrors ?? {};
  const bind = (k: string) => ({ id: k, name: k, value: v[k] ?? "", onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={key} />
      <Card>
        <CardTitle>Profile</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer code" htmlFor="code" error={fe.code} hint="Unique, e.g. CUS-008">
            <Input {...bind("code")} required maxLength={20} autoCapitalize="characters" />
          </Field>
          <Field label="Name" htmlFor="name" error={fe.name}>
            <Input {...bind("name")} required maxLength={120} />
          </Field>
          <Field label="Segment" htmlFor="segment" error={fe.segment}>
            <Select {...bind("segment")}>
              {SEGMENTS.map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="status" error={fe.status} hint="A prospect can receive quotations; orders need an active customer to confirm.">
            <Select {...bind("status")}>
              <option value="active">Active</option>
              <option value="prospect">Prospect</option>
            </Select>
          </Field>
          <Field label="Minimum shelf life at dispatch (days)" htmlFor="minShelfLifeDays" error={fe.minShelfLifeDays} hint="Default for every product; an approved requirement per product overrides it.">
            <Input {...bind("minShelfLifeDays")} inputMode="numeric" required />
          </Field>
          <Field label="Default lead time (days)" htmlFor="defaultLeadTimeDays" error={fe.defaultLeadTimeDays} hint="Optional">
            <Input {...bind("defaultLeadTimeDays")} inputMode="numeric" />
          </Field>
        </div>
      </Card>
      <Card>
        <CardTitle>Primary contact</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Name" htmlFor="contactName" error={fe.contactName} hint="Optional">
            <Input {...bind("contactName")} maxLength={80} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={fe.phone} hint="Optional">
            <Input {...bind("phone")} type="tel" maxLength={40} />
          </Field>
          <Field label="Email" htmlFor="email" error={fe.email} hint="Optional">
            <Input {...bind("email")} type="email" />
          </Field>
        </div>
      </Card>
      <Card>
        <CardTitle>Ship-to and bill-to address</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Address name" htmlFor="shipTo.label" error={fe["shipTo.label"]}>
            <Input {...bind("shipTo.label")} required maxLength={60} />
          </Field>
          <Field label="Street address" htmlFor="shipTo.line1" error={fe["shipTo.line1"]}>
            <Input {...bind("shipTo.line1")} required maxLength={200} />
          </Field>
          <Field label="Building, floor (optional)" htmlFor="shipTo.line2" error={fe["shipTo.line2"]}>
            <Input {...bind("shipTo.line2")} maxLength={200} />
          </Field>
          <Field label="City or municipality" htmlFor="shipTo.city" error={fe["shipTo.city"]}>
            <Input {...bind("shipTo.city")} required maxLength={80} />
          </Field>
          <Field label="Province (optional)" htmlFor="shipTo.province" error={fe["shipTo.province"]}>
            <Input {...bind("shipTo.province")} maxLength={80} />
          </Field>
          <Field label="Postal code (optional)" htmlFor="shipTo.postalCode" error={fe["shipTo.postalCode"]}>
            <Input {...bind("shipTo.postalCode")} maxLength={12} inputMode="numeric" />
          </Field>
        </div>
        <p className="mt-3 text-[12px] text-muted">More addresses (branches, a separate billing office) can be added on the customer page.</p>
      </Card>
      <Card>
        <Field label="Internal notes" htmlFor="notesInternal" error={fe.notesInternal} hint="Never printed on customer documents">
          <Textarea {...bind("notesInternal")} maxLength={1000} />
        </Field>
      </Card>
      <FormMessage state={state} />
      <div>
        <Button type="submit" variant="cta" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Create customer"}
        </Button>
      </div>
    </form>
  );
}
