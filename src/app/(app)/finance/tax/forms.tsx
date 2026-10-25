"use client";
import { useState } from "react";
import { Button, Card, CardTitle, Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { taxCommandAction } from "../actions";

const PW = ({ id, error }: { id: string; error?: string }) => (
  <Field label="Your password" htmlFor={id} error={error} hint="Restricted: confirm it's you.">
    <Input id={id} name="password" type="password" autoComplete="current-password" />
  </Field>
);

/** Propose a new tax code or a new version of a code (not effective until a second person approves it). */
export function ProposeTaxForm({ kinds, today }: { kinds: { value: string; label: string }[]; today: string }) {
  return (
    <Card>
      <CardTitle>Propose a rate</CardTitle>
      <p className="mb-3 text-[13px] text-muted">Enter what the company&apos;s accountant gave you. A second person reviews it before any document can use it.</p>
      <ActionForm action={taxCommandAction} hidden={{ command: "propose" }} submit="Propose for review" variant="cta" pending="Saving…">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Code" htmlFor="t-code" error={fe.code} hint="A new version if the code exists.">
              <Input id="t-code" name="code" required maxLength={20} />
            </Field>
            <Field label="Name" htmlFor="t-name" error={fe.name}>
              <Input id="t-name" name="name" required maxLength={80} />
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
            <Field label="Rate (%)" htmlFor="t-rate" error={fe.ratePct}>
              <Input id="t-rate" name="ratePct" inputMode="decimal" required />
            </Field>
            <Field label="Applies to" htmlFor="t-applies" error={fe.appliesTo}>
              <Select id="t-applies" name="appliesTo">
                <option value="sales">Sales (invoices, quotes, orders)</option>
                <option value="purchases">Purchases (supplier bills)</option>
                <option value="expenses">Expenses</option>
              </Select>
            </Field>
            <Field label="Rounding" htmlFor="t-round" error={fe.rounding}>
              <Select id="t-round" name="rounding">
                <option value="line">Per line</option>
                <option value="document">On the document total</option>
              </Select>
            </Field>
            <Field label="Effective from" htmlFor="t-from" error={fe.effectiveFrom}>
              <Input id="t-from" name="effectiveFrom" type="date" defaultValue={today} required />
            </Field>
            <label className="flex items-center gap-2 self-end pb-3 text-[14px]">
              <input type="checkbox" name="inclusive" /> Prices include this tax
            </label>
            <div className="sm:col-span-2">
              <Field label="Source (memo, circular, accountant's note)" htmlFor="t-src" error={fe.sourceNote}>
                <Input id="t-src" name="sourceNote" maxLength={500} />
              </Field>
            </div>
            <PW id="t-pw" error={fe.password} />
          </div>
        )}
      </ActionForm>
    </Card>
  );
}

/** Review, reject or retire one version. */
export function TaxRowCommand({ id, command, label, variant = "secondary" }: { id: string; command: "approve" | "reject" | "retire"; label: string; variant?: "secondary" | "cta" | "danger" }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" size="sm" variant={variant === "danger" ? "secondary" : variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  const f = `${command}-${id}`;
  return (
    <ActionForm action={taxCommandAction} hidden={{ command, id }} submit={label} size="sm" variant={variant} pending="Saving…">
      {(fe) => (
        <>
          {command === "approve" && (
            <Field label="Review note" htmlFor={`${f}-n`}>
              <Input id={`${f}-n`} name="note" maxLength={500} />
            </Field>
          )}
          {command !== "approve" && (
            <Field label="Reason" htmlFor={`${f}-r`} error={fe.reason}>
              <Input id={`${f}-r`} name="reason" required minLength={3} maxLength={500} />
            </Field>
          )}
          {command === "retire" && (
            <Field label="No longer effective from" htmlFor={`${f}-to`} error={fe.effectiveTo}>
              <Input id={`${f}-to`} name="effectiveTo" type="date" />
            </Field>
          )}
          {command !== "reject" && <PW id={`${f}-p`} error={fe.password} />}
        </>
      )}
    </ActionForm>
  );
}
