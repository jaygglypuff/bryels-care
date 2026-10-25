"use client";
import { Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { confirmPolicyAction, dryRunAction, executePurgeAction, placeHoldAction, releaseHoldAction, savePolicyAction, signOffDrillAction } from "./actions";

const PASSWORD_HINT = "Not needed within 10 minutes of “Confirm it’s you”; two-step sign-in users confirm there.";

type PolicyFormProps = {
  dataClass: string;
  target: string;
  unit: "months" | "days" | "none";
  value: number | null;
  basis: string;
  minimumMonths: number | null;
  action: string;
  actions: readonly string[];
  bases: readonly string[];
  today: string;
};

export function PolicyEditForm(p: PolicyFormProps) {
  const id = (k: string) => `${p.dataClass}-${p.target}-${k}`.replace(/[^a-zA-Z0-9-]/g, "_");
  return (
    <ActionForm action={savePolicyAction} hidden={{ dataClass: p.dataClass, target: p.target }} submit="Save policy" pending="Saving…" size="sm" className="mt-2 flex flex-col gap-3 rounded-[14px] border border-line p-3">
      {(fe) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Period unit" htmlFor={id("unit")} error={fe.period}>
              <Select id={id("unit")} name="unit" defaultValue={p.unit}>
                <option value="months">Months</option>
                <option value="days">Days</option>
                <option value="none">No period (keep)</option>
              </Select>
            </Field>
            <Field label="Period" htmlFor={id("value")}>
              <Input id={id("value")} name="value" type="number" min={1} defaultValue={p.value ?? ""} />
            </Field>
            <Field label="Minimum (months)" htmlFor={id("min")} hint="Optional floor, e.g. quality records">
              <Input id={id("min")} name="minimumMonths" type="number" min={1} defaultValue={p.minimumMonths ?? ""} />
            </Field>
            <Field label="Counts from" htmlFor={id("basis")}>
              <Select id={id("basis")} name="basis" defaultValue={p.basis}>
                {p.bases.map((b) => (
                  <option key={b} value={b}>
                    {b.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="At the end" htmlFor={id("action")} error={fe.action}>
              <Select id={id("action")} name="action" defaultValue={p.action}>
                {p.actions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Effective from" htmlFor={id("from")}>
              <Input id={id("from")} name="effectiveFrom" type="date" defaultValue={p.today} required />
            </Field>
          </div>
          <Field label="Source of the new value" htmlFor={id("reason")} error={fe.reason} hint="Name the reviewer's memo or decision; the change is unconfirmed until confirmed.">
            <Input id={id("reason")} name="reason" required minLength={3} />
          </Field>
          <Field label="Your password" htmlFor={id("pw")} error={fe.password} hint={PASSWORD_HINT}>
            <Input id={id("pw")} name="password" type="password" autoComplete="current-password" className="sm:max-w-xs" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function PolicyConfirmForm({ dataClass, target }: { dataClass: string; target: string }) {
  const id = (k: string) => `c-${dataClass}-${target}-${k}`.replace(/[^a-zA-Z0-9-]/g, "_");
  return (
    <ActionForm action={confirmPolicyAction} hidden={{ dataClass, target }} submit="Record confirmation" pending="Recording…" size="sm" className="mt-2 flex flex-col gap-3 rounded-[14px] border border-line p-3">
      {(fe) => (
        <>
          <Field label="Reviewer and evidence" htmlFor={id("note")} error={fe.note} hint="e.g. “Legal adviser memo 2026-11-03, 7 years confirmed”">
            <Input id={id("note")} name="note" required minLength={3} />
          </Field>
          <Field label="Your password" htmlFor={id("pw")} error={fe.password} hint={PASSWORD_HINT}>
            <Input id={id("pw")} name="password" type="password" autoComplete="current-password" className="sm:max-w-xs" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function PlaceHoldForm({ kinds, entityTypes }: { kinds: readonly string[]; entityTypes: { value: string; label: string }[] }) {
  return (
    <ActionForm action={placeHoldAction} submit="Place legal hold" pending="Placing…" size="sm">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind" htmlFor="holdKind" error={fe.holdKind}>
            <Select id="holdKind" name="holdKind" defaultValue="complaint">
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Record type" htmlFor="entityType" error={fe.entityType}>
            <Select id="entityType" name="entityType" defaultValue="inventory_lot">
              {entityTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Number or code" htmlFor="reference" error={fe.reference} hint="Lot number, batch number, customer code, complaint or order number, or the user's email">
            <Input id="reference" name="reference" required autoComplete="off" />
          </Field>
          <Field label="Why the records must be kept" htmlFor="holdReason" error={fe.reason}>
            <Input id="holdReason" name="reason" required minLength={5} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ReleaseHoldForm({ id }: { id: string }) {
  return (
    <ActionForm action={releaseHoldAction} hidden={{ id }} submit="Release" pending="Releasing…" size="sm" variant="ghost" className="flex flex-wrap items-end gap-2">
      {(fe) => (
        <Field label="Release note" htmlFor={`rel-${id}`} error={fe.note}>
          <Input id={`rel-${id}`} name="note" required minLength={5} className="!min-h-[36px] w-56 text-[13px]" />
        </Field>
      )}
    </ActionForm>
  );
}

export function DryRunForm() {
  return <ActionForm action={dryRunAction} submit="Run a dry run" pending="Checking…" size="sm" variant="ghost" />;
}

export function ExecutePurgeForm() {
  return (
    <ActionForm action={executePurgeAction} submit="Run purge now" pending="Purging…" size="sm" variant="danger" confirm="Delete the rows past their period under CONFIRMED delete policies? Held records, ledgers and audit are never touched.">
      {(fe) => (
        <Field label="Your password" htmlFor="purge-pw" error={fe.password} hint={PASSWORD_HINT}>
          <Input id="purge-pw" name="password" type="password" autoComplete="current-password" className="sm:max-w-xs" />
        </Field>
      )}
    </ActionForm>
  );
}

export function SignOffDrillForm({ id }: { id: string }) {
  return (
    <ActionForm action={signOffDrillAction} hidden={{ id }} submit="Sign off" pending="Signing…" size="sm" className="flex flex-col gap-2">
      {(fe) => (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Sign-off note" htmlFor={`so-${id}`} error={fe.note}>
            <Input id={`so-${id}`} name="note" required minLength={3} />
          </Field>
          <Field label="Your password" htmlFor={`so-pw-${id}`} error={fe.password} hint={PASSWORD_HINT}>
            <Input id={`so-pw-${id}`} name="password" type="password" autoComplete="current-password" />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
