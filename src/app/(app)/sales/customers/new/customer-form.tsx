"use client";
import { useState } from "react";
import { Button, Card, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { useActionForm } from "../../use-action-form";
import { createCustomerW3dAction, similarCustomersAction } from "../actions";
import { useClientKey } from "@/ui/use-client-key";


/** Fields folded under "More details" (the form opens it when the server rejects one of them). */
const MORE_FIELDS = ["contactName", "email", "paymentTermsDays", "segment", "status", "minShelfLifeDays", "defaultLeadTimeDays", "shipTo.label", "shipTo.line2", "shipTo.province", "shipTo.postalCode", "code", "notesInternal"];

/**
 * New customer (US-4-01, ADR-088 grade-5 form): name, phone and address are all most people need; the
 * system gives the customer number (CUS-nnn, ADR-075 and ADR-131) and the first address becomes the usual deliver-to and
 * bill-to. The contact person, days to pay (finance only) and everything else sit under "More details", with defaults.
 */
export function CustomerForm({ segments, canSetTerms = false }: { segments: { value: string; label: string }[]; canSetTerms?: boolean }) {
  const { state, pending, onSubmit } = useActionForm(createCustomerW3dAction);
  const key = useClientKey(); // after hydration (ADR-125, ADR-132 §10)
  const [v, setV] = useState<Record<string, string>>({
    code: "",
    name: "",
    status: "active",
    segment: "",
    contactName: "",
    phone: "",
    email: "",
    paymentTermsDays: "",
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
  const moreOpen = MORE_FIELDS.some((k) => fe[k]);
  // ADR-131 (C-office problem 10): "Already a customer?" while typing (same phone, email or nearly the same name).
  const [similar, setSimilar] = useState<{ id: string; code: string; name: string; phone: string | null }[]>([]);
  const check = async () => {
    if ((v.name ?? "").trim().length < 3 && (v.phone ?? "").replace(/\D/g, "").length < 7 && !(v.email ?? "").includes("@")) return setSimilar([]);
    setSimilar(await similarCustomersAction({ name: v.name ?? "", phone: v.phone ?? "", email: v.email ?? "" }));
  };
  const askDifferent = similar.length > 0 || /^Already a customer\?/.test(fe.name ?? "");
  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
      {key && <input type="hidden" name="idempotencyKey" value={key} />}
      <Card>
        <div className="grid grid-cols-1 gap-4" onBlur={() => void check()}>
          <Field label="Customer name" htmlFor="name" error={fe.name} hint="The shop or person, as you would say it on the phone">
            <Input {...bind("name")} required maxLength={120} autoComplete="organization" />
          </Field>
          <Field label="Phone" htmlFor="phone" error={fe.phone}>
            <Input {...bind("phone")} type="tel" maxLength={40} autoComplete="tel" placeholder="e.g. 0917 123 4567" />
          </Field>
          {askDifferent && (
            <div role="status" className="flex flex-col gap-2 rounded-[6px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[14px] text-[var(--warn-fg)]" data-testid="similar-customer">
              {similar.length > 0 ? (
                similar.map((s) => (
                  <p key={s.id}>
                    Already a customer? <strong>{s.name}</strong> {s.phone ? `· ${s.phone} ` : ""}
                    <span className="font-mono text-[12px]">{s.code}</span> ·{" "}
                    <a className="underline" href={`/sales/customers/${s.id}`}>
                      Open it
                    </a>
                  </p>
                ))
              ) : (
                <p>{fe.name}</p>
              )}
              <label className="flex min-h-[44px] items-center gap-2 font-medium text-fg">
                <input type="checkbox" name="confirmedDifferent" value="yes" className="h-5 w-5" /> This is a different customer
              </label>
            </div>
          )}
          <Field label="Street address" htmlFor="shipTo.line1" error={fe["shipTo.line1"]} hint="Where we deliver">
            <Input {...bind("shipTo.line1")} required maxLength={200} autoComplete="address-line1" />
          </Field>
          <Field label="City or town" htmlFor="shipTo.city" error={fe["shipTo.city"]}>
            <Input {...bind("shipTo.city")} required maxLength={80} autoComplete="address-level2" />
          </Field>
        </div>
      </Card>

      <MoreDetails open={moreOpen}>
        <Field label="Contact person (optional)" htmlFor="contactName" error={fe.contactName}>
          <Input {...bind("contactName")} maxLength={80} />
        </Field>
        <Field label="E-mail (optional)" htmlFor="email" error={fe.email}>
          <Input {...bind("email")} type="email" />
        </Field>
        {canSetTerms && (
          <Field label="Days to pay (optional)" htmlFor="paymentTermsDays" error={fe.paymentTermsDays} hint="For example 30. Finance can change it later.">
            <Input {...bind("paymentTermsDays")} inputMode="numeric" />
          </Field>
        )}
        <Field label="Kind of customer" htmlFor="segment" error={fe.segment} hint="To add a kind, go to Master data › Choice lists.">
          <Select {...bind("segment")}>
            {([["", "Choose…"], ...segments.map((o) => [o.value, o.label])] as [string, string][]).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Buying now?" htmlFor="status" error={fe.status} hint="A new customer who is not buying yet can get price offers; orders need an active customer.">
          <Select {...bind("status")}>
            <option value="active">Yes, active</option>
            <option value="prospect">Not yet (new, not buying yet)</option>
          </Select>
        </Field>
        <Field label="Shortest shelf life allowed (days left when sent out)" htmlFor="minShelfLifeDays" error={fe.minShelfLifeDays} hint="Usually 180. A special rule per product can change it.">
          <Input {...bind("minShelfLifeDays")} inputMode="numeric" required />
        </Field>
        <Field label="Usual days from order to delivery (optional)" htmlFor="defaultLeadTimeDays" error={fe.defaultLeadTimeDays}>
          <Input {...bind("defaultLeadTimeDays")} inputMode="numeric" />
        </Field>
        <Field label="Address name" htmlFor="shipTo.label" error={fe["shipTo.label"]} hint="Usually Main. More addresses can be added on the customer page.">
          <Input {...bind("shipTo.label")} required maxLength={60} />
        </Field>
        <Field label="Building, floor (optional)" htmlFor="shipTo.line2" error={fe["shipTo.line2"]}>
          <Input {...bind("shipTo.line2")} maxLength={200} />
        </Field>
        <Field label="Province (optional)" htmlFor="shipTo.province" error={fe["shipTo.province"]}>
          <Input {...bind("shipTo.province")} maxLength={80} />
        </Field>
        <Field label="Postal code (optional)" htmlFor="shipTo.postalCode" error={fe["shipTo.postalCode"]}>
          <Input {...bind("shipTo.postalCode")} maxLength={12} inputMode="numeric" />
        </Field>
        <Field label="Customer number (optional)" htmlFor="code" error={fe.code} hint="Leave empty: the system gives the next number, e.g. CUS-012.">
          <Input {...bind("code")} maxLength={20} autoCapitalize="characters" placeholder="Given by the system" />
        </Field>
        <Field label="Note for our team (optional)" htmlFor="notesInternal" error={fe.notesInternal} hint="Never printed on papers for the customer">
          <Textarea {...bind("notesInternal")} maxLength={1000} />
        </Field>
      </MoreDetails>

      <FormMessage state={state} />
      <div>
        <Button type="submit" variant="cta" size="lg" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Save the customer"}
        </Button>
      </div>
    </form>
  );
}
