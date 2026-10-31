import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { EQUIPMENT_KINDS } from "@/modules/masterdata";
import { Card, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { createEquipmentAction } from "../../_eng/actions";
import { ActionForm, Grid, SelectField, TextField } from "../../_org/form";
import { EQUIPMENT_KIND_WORDS } from "../words";

export const metadata: Metadata = { title: "Register equipment" };

/** Register a machine (ADR-088): name, kind and where it is; the number EQP-nnnn and the rules have defaults. */
export default async function NewEquipmentPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.equipment.admin")) return <Forbidden what="registering equipment" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Register equipment" />
      <PageIntro>Add a scale, mixer, mould or other machine so the steps can record which one was used. The system gives it a number for its label.</PageIntro>
      <Card>
        <ActionForm action={createEquipmentAction} submitLabel="Register" pendingText="Registering…" variant="cta" cancelHref="/masterdata/equipment">
          <TextField name="name" label="What is it called?" placeholder="e.g. Big scale 60 kg" />
          <Grid>
            <SelectField name="equipmentKind" label="What kind of machine?" defaultValue="scale" options={EQUIPMENT_KINDS.map((k) => ({ value: k, label: EQUIPMENT_KIND_WORDS[k] ?? k }))} />
            <TextField name="lineLabel" label="Making area / line (optional)" placeholder="e.g. Soap room" />
            {ctx.allowedSites.length > 1 ? (
              <SelectField name="siteId" label="At which site?" defaultValue={ctx.currentSiteId} options={ctx.allowedSites.map((s) => ({ value: s.id, label: s.name }))} />
            ) : (
              <input type="hidden" name="siteId" value={ctx.currentSiteId} />
            )}
          </Grid>
          <MoreDetails>
            <Grid>
              <TextField name="calibrationDueDate" label="Next calibration (optional)" type="date" />
              <TextField name="calibrationIntervalDays" label="Calibrate every (days)" inputMode="numeric" />
              <TextField name="maintenanceDueDate" label="Next maintenance (optional)" type="date" />
              <TextField name="maintenanceIntervalDays" label="Maintain every (days)" inputMode="numeric" />
              <SelectField
                name="cleaningRule"
                label="Cleaning"
                defaultValue="per_batch"
                options={[
                  { value: "per_batch", label: "Clean after every batch" },
                  { value: "per_changeover", label: "Clean when the product changes" },
                  { value: "none", label: "No cleaning record needed" },
                ]}
              />
              <SelectField
                name="blockingRule"
                label="When overdue or not clean"
                defaultValue="block"
                options={[
                  { value: "block", label: "Do not allow use (needs approval)" },
                  { value: "warn", label: "Warn and record" },
                  { value: "none", label: "Information only" },
                ]}
                hint="Confirm with QA (A-DM-28)."
              />
              <SelectField
                name="qualificationStatus"
                label="Qualification"
                defaultValue="not_required"
                options={[
                  { value: "not_required", label: "Not required" },
                  { value: "qualified", label: "Qualified" },
                  { value: "pending", label: "Pending" },
                ]}
              />
              <TextField name="capacityUom" label="Capacity unit" placeholder="g" />
              <TextField name="capacityMin" label="Smallest amount" inputMode="decimal" />
              <TextField name="capacityMax" label="Largest amount" inputMode="decimal" />
              <TextField name="code" label="Your own code (optional)" placeholder="The system gives one, e.g. EQP-0001" mono hint="Printed on the machine label." />
            </Grid>
          </MoreDetails>
        </ActionForm>
      </Card>
    </div>
  );
}
