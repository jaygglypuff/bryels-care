"use client";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
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

function OwnerSelect({ name, people, fe, label = "Who looks after it", defaultValue = "" }: { name: string; people: Person[]; fe: Record<string, string>; label?: string; defaultValue?: string }) {
  return (
    <Field label={label} htmlFor={name} error={fe[name]}>
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
  me,
}: {
  sources: { code: string; label: string }[];
  owners: Person[];
  sites: { id: string; code: string; name: string }[];
  deviation: { id: string; number: string; description: string } | null;
  complaint: { id: string; number: string; description: string } | null;
  defaultSiteId: string;
  /** The signed-in user: the default person who looks after the plan. */
  me?: string;
}) {
  const [source, setSource] = useState<string>(deviation ? "deviation" : complaint ? "complaint" : "other");
  const defaultOwner = me && owners.some((o) => o.id === me) ? me : "";
  return (
    <ActionForm action={openCapaAction} hidden={{ deviationId: deviation?.id, complaintId: complaint?.id }} submit="Start the plan" pending="Saving…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Short name" htmlFor="title" error={fe.title} hint="For example: soap bars crack after cooling">
              <Input id="title" name="title" required maxLength={200} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="What is the problem?" htmlFor="problemStatement" error={fe.problemStatement}>
              <Textarea id="problemStatement" name="problemStatement" required minLength={5} maxLength={4000} defaultValue={deviation?.description ?? complaint?.description ?? ""} />
            </Field>
          </div>
          <OwnerSelect name="ownerId" people={owners} fe={fe} defaultValue={defaultOwner} />
          <Field label="Finish by (optional)" htmlFor="dueDate" error={fe.dueDate}>
            <Input id="dueDate" name="dueDate" type="date" />
          </Field>
          <div className="sm:col-span-2">
            <MoreDetails open={!!fe.sourceKind || !!fe.sourceReference || !!fe.siteId}>
              <Field label="Where does it come from?" htmlFor="sourceKind" error={fe.sourceKind}>
                <Select id="sourceKind" name="sourceKind" value={source} onChange={(e) => setSource(e.target.value)}>
                  {sources
                    .filter((s) => (s.code === "deviation" ? !!deviation : s.code === "complaint" ? !!complaint : true))
                    .map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code === "deviation" ? "Problem report" : s.code === "change_control" ? "Change request" : s.label}
                      </option>
                    ))}
                </Select>
              </Field>
              {source === "deviation" && deviation ? (
                <p className="text-[13px] text-fg-2">Problem report {deviation.number}: {deviation.description.slice(0, 120)}</p>
              ) : source === "complaint" && complaint ? (
                <p className="text-[13px] text-fg-2">Complaint {complaint.number}: {complaint.description.slice(0, 120)}</p>
              ) : (
                <Field label={source === "audit" ? "Which audit finding?" : "Reference (optional)"} htmlFor="sourceReference" error={fe.sourceReference}>
                  <Input id="sourceReference" name="sourceReference" maxLength={300} required={source === "audit"} />
                </Field>
              )}
              {source !== "deviation" && source !== "complaint" && sites.length > 1 && (
                <Field label="Site" htmlFor="siteId" error={fe.siteId}>
                  <Select id="siteId" name="siteId" defaultValue={defaultSiteId}>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.code}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </MoreDetails>
            {source !== "deviation" && source !== "complaint" && sites.length <= 1 && <input type="hidden" name="siteId" value={defaultSiteId} />}
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function EditCapaForm({ capaId, current, owners, canReassign }: { capaId: string; current: { rootCause: string | null; correctiveAction: string | null; preventiveAction: string | null; effectivenessCriteria: string | null; dueDate: string | null; ownerId: string }; owners: Person[]; canReassign: boolean }) {
  return (
    <ActionForm action={updateCapaAction} hidden={{ capaId }} submit="Save">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What caused the problem?" htmlFor="rootCause" error={fe.rootCause}>
              <Textarea id="rootCause" name="rootCause" maxLength={4000} defaultValue={current.rootCause ?? ""} />
            </Field>
          </div>
          <Field label="What we fix now (short)" htmlFor="correctiveAction" error={fe.correctiveAction}>
            <Textarea id="correctiveAction" name="correctiveAction" maxLength={4000} defaultValue={current.correctiveAction ?? ""} />
          </Field>
          <Field label="What we change so it does not happen again (short)" htmlFor="preventiveAction" error={fe.preventiveAction}>
            <Textarea id="preventiveAction" name="preventiveAction" maxLength={4000} defaultValue={current.preventiveAction ?? ""} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="How will we know the fix worked?" htmlFor="effectivenessCriteria" error={fe.effectivenessCriteria} hint="QA decides, e.g. the problem does not come back in the next 10 batches. The system never sets one.">
              <Textarea id="effectivenessCriteria" name="effectivenessCriteria" maxLength={2000} defaultValue={current.effectivenessCriteria ?? ""} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="Finish by" htmlFor="dueDate" error={fe.dueDate}>
                <Input id="dueDate" name="dueDate" type="date" defaultValue={current.dueDate ?? ""} />
              </Field>
              {canReassign && <OwnerSelect name="ownerId" people={owners} fe={fe} defaultValue={current.ownerId} />}
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function AddActionForm({ capaId, owners, minDate }: { capaId: string; owners: Person[]; minDate: string }) {
  return (
    <ActionForm action={addCapaActionAction} hidden={{ capaId }} submit="Add">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What will be done?" htmlFor="description" error={fe.description}>
              <Textarea id="description" name="description" required minLength={5} maxLength={2000} />
            </Field>
          </div>
          <Field label="Is it a fix now, or a change so it does not happen again?" htmlFor="actionKind" error={fe.actionKind}>
            <Select id="actionKind" name="actionKind" defaultValue="corrective">
              <option value="corrective">Fix now</option>
              <option value="preventive">Change so it does not happen again</option>
            </Select>
          </Field>
          <OwnerSelect name="ownerId" people={owners} fe={fe} label="Who does it?" />
          <Field label="Done by" htmlFor="dueDate" error={fe.dueDate}>
            <Input id="dueDate" name="dueDate" type="date" required min={minDate} />
          </Field>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="How will someone check it is done? (optional)" htmlFor="verificationMethod" error={fe.verificationMethod}>
                <Input id="verificationMethod" name="verificationMethod" maxLength={1000} />
              </Field>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function ActionStepForm({ actionId, kind }: { actionId: string; kind: "complete" | "verify" | "reopen" | "cancel" }) {
  const cfg = {
    complete: { action: completeCapaActionAction, submit: "Mark as done", label: "What was done?", name: "note" },
    verify: { action: verifyCapaActionAction, submit: "Checked: it is done", label: "What did you check?", name: "note" },
    reopen: { action: reopenCapaActionAction, submit: "Not done – send back", label: "Why is it not done?", name: "reason" },
    cancel: { action: reopenCapaActionAction, submit: "Cancel this", label: "Why cancel?", name: "reason" },
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
    <ActionForm action={submitCapaAction} hidden={{ capaId }} submit="Send for the final check" variant="cta">
      {(fe) => (
        <Field label="Check that the fix worked on" htmlFor="effectivenessDueOn" error={fe.effectivenessDueOn} hint={`Not before ${earliest} (${days} days; setting quality.capa.effectiveness_check_days, QA to confirm the period).`}>
          <Input id="effectivenessDueOn" name="effectivenessDueOn" type="date" min={earliest} defaultValue={earliest} />
        </Field>
      )}
    </ActionForm>
  );
}

export function EffectivenessForm({ capaId }: { capaId: string }) {
  return (
    <ActionForm action={effectivenessAction} hidden={{ capaId }} submit="Save the check" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Did the fix work?" htmlFor="result" error={fe.result}>
            <Select id="result" name="result" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="effective">Yes, it worked</option>
              <option value="not_effective">No (back to being fixed)</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="What did you see?" htmlFor="evidence" error={fe.evidence}>
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
    <ActionForm action={closeCapaAction} hidden={{ capaId }} submit="Close the plan" variant="cta" confirm="Close this plan? A closed plan cannot be opened again.">
      {(fe) => (
        <Field label="Note (optional)" htmlFor="note" error={fe.note}>
          <Textarea id="note" name="note" maxLength={2000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function CancelCapaForm({ capaId }: { capaId: string }) {
  return (
    <ActionForm action={cancelCapaAction} hidden={{ capaId }} submit="Cancel the plan" variant="danger" confirm="Cancel this plan and everything still to do in it?">
      {(fe) => (
        <Field label="Why cancel?" htmlFor="cancel-reason" error={fe.reason}>
          <Input id="cancel-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}
