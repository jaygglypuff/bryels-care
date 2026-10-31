"use client";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { ScanOrPick } from "@/ui/scan-or-pick";
import { PRIORITY_OPTIONS } from "./_ui";
import {
  assignWorkOrderAction,
  completeWorkOrderAction,
  createPlanAction,
  createWorkOrderAction,
  issuePartAction,
  planStatusAction,
  planWorkOrderAction,
  registerSparePartAction,
  removeSparePartAction,
  updatePlanAction,
  workOrderTransitionAction,
} from "./actions";

type Person = { id: string; name: string; siteId?: string };
type Eq = { id: string; code: string; name: string; siteId: string; siteCode: string; status?: string };

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
      <input type="checkbox" name={name} value="yes" defaultChecked={defaultChecked} className="size-5" /> {label}
    </label>
  );
}

function PrioritySelect({ id, fe, defaultValue = "normal" }: { id: string; fe: Record<string, string>; defaultValue?: string }) {
  return (
    <Field label="How urgent?" htmlFor={id} error={fe.priority}>
      <Select id={id} name="priority" defaultValue={defaultValue}>
        {PRIORITY_OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const eqLabel = (e: Eq) => `${e.name} · ${e.code} (${e.siteCode})`;

function PeopleSelect({ id, name, people, label, defaultValue, fe }: { id: string; name: string; people: Person[]; label: string; defaultValue?: string | null; fe: Record<string, string> }) {
  return (
    <Field label={label} htmlFor={id} error={fe[name]}>
      <Select id={id} name={name} defaultValue={defaultValue ?? ""}>
        <option value="">Nobody yet</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function CreatePlanForm({ equipment, technicians, preselected, dueSoonDays }: { equipment: Eq[]; technicians: Person[]; preselected: string | null; dueSoonDays: number }) {
  const [trigger, setTrigger] = useState("time");
  const [eqId, setEqId] = useState(preselected ?? "");
  const site = equipment.find((e) => e.id === eqId)?.siteId;
  return (
    <ActionForm action={createPlanAction} submit="Save" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Which machine?" htmlFor="equipmentId" error={fe.equipmentId}>
            <Select id="equipmentId" name="equipmentId" required value={eqId} onChange={(e) => setEqId(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {eqLabel(e)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What to do (short)" htmlFor="title" error={fe.title} hint="For example: clean and grease the mixer">
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          {trigger === "time" ? (
            <Field label="How often? Every … days" htmlFor="intervalDays" error={fe.intervalDays}>
              <Input id="intervalDays" name="intervalDays" inputMode="numeric" required defaultValue="30" />
            </Field>
          ) : (
            <Field label="How often? Every … (batches or hours)" htmlFor="usageInterval" error={fe.usageInterval}>
              <Input id="usageInterval" name="usageInterval" inputMode="decimal" required />
            </Field>
          )}
          <PeopleSelect id="responsibleUserId" name="responsibleUserId" people={technicians.filter((t) => !site || t.siteId === site)} label="Who does it?" fe={fe} />
          <div className="sm:col-span-2">
            <Field label="Steps to follow (optional)" htmlFor="instructions" error={fe.instructions} hint="As written by the maintenance lead or the machine's manual.">
              <Textarea id="instructions" name="instructions" maxLength={4000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="Count by" htmlFor="triggerKind" error={fe.triggerKind}>
                <Select id="triggerKind" name="triggerKind" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                  <option value="time">Days (every so many days)</option>
                  <option value="usage">Use (batches or hours)</option>
                </Select>
              </Field>
              {trigger === "time" ? (
                <Field label="First time on (empty = today + the days above)" htmlFor="firstDueOn" error={fe.firstDueOn}>
                  <Input id="firstDueOn" name="firstDueOn" type="date" />
                </Field>
              ) : (
                <Field label="Count" htmlFor="usageMetric" error={fe.usageMetric}>
                  <Select id="usageMetric" name="usageMetric" defaultValue="batches">
                    <option value="batches">Batches that used the machine</option>
                    <option value="hours">Hours of use</option>
                  </Select>
                </Field>
              )}
              <Field label={`Show “due soon” this many days before (empty = ${dueSoonDays})`} htmlFor="leadDays" error={fe.leadDays}>
                <Input id="leadDays" name="leadDays" inputMode="numeric" />
              </Field>
              <Check name="takesEquipmentDown" label="The machine cannot be used while this is done" defaultChecked />
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function EditPlanForm({ plan, technicians }: { plan: { id: string; title: string; instructions: string | null; triggerKind: string; intervalDays: number | null; nextDueOn: string | null; usageInterval: string | null; leadDays: number | null; takesEquipmentDown: boolean; responsibleUserId: string | null }; technicians: Person[] }) {
  return (
    <ActionForm action={updatePlanAction} hidden={{ planId: plan.id }} submit="Save">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What to do (short)" htmlFor="p-title" error={fe.title}>
            <Input id="p-title" name="title" required maxLength={200} defaultValue={plan.title} />
          </Field>
          {plan.triggerKind === "time" ? (
            <>
              <Field label="How often? Every … days" htmlFor="p-intervalDays" error={fe.intervalDays}>
                <Input id="p-intervalDays" name="intervalDays" inputMode="numeric" defaultValue={plan.intervalDays ?? ""} />
              </Field>
              <Field label="Next time on" htmlFor="p-nextDueOn" error={fe.nextDueOn}>
                <Input id="p-nextDueOn" name="nextDueOn" type="date" defaultValue={plan.nextDueOn ?? ""} />
              </Field>
            </>
          ) : (
            <Field label="How often? Every … (batches or hours)" htmlFor="p-usageInterval" error={fe.usageInterval}>
              <Input id="p-usageInterval" name="usageInterval" inputMode="decimal" defaultValue={plan.usageInterval ? String(Number(plan.usageInterval)) : ""} />
            </Field>
          )}
          <PeopleSelect id="p-responsible" name="responsibleUserId" people={technicians} label="Who does it?" defaultValue={plan.responsibleUserId} fe={fe} />
          <div className="sm:col-span-2">
            <Field label="Steps to follow" htmlFor="p-instructions" error={fe.instructions}>
              <Textarea id="p-instructions" name="instructions" maxLength={4000} defaultValue={plan.instructions ?? ""} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="Show “due soon” this many days before (empty = setting)" htmlFor="p-leadDays" error={fe.leadDays}>
                <Input id="p-leadDays" name="leadDays" inputMode="numeric" defaultValue={plan.leadDays ?? ""} />
              </Field>
              <Check name="takesEquipmentDown" label="The machine cannot be used while this is done" defaultChecked={plan.takesEquipmentDown} />
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function PlanStatusForm({ planId, to, label }: { planId: string; to: "active" | "paused" | "retired"; label: string }) {
  return (
    <ActionForm action={planStatusAction} hidden={{ planId, toStatus: to }} submit={label} size="sm" variant={to === "retired" ? "danger" : "secondary"} className="flex flex-col gap-2">
      {(fe) =>
        to === "active" ? null : (
          <Field label="Why?" htmlFor={`ps-${to}`} error={fe.reason}>
            <Input id={`ps-${to}`} name="reason" required minLength={5} maxLength={1000} />
          </Field>
        )
      }
    </ActionForm>
  );
}

export function PlanWorkOrderForm({ planId, technicians, defaultAssignee, defaultDue }: { planId: string; technicians: Person[]; defaultAssignee: string | null; defaultDue: string | null }) {
  return (
    <ActionForm action={planWorkOrderAction} hidden={{ planId }} submit="Make the job" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <PeopleSelect id="pw-assignedTo" name="assignedTo" people={technicians} label="Who does it?" defaultValue={defaultAssignee} fe={fe} />
          <Field label="Do it by" htmlFor="pw-dueDate" error={fe.dueDate}>
            <Input id="pw-dueDate" name="dueDate" type="date" defaultValue={defaultDue ?? ""} />
          </Field>
          <PrioritySelect id="pw-priority" fe={fe} />
        </div>
      )}
    </ActionForm>
  );
}

export function CreateWorkOrderForm({ equipment, technicians, preselected }: { equipment: Eq[]; technicians: Person[]; preselected: string | null }) {
  return (
    <ActionForm action={createWorkOrderAction} submit="Send to the technician" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Which machine?" htmlFor="w-equipmentId" error={fe.equipmentId}>
            <Select id="w-equipmentId" name="equipmentId" required defaultValue={preselected ?? ""}>
              <option value="" disabled>
                Choose…
              </option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {eqLabel(e)}
                  {e.status && e.status !== "in_service" ? ` (${e.status.replace(/_/g, " ")})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What is wrong?" htmlFor="w-title" error={fe.title} hint="For example: the mixer makes a loud noise">
            <Input id="w-title" name="title" required maxLength={200} />
          </Field>
          <PrioritySelect id="w-priority" fe={fe} />
          <PeopleSelect id="w-assignedTo" name="assignedTo" people={technicians} label="Which technician? (optional)" fe={fe} />
          <div className="sm:col-span-2">
            <Check name="reportedDown" label="It is broken now: nobody may use it until it is fixed" />
          </div>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="Kind of job" htmlFor="w-kind" error={fe.kind}>
                <Select id="w-kind" name="kind" defaultValue="corrective">
                  <option value="corrective">Repair (something is broken)</option>
                  <option value="inspection">Check</option>
                </Select>
              </Field>
              <Field label="Fix by (optional)" htmlFor="w-dueDate" error={fe.dueDate}>
                <Input id="w-dueDate" name="dueDate" type="date" />
              </Field>
              <Field label="More about the problem (optional)" htmlFor="w-description" error={fe.description}>
                <Textarea id="w-description" name="description" maxLength={4000} />
              </Field>
              <Check name="takesEquipmentDown" label="The machine cannot be used while the repair is done" defaultChecked />
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function TransitionForm({ workOrderId, to, label, needsReason }: { workOrderId: string; to: "in_progress" | "on_hold" | "cancelled"; label: string; needsReason?: boolean }) {
  return (
    <ActionForm action={workOrderTransitionAction} hidden={{ workOrderId, to }} submit={label} size="sm" variant={to === "cancelled" ? "danger" : to === "in_progress" ? "cta" : "secondary"} className="flex flex-col gap-2">
      {(fe) =>
        needsReason ? (
          <Field label="Why?" htmlFor={`t-${to}`} error={fe.reason}>
            <Input id={`t-${to}`} name="reason" required minLength={5} maxLength={1000} />
          </Field>
        ) : null
      }
    </ActionForm>
  );
}

export function AssignForm({ workOrderId, technicians, current }: { workOrderId: string; technicians: Person[]; current: { assignedTo: string | null; dueDate: string | null; priority: string } }) {
  return (
    <ActionForm action={assignWorkOrderAction} hidden={{ workOrderId }} submit="Save" size="sm">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <PeopleSelect id="a-assignedTo" name="assignedTo" people={technicians} label="Who does it?" defaultValue={current.assignedTo} fe={fe} />
          <Field label="Do it by" htmlFor="a-dueDate" error={fe.dueDate}>
            <Input id="a-dueDate" name="dueDate" type="date" defaultValue={current.dueDate ?? ""} />
          </Field>
          <PrioritySelect id="a-priority" fe={fe} defaultValue={current.priority} />
        </div>
      )}
    </ActionForm>
  );
}

export function CompleteForm({ workOrderId, kind }: { workOrderId: string; kind: string }) {
  return (
    <ActionForm action={completeWorkOrderAction} hidden={{ workOrderId }} submit="The job is done" variant="cta" confirm="Is the job done? It is written into the machine's history.">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What did you do?" htmlFor="c-workDone" error={fe.workDone}>
              <Textarea id="c-workDone" name="workDone" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          <Field label="Does the machine work now?" htmlFor="c-result" error={fe.result} hint="“No” keeps the machine blocked.">
            <Select id="c-result" name="result" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value={kind === "inspection" ? "pass" : "completed"}>{kind === "inspection" ? "Yes, the check is OK" : "Yes, it works"}</option>
              <option value="fail">No, it still does not work</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="Done by an outside company? Its name (optional)" htmlFor="c-ext" error={fe.performedByExternal}>
                <Input id="c-ext" name="performedByExternal" maxLength={120} />
              </Field>
              <Field label="Their paper or invoice number (optional)" htmlFor="c-ref" error={fe.referenceNumber}>
                <Input id="c-ref" name="referenceNumber" maxLength={80} />
              </Field>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function IssuePartForm({ workOrderId, stock }: { workOrderId: string; stock: { lotId: string; lotNumber: string; materialCode: string; materialName: string; uom: string; locationId: string; locationCode: string; qty: string }[] }) {
  return (
    <ActionForm action={issuePartAction} hidden={{ workOrderId }} submit="Take the part">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ScanOrPick
              kind="lot"
              name="stock"
              id="ip-stock"
              label="Which part?"
              hint="Tap the part, or scan the label on its box or bag."
              candidates={stock.map((s) => ({ value: `${s.lotId}|${s.locationId}`, title: s.materialName, detail: `${Number(s.qty)} ${s.uom} on ${s.locationCode} · lot ${s.lotNumber}`, code: s.lotNumber, codes: [s.lotNumber, s.materialCode] }))}
              candidatesLabel="Spare parts OK to use at this site"
              onlyCandidates
              required
              error={fe.lotId ?? fe.fromLocationId ?? fe.stock}
            />
          </div>
          <Field label="How many?" htmlFor="ip-qty" error={fe.qty}>
            <Input id="ip-qty" name="qty" inputMode="decimal" required defaultValue="1" />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function RegisterSparePartForm({ sites, materials, equipment }: { sites: { id: string; code: string; name: string }[]; materials: { id: string; code: string; name: string }[]; equipment: Eq[] }) {
  return (
    <ActionForm action={registerSparePartAction} submit="Add to the list">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Which part? (a material in the materials list)" htmlFor="sp-material" error={fe.materialId} hint="Spare parts are ordinary materials, usually of kind “consumable”.">
            <Select id="sp-material" name="materialId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Keep at least (optional)" htmlFor="sp-min" error={fe.minQty} hint="We warn you when there are fewer.">
            <Input id="sp-min" name="minQty" inputMode="decimal" />
          </Field>
          {sites.length > 1 ? (
            <Field label="Site" htmlFor="sp-site" error={fe.siteId}>
              <Select id="sp-site" name="siteId" required defaultValue={sites[0]?.id ?? ""}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.code}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="siteId" value={sites[0]?.id ?? ""} />
          )}
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="Only for one machine? (optional)" htmlFor="sp-eq" error={fe.equipmentId}>
                <Select id="sp-eq" name="equipmentId" defaultValue="">
                  <option value="">Any machine at the site</option>
                  {equipment.map((e) => (
                    <option key={e.id} value={e.id}>
                      {eqLabel(e)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note (optional)" htmlFor="sp-note" error={fe.note}>
                <Input id="sp-note" name="note" maxLength={500} />
              </Field>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function RemoveSparePartForm({ sparePartId }: { sparePartId: string }) {
  return <ActionForm action={removeSparePartAction} hidden={{ sparePartId }} submit="Remove" size="sm" variant="secondary" confirm="Take this part off the spare-parts list? Its stock does not change." />;
}
