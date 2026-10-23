"use client";
import { useState } from "react";
import { Button, Card, Field, Input, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { createCustomerAction } from "../../actions";
import { useActionForm } from "../../use-action-form";

const FIELDS = ["code", "name", "contactName", "phone", "email", "shipToAddress", "minShelfLifeDays"] as const;
type Values = Record<(typeof FIELDS)[number], string>;

export function CustomerForm({ suggestedCode }: { suggestedCode: string }) {
  const { state, pending, onSubmit } = useActionForm(createCustomerAction);
  const [v, setV] = useState<Values>({ code: suggestedCode, name: "", contactName: "", phone: "", email: "", shipToAddress: "", minShelfLifeDays: "180" });
  const fe = state?.fieldErrors ?? {};
  const bind = (k: keyof Values) => ({ id: k, name: k, value: v[k], onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4">
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer code" htmlFor="code" error={fe.code} hint="Unique, e.g. CUS-004">
            <Input {...bind("code")} required maxLength={20} autoCapitalize="characters" />
          </Field>
          <Field label="Name" htmlFor="name" error={fe.name}>
            <Input {...bind("name")} required maxLength={120} />
          </Field>
          <Field label="Contact person" htmlFor="contactName" error={fe.contactName} hint="Optional">
            <Input {...bind("contactName")} maxLength={80} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={fe.phone} hint="Optional">
            <Input {...bind("phone")} type="tel" maxLength={40} />
          </Field>
          <Field label="Email" htmlFor="email" error={fe.email} hint="Optional">
            <Input {...bind("email")} type="email" />
          </Field>
          <Field label="Minimum shelf life at dispatch (days)" htmlFor="minShelfLifeDays" error={fe.minShelfLifeDays} hint="Lots with less remaining shelf life are skipped by allocation. Confirm the value with the customer's contract.">
            <Input {...bind("minShelfLifeDays")} inputMode="numeric" required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Ship-to address" htmlFor="shipToAddress" error={fe.shipToAddress}>
              <Textarea {...bind("shipToAddress")} required maxLength={300} />
            </Field>
          </div>
        </div>
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
