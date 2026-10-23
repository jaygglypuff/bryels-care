"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { changeEquipmentStatusAction, recordServiceAction, requestOverrideAction } from "../../_eng/actions";

/** Record cleaning, calibration, maintenance, repair, qualification or inspection (W13-05). */
export function ServiceRecordForm({ equipmentId, idempotencyKey, today }: { equipmentId: string; idempotencyKey: string; today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(recordServiceAction, null);
  const [kind, setKind] = useState("cleaning");
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What was done" htmlFor="serviceKind" error={fe.serviceKind}>
          <Select id="serviceKind" name="serviceKind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="cleaning">Cleaning</option>
            <option value="calibration">Calibration</option>
            <option value="preventive_maintenance">Preventive maintenance</option>
            <option value="repair">Repair</option>
            <option value="qualification">Qualification</option>
            <option value="inspection">Inspection</option>
          </Select>
        </Field>
        <Field label="Result" htmlFor="result" error={fe.result}>
          <Select id="result" name="result" defaultValue="pass">
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            {kind !== "calibration" && <option value="completed">Completed</option>}
          </Select>
        </Field>
        {(kind === "calibration" || kind === "preventive_maintenance") && (
          <Field label="Next due date" htmlFor="nextDueDate" error={fe.nextDueDate} hint="Empty = service date + configured interval.">
            <Input id="nextDueDate" name="nextDueDate" type="date" min={today} />
          </Field>
        )}
        <Field label="Certificate / reference no. (optional)" htmlFor="referenceNumber" error={fe.referenceNumber}>
          <Input id="referenceNumber" name="referenceNumber" />
        </Field>
        <Field label="External technician or vendor (optional)" htmlFor="performedByExternal" error={fe.performedByExternal} hint="Empty = you performed it.">
          <Input id="performedByExternal" name="performedByExternal" />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes" error={fe.notes}>
        <Textarea id="notes" name="notes" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Recording…">
        Record service
      </SubmitButton>
    </form>
  );
}

export function StatusForm({ equipmentId, next }: { equipmentId: string; next: readonly string[] }) {
  const [state, action] = useActionState<ActionState, FormData>(changeEquipmentStatusAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <Field label="Change status to" htmlFor="toStatus" error={fe.toStatus}>
        <Select id="toStatus" name="toStatus">
          {next.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reason" htmlFor="status-reason" error={fe.reason}>
        <Input id="status-reason" name="reason" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Saving…">
        Change status
      </SubmitButton>
    </form>
  );
}

/** CX-CAL request: documented risk assessment, time-boxed; a site manager and QA must both approve. */
export function OverrideRequestForm({ equipmentId }: { equipmentId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(requestOverrideAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <Field label="Risk assessment and reason" htmlFor="ov-reason" error={fe.reason} hint="What makes it acceptable (e.g. check weights verified) and why it cannot wait.">
        <Textarea id="ov-reason" name="reason" required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Batch or work reference (optional)" htmlFor="ov-ref" error={fe.workReference}>
          <Input id="ov-ref" name="workReference" />
        </Field>
        <Field label="Valid for (hours)" htmlFor="ov-hours" error={fe.validHours}>
          <Input id="ov-hours" name="validHours" inputMode="numeric" defaultValue="8" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Requesting…">
        Request override
      </SubmitButton>
    </form>
  );
}
