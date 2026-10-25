"use client";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import {
  addCapaActionAction,
  cancelCapaAction,
  closeCapaAction,
  completeCapaActionAction,
  effectivenessAction,
  openCapaAction,
  reopenCapaActionAction,
  submitCapaAction,
  updateCapaAction,
  verifyCapaActionAction,
} from "./actions";

type Person = { id: string; name: string };

function OwnerSelect({ name, people, fe, label = "Owner", defaultValue = "" }: { name: string; people: Person[]; fe: Record<string, string>; label?: string; defaultValue?: string }) {
  return (
    <Field label={label} htmlFor={name} error={fe[name]} hint="People who can see CAPAs at this site.">
      <Select id={name} name={name} required defaultValue={defaultValue}>
        <option value="" disabled>
          Choose…
        </option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function OpenCapaForm({
  sources,
  owners,
  sites,
  deviation,
  complaint,
  defaultSiteId,
}: {
  sources: { code: string; label: string }[];
  owners: Person[];
  sites: { id: string; code: string; name: string }[];
  deviation: { id: string; number: string; description: string } | null;
  complaint: { id: string; number: string; description: string } | null;
  defaultSiteId: string;
}) {
  const [source, setSource] = useState<string>(deviation ? "deviation" : complaint ? "complaint" : "audit");
  return (
    <ActionForm action={openCapaAction} hidden={{ deviationId: deviation?.id, complaintId: complaint?.id }} submit="Open CAPA" pending="Opening…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source" htmlFor="sourceKind" error={fe.sourceKind}>
            <Select id="sourceKind" name="sourceKind" value={source} onChange={(e) => setSource(e.target.value)}>
              {sources
                .filter((s) => (s.code === "deviation" ? !!deviation : s.code === "complaint" ? !!complaint : true))
                .map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
            </Select>
          </Field>
          {source === "deviation" && deviation ? (
            <Field label="Deviation" htmlFor="dev" hint={deviation.description.slice(0, 120)}>
              <Input id="dev" value={deviation.number} readOnly />
            </Field>
          ) : source === "complaint" && complaint ? (
            <Field label="Complaint" htmlFor="cmp" hint={complaint.description.slice(0, 120)}>
              <Input id="cmp" value={complaint.number} readOnly />
            </Field>
          ) : (
            <Field label="Reference (audit finding, document…)" htmlFor="sourceReference" error={fe.sourceReference}>
              <Input id="sourceReference" name="sourceReference" maxLength={300} required={source === "audit"} />
            </Field>
          )}
          {source !== "deviation" && source !== "complaint" && (
            <Field label="Site" htmlFor="siteId" error={fe.siteId}>
              <Select id="siteId" name="siteId" defaultValue={defaultSiteId}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Title" htmlFor="title" error={fe.title}>
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          <OwnerSelect name="ownerId" people={owners} fe={fe} label="CAPA owner" />
          <Field label="Target date (optional)" htmlFor="dueDate" error={fe.dueDate}>
            <Input id="dueDate" name="dueDate" type="date" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Problem statement" htmlFor="problemStatement" error={fe.problemStatement}>
              <Textarea id="problemStatement" name="problemStatement" required minLength={5} maxLength={4000} defaultValue={deviation?.description ?? complaint?.description ?? ""} />
            </Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function EditCapaForm({ capaId, current, owners, canReassign }: { capaId: string; current: { rootCause: string | null; correctiveAction: string | null; preventiveAction: string | null; effectivenessCriteria: string | null; dueDate: string | null; ownerId: string }; owners: Person[]; canReassign: boolean }) {
  return (
    <ActionForm action={updateCapaAction} hidden={{ capaId }} submit="Save record">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Root cause" htmlFor="rootCause" error={fe.rootCause}>
              <Textarea id="rootCause" name="rootCause" maxLength={4000} defaultValue={current.rootCause ?? ""} />
            </Field>
          </div>
          <Field label="Corrective action (summary)" htmlFor="correctiveAction" error={fe.correctiveAction}>
            <Textarea id="correctiveAction" name="correctiveAction" maxLength={4000} defaultValue={current.correctiveAction ?? ""} />
          </Field>
          <Field label="Preventive action (summary)" htmlFor="preventiveAction" error={fe.preventiveAction}>
            <Textarea id="preventiveAction" name="preventiveAction" maxLength={4000} defaultValue={current.preventiveAction ?? ""} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="How effectiveness will be checked" htmlFor="effectivenessCriteria" error={fe.effectivenessCriteria} hint="QA's criterion, e.g. no recurrence in the next 10 batches. The system never sets one.">
              <Textarea id="effectivenessCriteria" name="effectivenessCriteria" maxLength={2000} defaultValue={current.effectivenessCriteria ?? ""} />
            </Field>
          </div>
          <Field label="Target date" htmlFor="dueDate" error={fe.dueDate}>
            <Input id="dueDate" name="dueDate" type="date" defaultValue={current.dueDate ?? ""} />
          </Field>
          {canReassign && <OwnerSelect name="ownerId" people={owners} fe={fe} label="CAPA owner" defaultValue={current.ownerId} />}
        </div>
      )}
    </ActionForm>
  );
}

export function AddActionForm({ capaId, owners, minDate }: { capaId: string; owners: Person[]; minDate: string }) {
  return (
    <ActionForm action={addCapaActionAction} hidden={{ capaId }} submit="Add action">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind" htmlFor="actionKind" error={fe.actionKind}>
            <Select id="actionKind" name="actionKind" defaultValue="corrective">
              <option value="corrective">Corrective</option>
              <option value="preventive">Preventive</option>
            </Select>
          </Field>
          <OwnerSelect name="ownerId" people={owners} fe={fe} label="Action owner" />
          <div className="sm:col-span-2">
            <Field label="What will be done" htmlFor="description" error={fe.description}>
              <Textarea id="description" name="description" required minLength={5} maxLength={2000} />
            </Field>
          </div>
          <Field label="Due date" htmlFor="dueDate" error={fe.dueDate}>
            <Input id="dueDate" name="dueDate" type="date" required min={minDate} />
          </Field>
          <Field label="Verification method (optional)" htmlFor="verificationMethod" error={fe.verificationMethod}>
            <Input id="verificationMethod" name="verificationMethod" maxLength={1000} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ActionStepForm({ actionId, kind }: { actionId: string; kind: "complete" | "verify" | "reopen" | "cancel" }) {
  const cfg = {
    complete: { action: completeCapaActionAction, submit: "Mark done", label: "Evidence (what was done)", name: "note" },
    verify: { action: verifyCapaActionAction, submit: "Verify", label: "Verification note", name: "note" },
    reopen: { action: reopenCapaActionAction, submit: "Send back", label: "Why it is not done", name: "reason" },
    cancel: { action: reopenCapaActionAction, submit: "Cancel action", label: "Reason", name: "reason" },
  }[kind];
  return (
    <ActionForm action={cfg.action} hidden={{ actionId, to: kind === "cancel" ? "cancelled" : kind === "reopen" ? "open" : null }} submit={cfg.submit} size="sm" variant={kind === "cancel" ? "secondary" : "primary"} className="flex flex-col gap-2">
      {(fe) => (
        <Field label={cfg.label} htmlFor={`${kind}-${actionId}`} error={fe[cfg.name]}>
          <Input id={`${kind}-${actionId}`} name={cfg.name} required minLength={5} maxLength={2000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function SubmitCapaForm({ capaId, earliest, days }: { capaId: string; earliest: string; days: number }) {
  return (
    <ActionForm action={submitCapaAction} hidden={{ capaId }} submit="Submit for closure" variant="cta">
      {(fe) => (
        <Field label="Effectiveness check date" htmlFor="effectivenessDueOn" error={fe.effectivenessDueOn} hint={`No earlier than ${earliest} (${days} days, setting quality.capa.effectiveness_check_days; QA to confirm the period).`}>
          <Input id="effectivenessDueOn" name="effectivenessDueOn" type="date" min={earliest} defaultValue={earliest} />
        </Field>
      )}
    </ActionForm>
  );
}

export function EffectivenessForm({ capaId }: { capaId: string }) {
  return (
    <ActionForm action={effectivenessAction} hidden={{ capaId }} submit="Record the check">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Result" htmlFor="result" error={fe.result}>
            <Select id="result" name="result" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="effective">Effective</option>
              <option value="not_effective">Not effective (back to in progress)</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Evidence" htmlFor="evidence" error={fe.evidence}>
              <Textarea id="evidence" name="evidence" required minLength={5} maxLength={4000} />
            </Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function CloseCapaForm({ capaId }: { capaId: string }) {
  return (
    <ActionForm action={closeCapaAction} hidden={{ capaId }} submit="Close CAPA" variant="cta" confirm="Close this CAPA? Closed CAPAs cannot be reopened.">
      {(fe) => (
        <Field label="Closure note (optional)" htmlFor="note" error={fe.note}>
          <Textarea id="note" name="note" maxLength={2000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function CancelCapaForm({ capaId }: { capaId: string }) {
  return (
    <ActionForm action={cancelCapaAction} hidden={{ capaId }} submit="Cancel CAPA" variant="danger" confirm="Cancel this CAPA and its open actions?">
      {(fe) => (
        <Field label="Reason" htmlFor="cancel-reason" error={fe.reason}>
          <Input id="cancel-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}
