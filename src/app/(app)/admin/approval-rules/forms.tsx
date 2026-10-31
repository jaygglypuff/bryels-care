"use client";
import { useActionState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { plainRole } from "@/ui/role-names";
import { basisText, docTypeText } from "./words";
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
        <Field label="What needs an OK" htmlFor={p("documentType")} error={fe.documentType}>
          <Select id={p("documentType")} name="documentType" defaultValue={value.documentType} disabled={!!value.id}>
            {opts.documentTypes.map((t) => (
              <option key={t} value={t}>{docTypeText(t)}</option>
            ))}
          </Select>
        </Field>
        {value.id && <input type="hidden" name="documentType" value={value.documentType} />}
        <Field label="When" htmlFor={p("basis")} error={fe.thresholdBasis}>
          <Select id={p("basis")} name="thresholdBasis" defaultValue={value.thresholdBasis}>
            {opts.bases.map((b) => (
              <option key={b} value={b}>{basisText(b)}</option>
            ))}
          </Select>
        </Field>
        <Field label="More than" htmlFor={p("min")} error={fe.minValue} hint="Empty = any amount">
          <Input id={p("min")} name="minValue" defaultValue={num(value.minValue)} inputMode="decimal" />
        </Field>
      </div>
      <fieldset className="text-[14px]">
        <legend className="mb-1 font-medium">Who may say OK (any of them; none ticked = anyone allowed to approve this)</legend>
        <div className="grid gap-x-3 sm:grid-cols-3">
          {opts.roles.map((r) => (
            <label key={r.code} className="flex min-h-[44px] items-center gap-2">
              <input type="checkbox" name="requiredRoleCodes" value={r.code} defaultChecked={value.requiredRoleCodes.includes(r.code)} className="size-5" /> {plainRole(r.code, r.name)}
            </label>
          ))}
        </div>
        {fe.requiredRoleCodes && <p className="text-[var(--bad-fg)]">{fe.requiredRoleCodes}</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Why you change this" htmlFor={p("reason")} error={fe.reason}>
          <Input id={p("reason")} name="reason" required minLength={3} />
        </Field>
        <Field label="Your password" htmlFor={p("pw")} error={fe.password} hint="Not needed within 10 minutes of “Confirm it’s you”.">
          <Input id={p("pw")} name="password" type="password" autoComplete="current-password" />
        </Field>
      </div>
      <MoreDetails open={!!(fe.siteId || fe.label || fe.maxValue || fe.currency || fe.step || fe.requiredCount || fe.requiredPermissionCode || fe.escalationAfterHours || fe.effectiveFrom || fe.effectiveTo || fe.source)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Where" htmlFor={p("siteId")} error={fe.siteId}>
            <Select id={p("siteId")} name="siteId" defaultValue={value.siteId ?? ""}>
              <option value="">All sites</option>
              {opts.sites.map((s) => (
                <option key={s.id} value={s.id}>Only {s.code} (wins over “all sites”)</option>
              ))}
            </Select>
          </Field>
          <Field label="Name of this step" htmlFor={p("label")} error={fe.label}>
            <Input id={p("label")} name="label" defaultValue={value.label || "Approval"} required />
          </Field>
          <Field label="Up to" htmlFor={p("max")} error={fe.maxValue} hint="Empty = no top limit">
            <Input id={p("max")} name="maxValue" defaultValue={num(value.maxValue)} inputMode="decimal" />
          </Field>
          <Field label="Money" htmlFor={p("cur")} error={fe.currency} hint="For amounts">
            <Select id={p("cur")} name="currency" defaultValue={value.currency ?? "PHP"}>
              <option value="PHP">Philippine peso (PHP)</option>
              {value.currency && value.currency !== "PHP" && <option value={value.currency}>{value.currency}</option>}
              <option value="">Not money</option>
            </Select>
          </Field>
          <Field label="Which step (1 = first)" htmlFor={p("step")} error={fe.step}>
            <Input id={p("step")} name="step" type="number" min={1} max={5} defaultValue={value.step} />
          </Field>
          <Field label="How many people must say OK" htmlFor={p("count")} error={fe.requiredCount}>
            <Input id={p("count")} name="requiredCount" type="number" min={1} max={5} defaultValue={value.requiredCount} />
          </Field>
          <Field label="Technical permission" htmlFor={p("perm")} error={fe.requiredPermissionCode} hint="Empty = the usual one for this kind">
            <Select id={p("perm")} name="requiredPermissionCode" defaultValue={value.requiredPermissionCode ?? ""}>
              <option value="">The usual one</option>
              {opts.permissions.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label="If nobody decides, tell after (hours)" htmlFor={p("esc")} error={fe.escalationAfterHours}>
            <Input id={p("esc")} name="escalationAfterHours" type="number" min={1} defaultValue={value.escalationAfterHours ?? ""} />
          </Field>
          <Field label="…and tell" htmlFor={p("escr")}>
            <Select id={p("escr")} name="escalationRoleCodes" defaultValue={value.escalationRoleCodes?.[0] ?? ""}>
              <option value="">Nobody</option>
              {opts.roles.map((r) => (
                <option key={r.code} value={r.code}>{plainRole(r.code, r.name)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Starts on" htmlFor={p("from")} error={fe.effectiveFrom}>
            <Input id={p("from")} name="effectiveFrom" type="date" defaultValue={value.effectiveFrom} required />
          </Field>
          <Field label="Ends before" htmlFor={p("to")} error={fe.effectiveTo}>
            <Input id={p("to")} name="effectiveTo" type="date" defaultValue={value.effectiveTo ?? ""} />
          </Field>
          <Field label="Where this rule comes from" htmlFor={p("src")} error={fe.source} hint="For example the owner's memo">
            <Input id={p("src")} name="source" defaultValue={value.source ?? ""} />
          </Field>
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
          <input type="checkbox" name="posterMayEqualApprover" defaultChecked={value.posterMayEqualApprover} className="size-5" /> The person who saves it may also be the one who says OK
        </label>
      </MoreDetails>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">{value.id ? "Save rule" : "Add rule"}</SubmitButton>
    </form>
  );
}

export function RemoveRuleForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(removeApprovalRuleAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="reason" required minLength={3} placeholder="Why" aria-label="Why you remove it" className="w-full sm:w-44" />
      <Input name="password" type="password" placeholder="Your password" aria-label="Your password" autoComplete="current-password" className="w-full sm:w-40" />
      <SubmitButton size="sm" variant="ghost" pendingText="Removing…">Remove rule</SubmitButton>
      {fe.password && <p className="w-full text-[13px] text-[var(--bad-fg)]">{fe.password}</p>}
      <FormMessage state={state} />
    </form>
  );
}
