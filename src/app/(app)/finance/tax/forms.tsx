"use client";
import { useState } from "react";
import { Button, Card, CardTitle, Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { taxCommandAction } from "../actions";

const PW = ({ id, error }: { id: string; error?: string }) => (
  <Field label="Your password" htmlFor={id} error={error} hint="Tax rates change money: type your password to show it is you.">
    <Input id={id} name="password" type="password" autoComplete="current-password" />
  </Field>
);

/**
 * Propose a new tax rate or a new version of one (not used until a second person approves it). Visible: name,
 * rate, applies to, starts on, password. The short code is made from the name (or picked to replace an existing
 * rate) under "More details" — nobody has to type a code (ADR-088).
 */
export function ProposeTaxForm({ kinds, today, codes = [] }: { kinds: { value: string; label: string }[]; today: string; codes?: { code: string; name: string }[] }) {
  return (
    <Card>
      <CardTitle>Add a rate from the accountant</CardTitle>
      <p className="mb-3 text-[14px] text-fg-2">Type what the company&apos;s accountant gave you. A second person checks it before any invoice or bill can use it.</p>
      <ActionForm action={taxCommandAction} hidden={{ command: "propose" }} submit="Send for checking" variant="cta" pending="Saving…">
        {(fe) => (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="t-name" error={fe.name}>
                <Input id="t-name" name="name" required maxLength={80} placeholder="For example: VAT 12%" />
              </Field>
              <Field label="Rate (%)" htmlFor="t-rate" error={fe.ratePct}>
                <Input id="t-rate" name="ratePct" inputMode="decimal" required />
              </Field>
              <Field label="Used on" htmlFor="t-applies" error={fe.appliesTo}>
                <Select id="t-applies" name="appliesTo">
                  <option value="sales">Sales (invoices, quotes, orders)</option>
                  <option value="purchases">Buying (supplier bills)</option>
                  <option value="expenses">Expense claims</option>
                </Select>
              </Field>
              <Field label="Starts on" htmlFor="t-from" error={fe.effectiveFrom}>
                <Input id="t-from" name="effectiveFrom" type="date" defaultValue={today} required />
              </Field>
            </div>
            <PW id="t-pw" error={fe.password} />
            <MoreDetails>
              <Field label="Replaces the rate" htmlFor="t-code" error={fe.code} hint="Empty = a new rate; its short code is made from the name.">
                <Select id="t-code" name="code" defaultValue="">
                  <option value="">Nothing – this is a new rate</option>
                  {codes.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Kind" htmlFor="t-kind" error={fe.kind}>
                <Select id="t-kind" name="kind">
                  {kinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Rounding" htmlFor="t-round" error={fe.rounding}>
                <Select id="t-round" name="rounding">
                  <option value="line">On each line</option>
                  <option value="document">On the total</option>
                </Select>
              </Field>
              <label className="flex min-h-[44px] items-center gap-2 text-[15px]">
                <input type="checkbox" name="inclusive" className="h-5 w-5" /> Prices already include this tax
              </label>
              <Field label="Where it comes from (memo, circular, accountant's note)" htmlFor="t-src" error={fe.sourceNote}>
                <Input id="t-src" name="sourceNote" maxLength={500} />
              </Field>
            </MoreDetails>
          </>
        )}
      </ActionForm>
    </Card>
  );
}

/** Check (approve), say no, or stop using one version. */
export function TaxRowCommand({ id, command, label, variant = "secondary" }: { id: string; command: "approve" | "reject" | "retire"; label: string; variant?: "secondary" | "cta" | "danger" }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant={variant === "danger" ? "secondary" : variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  const f = `${command}-${id}`;
  return (
    <ActionForm action={taxCommandAction} hidden={{ command, id }} submit={label} variant={variant} pending="Saving…">
      {(fe) => (
        <>
          {command === "approve" && (
            <Field label="What you checked (you can skip this)" htmlFor={`${f}-n`}>
              <Input id={`${f}-n`} name="note" maxLength={500} />
            </Field>
          )}
          {command !== "approve" && (
            <Field label="Why" htmlFor={`${f}-r`} error={fe.reason}>
              <Input id={`${f}-r`} name="reason" required minLength={3} maxLength={500} />
            </Field>
          )}
          {command === "retire" && (
            <Field label="Stop using it from" htmlFor={`${f}-to`} error={fe.effectiveTo}>
              <Input id={`${f}-to`} name="effectiveTo" type="date" />
            </Field>
          )}
          {command !== "reject" && <PW id={`${f}-p`} error={fe.password} />}
        </>
      )}
    </ActionForm>
  );
}
