"use client";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
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
    <ActionForm action={createPlanAction} submit="Create PM plan" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Equipment" htmlFor="equipmentId" error={fe.equipmentId}>
            <Select id="equipmentId" name="equipmentId" required value={eqId} onChange={(e) => setEqId(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.siteCode} · {e.code} {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor="title" error={fe.title}>
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          <Field label="Due by" htmlFor="triggerKind" error={fe.triggerKind}>
            <Select id="triggerKind" name="triggerKind" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="time">Time (every n days)</option>
              <option value="usage">Usage (batches or hours of use)</option>
            </Select>
          </Field>
          {trigger === "time" ? (
            <>
              <Field label="Interval (days)" htmlFor="intervalDays" error={fe.intervalDays}>
                <Input id="intervalDays" name="intervalDays" inputMode="numeric" required />
              </Field>
              <Field label="First due on (default: today + interval)" htmlFor="firstDueOn" error={fe.firstDueOn}>
                <Input id="firstDueOn" name="firstDueOn" type="date" />
              </Field>
            </>
          ) : (
            <>
              <Field label="Count" htmlFor="usageMetric" error={fe.usageMetric}>
                <Select id="usageMetric" name="usageMetric" defaultValue="batches">
                  <option value="batches">Batches that used it</option>
                  <option value="hours">Hours of use</option>
                </Select>
              </Field>
              <Field label="Interval (batches or hours)" htmlFor="usageInterval" error={fe.usageInterval}>
                <Input id="usageInterval" name="usageInterval" inputMode="decimal" required />
              </Field>
            </>
          )}
          <Field label={`Show as due soon (days before; default ${dueSoonDays})`} htmlFor="leadDays" error={fe.leadDays}>
            <Input id="leadDays" name="leadDays" inputMode="numeric" />
          </Field>
          <PeopleSelect id="responsibleUserId" name="responsibleUserId" people={technicians.filter((t) => !site || t.siteId === site)} label="Responsible technician" fe={fe} />
          <div className="sm:col-span-2">
            <Field label="Instructions / checklist" htmlFor="instructions" error={fe.instructions} hint="As written by the company's maintenance lead (manufacturer's manual).">
              <Textarea id="instructions" name="instructions" maxLength={4000} />
            </Field>
          </div>
          <Check name="takesEquipmentDown" label="The equipment is out of use while the PM is done" defaultChecked />
        </div>
      )}
    </ActionForm>
  );
}

export function EditPlanForm({ plan, technicians }: { plan: { id: string; title: string; instructions: string | null; triggerKind: string; intervalDays: number | null; nextDueOn: string | null; usageInterval: string | null; leadDays: number | null; takesEquipmentDown: boolean; responsibleUserId: string | null }; technicians: Person[] }) {
  return (
    <ActionForm action={updatePlanAction} hidden={{ planId: plan.id }} submit="Save plan">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" htmlFor="p-title" error={fe.title}>
            <Input id="p-title" name="title" required maxLength={200} defaultValue={plan.title} />
          </Field>
          {plan.triggerKind === "time" ? (
            <>
              <Field label="Interval (days)" htmlFor="p-intervalDays" error={fe.intervalDays}>
                <Input id="p-intervalDays" name="intervalDays" inputMode="numeric" defaultValue={plan.intervalDays ?? ""} />
              </Field>
              <Field label="Next due on" htmlFor="p-nextDueOn" error={fe.nextDueOn}>
                <Input id="p-nextDueOn" name="nextDueOn" type="date" defaultValue={plan.nextDueOn ?? ""} />
              </Field>
            </>
          ) : (
            <Field label="Usage interval" htmlFor="p-usageInterval" error={fe.usageInterval}>
              <Input id="p-usageInterval" name="usageInterval" inputMode="decimal" defaultValue={plan.usageInterval ? String(Number(plan.usageInterval)) : ""} />
            </Field>
          )}
          <Field label="Due-soon lead (days, blank = setting)" htmlFor="p-leadDays" error={fe.leadDays}>
            <Input id="p-leadDays" name="leadDays" inputMode="numeric" defaultValue={plan.leadDays ?? ""} />
          </Field>
          <PeopleSelect id="p-responsible" name="responsibleUserId" people={technicians} label="Responsible technician" defaultValue={plan.responsibleUserId} fe={fe} />
          <div className="sm:col-span-2">
            <Field label="Instructions / checklist" htmlFor="p-instructions" error={fe.instructions}>
              <Textarea id="p-instructions" name="instructions" maxLength={4000} defaultValue={plan.instructions ?? ""} />
            </Field>
          </div>
          <Check name="takesEquipmentDown" label="The equipment is out of use while the PM is done" defaultChecked={plan.takesEquipmentDown} />
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
          <Field label="Reason" htmlFor={`ps-${to}`} error={fe.reason}>
            <Input id={`ps-${to}`} name="reason" required minLength={5} maxLength={1000} />
          </Field>
        )
      }
    </ActionForm>
  );
}

export function PlanWorkOrderForm({ planId, technicians, defaultAssignee, defaultDue }: { planId: string; technicians: Person[]; defaultAssignee: string | null; defaultDue: string | null }) {
  return (
    <ActionForm action={planWorkOrderAction} hidden={{ planId }} submit="Raise the PM work order" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <PeopleSelect id="pw-assignedTo" name="assignedTo" people={technicians} label="Technician" defaultValue={defaultAssignee} fe={fe} />
          <Field label="Due" htmlFor="pw-dueDate" error={fe.dueDate}>
            <Input id="pw-dueDate" name="dueDate" type="date" defaultValue={defaultDue ?? ""} />
          </Field>
          <Field label="Priority" htmlFor="pw-priority" error={fe.priority}>
            <Select id="pw-priority" name="priority" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function CreateWorkOrderForm({ equipment, technicians, preselected }: { equipment: Eq[]; technicians: Person[]; preselected: string | null }) {
  return (
    <ActionForm action={createWorkOrderAction} submit="Raise work order" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Equipment" htmlFor="w-equipmentId" error={fe.equipmentId}>
            <Select id="w-equipmentId" name="equipmentId" required defaultValue={preselected ?? ""}>
              <option value="" disabled>
                Choose…
              </option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.siteCode} · {e.code} {e.name}
                  {e.status && e.status !== "in_service" ? ` (${e.status.replace(/_/g, " ")})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kind" htmlFor="w-kind" error={fe.kind}>
            <Select id="w-kind" name="kind" defaultValue="corrective">
              <option value="corrective">Corrective / breakdown</option>
              <option value="inspection">Inspection</option>
            </Select>
          </Field>
          <Field label="What is wrong / what to do" htmlFor="w-title" error={fe.title}>
            <Input id="w-title" name="title" required maxLength={200} />
          </Field>
          <Field label="Priority" htmlFor="w-priority" error={fe.priority}>
            <Select id="w-priority" name="priority" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <PeopleSelect id="w-assignedTo" name="assignedTo" people={technicians} label="Technician (optional)" fe={fe} />
          <Field label="Due (optional)" htmlFor="w-dueDate" error={fe.dueDate}>
            <Input id="w-dueDate" name="dueDate" type="date" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Details (optional)" htmlFor="w-description" error={fe.description}>
              <Textarea id="w-description" name="description" maxLength={4000} />
            </Field>
          </div>
          <Check name="reportedDown" label="It is broken now: take it out of service immediately" />
          <Check name="takesEquipmentDown" label="The equipment is out of use while the work is done" defaultChecked />
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
          <Field label="Reason" htmlFor={`t-${to}`} error={fe.reason}>
            <Input id={`t-${to}`} name="reason" required minLength={5} maxLength={1000} />
          </Field>
        ) : null
      }
    </ActionForm>
  );
}

export function AssignForm({ workOrderId, technicians, current }: { workOrderId: string; technicians: Person[]; current: { assignedTo: string | null; dueDate: string | null; priority: string } }) {
  return (
    <ActionForm action={assignWorkOrderAction} hidden={{ workOrderId }} submit="Save assignment" size="sm">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <PeopleSelect id="a-assignedTo" name="assignedTo" people={technicians} label="Technician" defaultValue={current.assignedTo} fe={fe} />
          <Field label="Due" htmlFor="a-dueDate" error={fe.dueDate}>
            <Input id="a-dueDate" name="dueDate" type="date" defaultValue={current.dueDate ?? ""} />
          </Field>
          <Field label="Priority" htmlFor="a-priority" error={fe.priority}>
            <Select id="a-priority" name="priority" defaultValue={current.priority}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function CompleteForm({ workOrderId, kind }: { workOrderId: string; kind: string }) {
  return (
    <ActionForm action={completeWorkOrderAction} hidden={{ workOrderId }} submit="Complete work order" variant="cta" confirm="Complete the work order? The service record is written to the equipment history.">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Work done" htmlFor="c-workDone" error={fe.workDone}>
              <Textarea id="c-workDone" name="workDone" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          <Field label="Result" htmlFor="c-result" error={fe.result} hint="A failed result keeps the equipment out of service.">
            <Select id="c-result" name="result" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value={kind === "inspection" ? "pass" : "completed"}>{kind === "inspection" ? "Pass" : "Completed, works"}</option>
              <option value="fail">Failed: still not usable</option>
            </Select>
          </Field>
          <Field label="Reference (optional)" htmlFor="c-ref" error={fe.referenceNumber}>
            <Input id="c-ref" name="referenceNumber" maxLength={80} />
          </Field>
          <Field label="Done by a contractor (optional)" htmlFor="c-ext" error={fe.performedByExternal}>
            <Input id="c-ext" name="performedByExternal" maxLength={120} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function IssuePartForm({ workOrderId, stock }: { workOrderId: string; stock: { lotId: string; lotNumber: string; materialCode: string; materialName: string; uom: string; locationId: string; locationCode: string; qty: string }[] }) {
  return (
    <ActionForm action={issuePartAction} hidden={{ workOrderId }} submit="Issue part">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Part, lot and location" htmlFor="ip-stock" error={fe.lotId ?? fe.fromLocationId}>
            <Select id="ip-stock" name="stock" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {stock.map((s) => (
                <option key={`${s.lotId}|${s.locationId}`} value={`${s.lotId}|${s.locationId}`}>
                  {s.materialCode} {s.materialName} · lot {s.lotNumber} · {s.locationCode} ({Number(s.qty)} {s.uom})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity" htmlFor="ip-qty" error={fe.qty}>
            <Input id="ip-qty" name="qty" inputMode="decimal" required />
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
          <Field label="Site" htmlFor="sp-site" error={fe.siteId}>
            <Select id="sp-site" name="siteId" required defaultValue={sites[0]?.id ?? ""}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Material (spare part)" htmlFor="sp-material" error={fe.materialId} hint="Spare parts are ordinary materials, usually of class consumable.">
            <Select id="sp-material" name="materialId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="For equipment (optional)" htmlFor="sp-eq" error={fe.equipmentId}>
            <Select id="sp-eq" name="equipmentId" defaultValue="">
              <option value="">Any equipment at the site</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.siteCode} · {e.code} {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Minimum stock (optional)" htmlFor="sp-min" error={fe.minQty}>
            <Input id="sp-min" name="minQty" inputMode="decimal" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note (optional)" htmlFor="sp-note" error={fe.note}>
              <Input id="sp-note" name="note" maxLength={500} />
            </Field>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function RemoveSparePartForm({ sparePartId }: { sparePartId: string }) {
  return <ActionForm action={removeSparePartAction} hidden={{ sparePartId }} submit="Remove" size="sm" variant="secondary" confirm="Remove this material from the spare-parts list? Its stock is not changed." />;
}
