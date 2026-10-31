"use client";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { cancelChangeAction, closeChangeAction, createChangeAction, decideChangeAction, implementChangeAction, linkChangeAction, submitChangeAction, updateChangeAction } from "./actions";

type Opt = { id: string; label: string };

/** Grade-5 names of what a change request can change (ADR-088); the stored types stay. */
const ENTITY_WORD: Record<string, string> = {
  formula_revision: "A recipe (new version)",
  routing_revision: "The steps for a product (new version)",
  inspection_plan: "Quality checks for an item (new version)",
  work_instruction_revision: "A work instruction (new version)",
  other: "Something else",
};

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
    <ActionForm action={createChangeAction} hidden={{ capaId: capa?.id }} submit="Save the request" pending="Saving…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Short name" htmlFor="title" error={fe.title} hint="For example: less fragrance in the lavender soap">
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          <Field label="What changes?" htmlFor="entityType" error={fe.entityType}>
            <Select id="entityType" name="entityType" value={type} onChange={(e) => setType(e.target.value)}>
              {entityTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {ENTITY_WORD[t.code] ?? t.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="What exactly should change?" htmlFor="description" error={fe.description}>
              <Textarea id="description" name="description" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Why?" htmlFor="justification" error={fe.justification}>
              <Textarea id="justification" name="justification" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          {capa && <p className="text-[13px] text-fg-2 sm:col-span-2">From fix-and-prevent plan {capa.number}.</p>}
          <div className="sm:col-span-2">
            <MoreDetails>
              {type !== "other" && (
                <Field label="The new version (you can link it later)" htmlFor="entityId" error={fe.entityId} hint="Usually linked once the new version exists.">
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
              <Field label="Only for one site? (empty = all sites)" htmlFor="siteId" error={fe.siteId}>
                <Select id="siteId" name="siteId" defaultValue="">
                  <option value="">All sites</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Done by (optional)" htmlFor="targetDate" error={fe.targetDate}>
                <Input id="targetDate" name="targetDate" type="date" />
              </Field>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function EditChangeForm({ changeControlId, current, riskLevels }: { changeControlId: string; current: { impactAssessment: string | null; riskLevel: string | null; implementationPlan: string | null; targetDate: string | null }; riskLevels: string[] }) {
  return (
    <ActionForm action={updateChangeAction} hidden={{ changeControlId }} submit="Save">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What does this change affect?" htmlFor="impactAssessment" error={fe.impactAssessment} hint="Product quality, shelf life, labels and rules, stock we already have, papers and training.">
              <Textarea id="impactAssessment" name="impactAssessment" maxLength={6000} defaultValue={current.impactAssessment ?? ""} />
            </Field>
          </div>
          <Field label="How risky?" htmlFor="riskLevel" error={fe.riskLevel} hint="The levels are set by the company's QA.">
            <Select id="riskLevel" name="riskLevel" defaultValue={current.riskLevel ?? ""}>
              <option value="">Not rated yet</option>
              {riskLevels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="How will the change be made? (optional)" htmlFor="implementationPlan" error={fe.implementationPlan}>
                <Textarea id="implementationPlan" name="implementationPlan" maxLength={4000} defaultValue={current.implementationPlan ?? ""} />
              </Field>
              <Field label="Done by" htmlFor="targetDate" error={fe.targetDate}>
                <Input id="targetDate" name="targetDate" type="date" defaultValue={current.targetDate ?? ""} />
              </Field>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function LinkRevisionForm({ changeControlId, options, current }: { changeControlId: string; options: Opt[]; current: string | null }) {
  return (
    <ActionForm action={linkChangeAction} hidden={{ changeControlId }} submit="Link" size="sm">
      {(fe) => (
        <Field label="The new version" htmlFor="link-entityId" error={fe.entityId}>
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
  return <ActionForm action={submitChangeAction} hidden={{ changeControlId }} submit="Send for approval" variant="cta" />;
}

export function DecideChangeForm({ changeControlId, stepLabel }: { changeControlId: string; stepLabel: string }) {
  return (
    <ActionForm action={decideChangeAction} hidden={{ changeControlId }} submit={`Save my decision (${stepLabel})`} variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Decision" htmlFor="decision" error={fe.decision}>
            <Select id="decision" name="decision" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="approved">Yes, approve</option>
              <option value="returned">Send back to change it</option>
              <option value="rejected">No, do not make this change</option>
            </Select>
          </Field>
          <Field label="Note (needed when you say no or send back)" htmlFor="note" error={fe.note}>
            <Input id="note" name="note" maxLength={1000} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ImplementChangeForm({ changeControlId }: { changeControlId: string }) {
  return (
    <ActionForm action={implementChangeAction} hidden={{ changeControlId }} submit="Save: the change is made" variant="cta">
      {(fe) => (
        <Field label="What did you change?" htmlFor="impl-note" error={fe.note}>
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
        <Field label="Note (optional)" htmlFor="close-note" error={fe.note}>
          <Input id="close-note" name="note" maxLength={2000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function CancelChangeForm({ changeControlId }: { changeControlId: string }) {
  return (
    <ActionForm action={cancelChangeAction} hidden={{ changeControlId }} submit="Cancel the request" variant="danger" confirm="Cancel this change request?">
      {(fe) => (
        <Field label="Why cancel?" htmlFor="cc-cancel" error={fe.reason}>
          <Input id="cc-cancel" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}
