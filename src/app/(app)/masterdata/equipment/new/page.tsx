import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { EQUIPMENT_KINDS } from "@/modules/masterdata";
import { Card, Field, Input, PageHeader, Select } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { createEquipmentAction } from "../../_eng/actions";
import { CreateForm } from "../../_eng/forms";

export const metadata: Metadata = { title: "Register equipment" };

export default async function NewEquipmentPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.equipment.admin")) return <Forbidden what="registering equipment" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Register equipment" subtitle="Due dates, cleaning and blocking rules decide whether the equipment may be used in a step." />
      <Card>
        <CreateForm action={createEquipmentAction} submitLabel="Register" cancelHref="/masterdata/equipment">
          <Field label="Site" htmlFor="siteId">
            <Select id="siteId" name="siteId" defaultValue={ctx.currentSiteId}>
              {ctx.allowedSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" htmlFor="code" hint="Printed on the label as BC:EQP:<code>.">
              <Input id="code" name="code" required className="font-mono uppercase" placeholder="SC-03" />
            </Field>
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" required />
            </Field>
            <Field label="Type" htmlFor="equipmentKind">
              <Select id="equipmentKind" name="equipmentKind">
                {EQUIPMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Line or area (optional)" htmlFor="lineLabel">
              <Input id="lineLabel" name="lineLabel" />
            </Field>
            <Field label="Calibration interval (days)" htmlFor="calibrationIntervalDays">
              <Input id="calibrationIntervalDays" name="calibrationIntervalDays" inputMode="numeric" />
            </Field>
            <Field label="Calibration due" htmlFor="calibrationDueDate">
              <Input id="calibrationDueDate" name="calibrationDueDate" type="date" />
            </Field>
            <Field label="Maintenance interval (days)" htmlFor="maintenanceIntervalDays">
              <Input id="maintenanceIntervalDays" name="maintenanceIntervalDays" inputMode="numeric" />
            </Field>
            <Field label="Maintenance due" htmlFor="maintenanceDueDate">
              <Input id="maintenanceDueDate" name="maintenanceDueDate" type="date" />
            </Field>
            <Field label="Cleaning rule" htmlFor="cleaningRule">
              <Select id="cleaningRule" name="cleaningRule" defaultValue="per_batch">
                <option value="per_batch">Clean after every batch</option>
                <option value="per_changeover">Clean at product changeover</option>
                <option value="none">No cleaning record needed</option>
              </Select>
            </Field>
            <Field label="Qualification" htmlFor="qualificationStatus">
              <Select id="qualificationStatus" name="qualificationStatus" defaultValue="not_required">
                <option value="not_required">Not required</option>
                <option value="qualified">Qualified</option>
                <option value="pending">Pending</option>
              </Select>
            </Field>
            <Field label="When overdue or not clean" htmlFor="blockingRule" hint="Configurable per item (A-DM-28); confirm with QA.">
              <Select id="blockingRule" name="blockingRule" defaultValue="block">
                <option value="block">Block use (override needs approval)</option>
                <option value="warn">Warn and record</option>
                <option value="none">Information only</option>
              </Select>
            </Field>
            <Field label="Capacity unit" htmlFor="capacityUom">
              <Input id="capacityUom" name="capacityUom" placeholder="g" />
            </Field>
            <Field label="Capacity min" htmlFor="capacityMin">
              <Input id="capacityMin" name="capacityMin" inputMode="decimal" />
            </Field>
            <Field label="Capacity max" htmlFor="capacityMax">
              <Input id="capacityMax" name="capacityMax" inputMode="decimal" />
            </Field>
          </div>
        </CreateForm>
      </Card>
    </div>
  );
}
