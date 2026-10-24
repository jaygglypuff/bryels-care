"use client";
import { useActionState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { removeApprovalRuleAction, saveApprovalRuleAction } from "./actions";

export type RuleFormValue = {
  id?: string;
  version?: number;
  documentType: string;
  siteId: string | null;
  label: string;
  thresholdBasis: string;
  minValue: string | null;
  maxValue: string | null;
  currency: string | null;
  step: number;
  requiredCount: number;
  requiredRoleCodes: string[];
  requiredPermissionCode: string | null;
  posterMayEqualApprover: boolean;
  escalationRoleCodes: string[] | null;
  escalationAfterHours: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
};

type Opts = { documentTypes: string[]; bases: string[]; roles: { code: string; name: string }[]; permissions: string[]; sites: { id: string; code: string }[] };

const num = (v: string | null) => (v === null ? "" : String(Number(v)));

/** Add or edit one rule (owner). Every save needs the owner's password and a reason. */
export function RuleForm({ value, opts }: { value: RuleFormValue; opts: Opts }) {
  const [state, action] = useActionState<ActionState, FormData>(saveApprovalRuleAction, null);
  const fe = state?.fieldErrors ?? {};
  const p = (k: string) => `${value.id ?? "new"}-${k}`;
  return (
    <form action={action} className="mt-2 space-y-3 rounded-[14px] border border-line p-3">
      {value.id && <input type="hidden" name="id" value={value.id} />}
      {value.version !== undefined && <input type="hidden" name="version" value={value.version} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Record type" htmlFor={p("documentType")} error={fe.documentType}>
          <Select id={p("documentType")} name="documentType" defaultValue={value.documentType} disabled={!!value.id}>
            {opts.documentTypes.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </Select>
        </Field>
        {value.id && <input type="hidden" name="documentType" value={value.documentType} />}
        <Field label="Where" htmlFor={p("siteId")} error={fe.siteId}>
          <Select id={p("siteId")} name="siteId" defaultValue={value.siteId ?? ""}>
            <option value="">Whole organization</option>
            {opts.sites.map((s) => (
              <option key={s.id} value={s.id}>Site {s.code} (beats organization rules)</option>
            ))}
          </Select>
        </Field>
        <Field label="Step name" htmlFor={p("label")} error={fe.label}>
          <Input id={p("label")} name="label" defaultValue={value.label} required />
        </Field>
        <Field label="Applies when" htmlFor={p("basis")} error={fe.thresholdBasis}>
          <Select id={p("basis")} name="thresholdBasis" defaultValue={value.thresholdBasis}>
            {opts.bases.map((b) => (
              <option key={b} value={b}>{b.replace(/_/g, " ")}</option>
            ))}
          </Select>
        </Field>
        <Field label="Above (exclusive)" htmlFor={p("min")} error={fe.minValue} hint="Empty = no lower bound">
          <Input id={p("min")} name="minValue" defaultValue={num(value.minValue)} inputMode="decimal" />
        </Field>
        <Field label="Up to (inclusive)" htmlFor={p("max")} error={fe.maxValue} hint="Empty = no upper bound">
          <Input id={p("max")} name="maxValue" defaultValue={num(value.maxValue)} inputMode="decimal" />
        </Field>
        <Field label="Currency" htmlFor={p("cur")} error={fe.currency} hint="For amounts, e.g. PHP">
          <Input id={p("cur")} name="currency" defaultValue={value.currency ?? ""} maxLength={3} className="uppercase" />
        </Field>
        <Field label="Step" htmlFor={p("step")} error={fe.step}>
          <Input id={p("step")} name="step" type="number" min={1} max={5} defaultValue={value.step} />
        </Field>
        <Field label="Approvers needed" htmlFor={p("count")} error={fe.requiredCount}>
          <Input id={p("count")} name="requiredCount" type="number" min={1} max={5} defaultValue={value.requiredCount} />
        </Field>
      </div>
      <fieldset className="text-[13px]">
        <legend className="mb-1 font-medium">Who may approve (any of; none = anyone with the permission)</legend>
        <div className="flex flex-wrap gap-3">
          {opts.roles.map((r) => (
            <label key={r.code} className="flex items-center gap-1">
              <input type="checkbox" name="requiredRoleCodes" value={r.code} defaultChecked={value.requiredRoleCodes.includes(r.code)} /> {r.name}
            </label>
          ))}
        </div>
        {fe.requiredRoleCodes && <p className="text-[var(--bad-fg)]">{fe.requiredRoleCodes}</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Permission" htmlFor={p("perm")} error={fe.requiredPermissionCode} hint="Empty = the record type's approve permission">
          <Select id={p("perm")} name="requiredPermissionCode" defaultValue={value.requiredPermissionCode ?? ""}>
            <option value="">Record type default</option>
            {opts.permissions.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </Select>
        </Field>
        <Field label="Escalate after (hours)" htmlFor={p("esc")} error={fe.escalationAfterHours}>
          <Input id={p("esc")} name="escalationAfterHours" type="number" min={1} defaultValue={value.escalationAfterHours ?? ""} />
        </Field>
        <Field label="Escalation role" htmlFor={p("escr")}>
          <Select id={p("escr")} name="escalationRoleCodes" defaultValue={value.escalationRoleCodes?.[0] ?? ""}>
            <option value="">None</option>
            {opts.roles.map((r) => (
              <option key={r.code} value={r.code}>{r.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Effective from" htmlFor={p("from")} error={fe.effectiveFrom}>
          <Input id={p("from")} name="effectiveFrom" type="date" defaultValue={value.effectiveFrom} required />
        </Field>
        <Field label="Effective until (exclusive)" htmlFor={p("to")} error={fe.effectiveTo}>
          <Input id={p("to")} name="effectiveTo" type="date" defaultValue={value.effectiveTo ?? ""} />
        </Field>
        <Field label="Policy reference" htmlFor={p("src")} error={fe.source} hint="e.g. A-PM-15 or the owner's memo">
          <Input id={p("src")} name="source" defaultValue={value.source ?? ""} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="posterMayEqualApprover" defaultChecked={value.posterMayEqualApprover} /> The person who posts may be the approver (A-PM-10)
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reason for this change" htmlFor={p("reason")} error={fe.reason}>
          <Input id={p("reason")} name="reason" required minLength={3} />
        </Field>
        <Field label="Your password" htmlFor={p("pw")} error={fe.password}>
          <Input id={p("pw")} name="password" type="password" required autoComplete="current-password" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton size="sm" pendingText="Saving…">{value.id ? "Save rule" : "Add rule"}</SubmitButton>
    </form>
  );
}

export function RemoveRuleForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(removeApprovalRuleAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="reason" required minLength={3} placeholder="Reason" aria-label="Reason for removing" className="!min-h-[36px] w-44 text-[13px]" />
      <Input name="password" type="password" required placeholder="Your password" aria-label="Your password" autoComplete="current-password" className="!min-h-[36px] w-40 text-[13px]" />
      <SubmitButton size="sm" variant="ghost" pendingText="Removing…">Remove rule</SubmitButton>
      {fe.password && <p className="w-full text-[13px] text-[var(--bad-fg)]">{fe.password}</p>}
      <FormMessage state={state} />
    </form>
  );
}
