"use client";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { cancelChangeAction, closeChangeAction, createChangeAction, decideChangeAction, implementChangeAction, linkChangeAction, submitChangeAction, updateChangeAction } from "./actions";

type Opt = { id: string; label: string };

export function CreateChangeForm({
  entityTypes,
  options,
  sites,
  capa,
  defaultType,
  defaultEntityId,
}: {
  entityTypes: { code: string; label: string }[];
  options: Record<string, Opt[]>;
  sites: { id: string; code: string; name: string }[];
  capa: { id: string; number: string } | null;
  defaultType: string;
  defaultEntityId: string | null;
}) {
  const [type, setType] = useState(defaultType);
  const opts = options[type] ?? [];
  return (
    <ActionForm action={createChangeAction} hidden={{ capaId: capa?.id }} submit="Create proposal" pending="Saving…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" htmlFor="title" error={fe.title}>
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          <Field label="What changes" htmlFor="entityType" error={fe.entityType}>
            <Select id="entityType" name="entityType" value={type} onChange={(e) => setType(e.target.value)}>
              {entityTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          {type !== "other" && (
            <Field label="Implementing revision (optional now)" htmlFor="entityId" error={fe.entityId} hint="It can be linked later, usually once the new revision exists.">
              <Select id="entityId" name="entityId" defaultValue={defaultEntityId ?? ""} key={type}>
                <option value="">Link later</option>
                {opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Site (blank = organization-wide)" htmlFor="siteId" error={fe.siteId}>
            <Select id="siteId" name="siteId" defaultValue="">
              <option value="">Organization-wide</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target date (optional)" htmlFor="targetDate" error={fe.targetDate}>
            <Input id="targetDate" name="targetDate" type="date" />
          </Field>
          {capa && (
            <Field label="From CAPA" htmlFor="capa">
              <Input id="capa" value={capa.number} readOnly />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Description of the change" htmlFor="description" error={fe.description}>
              <Textarea id="description" name="description" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Justification" htmlFor="justification" error={fe.justification}>
              <Textarea id="justification" name="justification" required minLength={5} maxLength={4000} />
            </Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function EditChangeForm({ changeControlId, current, riskLevels }: { changeControlId: string; current: { impactAssessment: string | null; riskLevel: string | null; implementationPlan: string | null; targetDate: string | null }; riskLevels: string[] }) {
  return (
    <ActionForm action={updateChangeAction} hidden={{ changeControlId }} submit="Save proposal">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Impact assessment" htmlFor="impactAssessment" error={fe.impactAssessment} hint="Product quality, stability, regulatory and labels, stock on hand, documents and training.">
              <Textarea id="impactAssessment" name="impactAssessment" maxLength={6000} defaultValue={current.impactAssessment ?? ""} />
            </Field>
          </div>
          <Field label="Risk level" htmlFor="riskLevel" error={fe.riskLevel} hint="Levels are configured by the company's QA.">
            <Select id="riskLevel" name="riskLevel" defaultValue={current.riskLevel ?? ""}>
              <option value="">Not assessed</option>
              {riskLevels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target date" htmlFor="targetDate" error={fe.targetDate}>
            <Input id="targetDate" name="targetDate" type="date" defaultValue={current.targetDate ?? ""} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Implementation plan" htmlFor="implementationPlan" error={fe.implementationPlan}>
              <Textarea id="implementationPlan" name="implementationPlan" maxLength={4000} defaultValue={current.implementationPlan ?? ""} />
            </Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function LinkRevisionForm({ changeControlId, options, current }: { changeControlId: string; options: Opt[]; current: string | null }) {
  return (
    <ActionForm action={linkChangeAction} hidden={{ changeControlId }} submit="Link revision" size="sm">
      {(fe) => (
        <Field label="Implementing revision" htmlFor="link-entityId" error={fe.entityId}>
          <Select id="link-entityId" name="entityId" defaultValue={current ?? ""}>
            <option value="">None</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </ActionForm>
  );
}

export function SubmitChangeForm({ changeControlId }: { changeControlId: string }) {
  return <ActionForm action={submitChangeAction} hidden={{ changeControlId }} submit="Submit for approval" variant="cta" />;
}

export function DecideChangeForm({ changeControlId, stepLabel }: { changeControlId: string; stepLabel: string }) {
  return (
    <ActionForm action={decideChangeAction} hidden={{ changeControlId }} submit={`Record decision (${stepLabel})`} variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Decision" htmlFor="decision" error={fe.decision}>
            <Select id="decision" name="decision" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="approved">Approve</option>
              <option value="returned">Return for rework</option>
              <option value="rejected">Reject</option>
            </Select>
          </Field>
          <Field label="Note (required to return or reject)" htmlFor="note" error={fe.note}>
            <Input id="note" name="note" maxLength={1000} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ImplementChangeForm({ changeControlId }: { changeControlId: string }) {
  return (
    <ActionForm action={implementChangeAction} hidden={{ changeControlId }} submit="Record as implemented">
      {(fe) => (
        <Field label="What was implemented" htmlFor="impl-note" error={fe.note}>
          <Textarea id="impl-note" name="note" required minLength={5} maxLength={4000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function CloseChangeForm({ changeControlId }: { changeControlId: string }) {
  return (
    <ActionForm action={closeChangeAction} hidden={{ changeControlId }} submit="Confirm and close" variant="cta">
      {(fe) => (
        <Field label="Closure note (optional)" htmlFor="close-note" error={fe.note}>
          <Input id="close-note" name="note" maxLength={2000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function CancelChangeForm({ changeControlId }: { changeControlId: string }) {
  return (
    <ActionForm action={cancelChangeAction} hidden={{ changeControlId }} submit="Cancel change" variant="danger" confirm="Cancel this change control?">
      {(fe) => (
        <Field label="Reason" htmlFor="cc-cancel" error={fe.reason}>
          <Input id="cc-cancel" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}
