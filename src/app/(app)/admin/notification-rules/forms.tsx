"use client";
import { Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { plainRole } from "@/ui/role-names";
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
          <label key={r.code} className="flex min-h-[44px] items-center gap-2 text-[14px]">
            <input type="checkbox" name={name} value={r.code} defaultChecked={selected.includes(r.code)} className="size-5" />
            <span className="min-w-0 break-words">{plainRole(r.code, r.name)}</span>
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
    <ActionForm action={saveNotificationRuleAction} hidden={{ id: value.id, version: value.version !== undefined ? String(value.version) : undefined }} submit={value.id ? "Save rule" : "Add rule"} variant="primary">
      {(fe) => (
        <div className="space-y-3">
          <Field label="When this happens" htmlFor={p("kind")} error={fe.itemKind}>
            <Select id={p("kind")} name="itemKind" defaultValue={value.itemKind}>
              {opts.kinds.map((k) => (
                <option key={k.kind} value={k.kind}>{k.label}</option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 lg:grid-cols-2">
            <RoleBoxes name="ownerRoleCodes" label="Tell these people" selected={value.ownerRoleCodes} roles={opts.roles} error={fe.ownerRoleCodes} />
            <RoleBoxes name="escalationRoleCodes" label="If nobody reacts, also tell" selected={value.escalationRoleCodes} roles={opts.roles} error={fe.escalationRoleCodes} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nobody reacted after (hours)" htmlFor={p("hours")} error={fe.escalateAfterHours} hint="Empty = never pass it up">
              <Input id={p("hours")} name="escalateAfterHours" type="number" min={1} max={720} defaultValue={value.escalateAfterHours ?? ""} />
            </Field>
            <Field label="Why you change this" htmlFor={p("reason")} error={fe.reason}>
              <Input id={p("reason")} name="reason" required minLength={3} maxLength={500} />
            </Field>
          </div>
          <MoreDetails open={!!(fe.siteId || fe.name || fe.severity)}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Where" htmlFor={p("site")} error={fe.siteId}>
                <Select id={p("site")} name="siteId" defaultValue={value.siteId ?? ""}>
                  <option value="">Every site</option>
                  {opts.sites.map((s) => (
                    <option key={s.id} value={s.id}>Only {s.code} (wins over “every site”)</option>
                  ))}
                </Select>
              </Field>
              <Field label="Name of this rule" htmlFor={p("name")} error={fe.name}>
                <Input id={p("name")} name="name" defaultValue={value.name || "Tell the right people"} required minLength={3} maxLength={120} />
              </Field>
              <Field label="How serious" htmlFor={p("sev")} error={fe.severity}>
                <Select id={p("sev")} name="severity" defaultValue={value.severity}>
                  <option value="info">For information</option>
                  <option value="warning">Look at it soon</option>
                  <option value="critical">Urgent</option>
                </Select>
              </Field>
            </div>
            <label className="flex min-h-[44px] items-center gap-2 text-[14px]"><input type="checkbox" name="emailOnOpen" defaultChecked={value.emailOnOpen} className="size-5" /> Also send an email when it happens</label>
            <label className="flex min-h-[44px] items-center gap-2 text-[14px]"><input type="checkbox" name="emailOnEscalation" defaultChecked={value.emailOnEscalation} className="size-5" /> Also send an email when it is passed up</label>
            <label className="flex min-h-[44px] items-center gap-2 text-[14px]"><input type="checkbox" name="isActive" defaultChecked={value.isActive} className="size-5" /> This rule is on</label>
          </MoreDetails>
        </div>
      )}
    </ActionForm>
  );
}
