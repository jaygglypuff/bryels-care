"use client";
import { Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { saveNotificationRuleAction } from "../../action-centre/actions";

export type RuleValue = {
  id?: string;
  version?: number;
  itemKind: string;
  siteId: string | null;
  name: string;
  severity: string;
  ownerRoleCodes: string[];
  escalateAfterHours: number | null;
  escalationRoleCodes: string[];
  emailOnOpen: boolean;
  emailOnEscalation: boolean;
  isActive: boolean;
};

type Opts = { kinds: { kind: string; label: string }[]; roles: { code: string; name: string }[]; sites: { id: string; code: string }[] };

function RoleBoxes({ name, label, selected, roles, error }: { name: string; label: string; selected: string[]; roles: Opts["roles"]; error?: string }) {
  return (
    <fieldset className="min-w-0 rounded-[14px] border border-line p-2">
      <legend className="px-1 text-[13px] font-medium">{label}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {roles.map((r) => (
          <label key={r.code} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name={name} value={r.code} defaultChecked={selected.includes(r.code)} />
            <span className="truncate">{r.name}</span>
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-[12px] text-[var(--bad-fg)]">{error}</p>}
    </fieldset>
  );
}

/** One rule: who is told when an item opens, how severe it is, when and to whom it escalates (audited). */
export function NotificationRuleForm({ value, opts }: { value: RuleValue; opts: Opts }) {
  const p = (k: string) => `${value.id ?? "new"}-${k}`;
  return (
    <ActionForm action={saveNotificationRuleAction} hidden={{ id: value.id, version: value.version !== undefined ? String(value.version) : undefined }} submit={value.id ? "Save rule" : "Add rule"} variant="secondary" size="sm">
      {(fe) => (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Item kind" htmlFor={p("kind")} error={fe.itemKind}>
              <Select id={p("kind")} name="itemKind" defaultValue={value.itemKind}>
                {opts.kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>{k.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Where" htmlFor={p("site")} error={fe.siteId}>
              <Select id={p("site")} name="siteId" defaultValue={value.siteId ?? ""}>
                <option value="">Every site</option>
                {opts.sites.map((s) => (
                  <option key={s.id} value={s.id}>Site {s.code} (beats the organization rule)</option>
                ))}
              </Select>
            </Field>
            <Field label="Rule name" htmlFor={p("name")} error={fe.name}>
              <Input id={p("name")} name="name" defaultValue={value.name} required minLength={3} maxLength={120} />
            </Field>
            <Field label="Severity" htmlFor={p("sev")} error={fe.severity}>
              <Select id={p("sev")} name="severity" defaultValue={value.severity}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <RoleBoxes name="ownerRoleCodes" label="Notify when it opens" selected={value.ownerRoleCodes} roles={opts.roles} error={fe.ownerRoleCodes} />
            <RoleBoxes name="escalationRoleCodes" label="Escalate to" selected={value.escalationRoleCodes} roles={opts.roles} error={fe.escalationRoleCodes} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field label="Escalate when unacknowledged for (hours)" htmlFor={p("hours")} error={fe.escalateAfterHours} hint="Empty = never escalate">
              <Input id={p("hours")} name="escalateAfterHours" type="number" min={1} max={720} defaultValue={value.escalateAfterHours ?? ""} />
            </Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="emailOnOpen" defaultChecked={value.emailOnOpen} /> Email when it opens</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="emailOnEscalation" defaultChecked={value.emailOnEscalation} /> Email on escalation</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={value.isActive} /> Rule active</label>
          </div>
          <Field label="Reason for the change" htmlFor={p("reason")} error={fe.reason}>
            <Input id={p("reason")} name="reason" required minLength={3} maxLength={500} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
