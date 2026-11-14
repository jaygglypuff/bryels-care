import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { LINE_TRANSITIONS, getLine, lineFormOptions, listEquipment } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { waitingFor } from "../../../waiting-for";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ActionForm, Grid, SelectField, TextField, TextareaField } from "../../_org/form";
import { assignEquipmentAction, blockingRuleAction, lineStatusAction, saveLineAction } from "../../_org/actions";
import { ReadOnlyNote, StateChip } from "../../_org/ui";

export const metadata = { title: "Making area / line" };

const VERB: Record<string, string> = { active: "Working again", down: "Stopped (broken or being fixed)", inactive: "Switch off (no longer used)" };
const RULES = [
  { value: "block", label: "Block: overdue calibration, maintenance or cleaning stops the step" },
  { value: "warn", label: "Warn: record a warning, allow the step" },
  { value: "none", label: "None: no check" },
];

export default async function LinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.production_line.view")) return <Forbidden what="production lines" permission="masterdata.production_line.view" />;
  const { id } = await params;
  const { created } = await searchParams;
  let line;
  try {
    line = await getLine(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Making area not found at your sites" action={<LinkButton href="/masterdata/lines" variant="secondary">All making areas</LinkButton>}>Go back to the list and pick it by name.</EmptyState>;
    throw e;
  }
  const canAdmin = ctx.can("masterdata.production_line.admin");
  const canEquip = ctx.can("masterdata.equipment.admin");
  const opts = canAdmin ? await lineFormOptions(ctx, line.siteId) : { departments: [], lines: [] };
  const siteEquipment = canEquip ? (await listEquipment(ctx, { siteId: line.siteId })).filter((e) => !line.equipment.some((x) => x.id === e.id)) : [];
  const moves = LINE_TRANSITIONS[line.status as keyof typeof LINE_TRANSITIONS] ?? [];
  return (
    <div className="space-y-5">
      <RecordHeader back={{ href: "/masterdata/lines", label: "Making areas / lines" }} typeLabel="Making area" title={line.name} chip={<StateChip status={line.status} />} meta={[<span key="code" className="font-mono">{line.code}</span>, line.department ? line.department.name : "No team"]} />
      <PageIntro>Where batches are made, and the machines (scales, mixers, moulds) that belong here.</PageIntro>
      {created === "1" && <Banner tone="ok" title="Making area added">Next: add its machines below.</Banner>}
      {line.status === "down" ? (
        <NextStep text="Stopped: no batch step can use this area until it works again." waitingFor={await waitingFor(ctx, "maintenance.work_order.edit", line.siteId, "to fix it and mark it working", "maintenance")} />
      ) : line.status === "inactive" ? (
        <NextStep text="Switched off: no longer used. Kept on record." />
      ) : line.equipment.length === 0 && canEquip && siteEquipment.length > 0 ? (
        <NextStep text="Next: add the machines (scales, mixers, moulds) that belong here." action={{ label: "Add a machine", href: "#machines" }} />
      ) : (
        <NextStep text={`Ready: batches can be made here${line.equipment.length ? ` with ${line.equipment.length} ${line.equipment.length === 1 ? "machine" : "machines"}` : ""}. Nothing to do now.`} />
      )}
      <Card id="machines">
        <CardTitle>Machines here ({line.equipment.length})</CardTitle>
        {line.equipment.length === 0 ? (
          <p className="text-[13px] text-muted">No machines yet. Pick one below, or register it under Set-up › Equipment.</p>
        ) : (
          <ul className="space-y-3">
            {line.equipment.map((e) => (
              <li key={e.id} className="rounded-[8px] border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/masterdata/equipment/${e.id}`} className="inline-flex min-h-[44px] items-center font-semibold text-primary-text hover:underline">{e.name}</Link>
                  <span className="text-[13px] text-fg-2">{e.kind.replace(/_/g, " ")} · {e.status.replace(/_/g, " ")} <span className="font-mono text-[12px] text-muted">· {e.code}</span></span>
                </div>
                {canEquip && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <ActionForm action={blockingRuleAction} submitLabel="Save blocking rule" variant="secondary" hidden={{ equipmentId: e.id }}>
                      <SelectField name="blockingRule" label="Blocking rule" defaultValue={e.blockingRule} options={RULES} />
                      <TextField name="reason" label="Reason (required to relax)" />
                    </ActionForm>
                    <ActionForm action={assignEquipmentAction} submitLabel="Remove from line" variant="secondary" hidden={{ equipmentId: e.id, productionLineId: "" }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEquip && siteEquipment.length > 0 && line.status !== "inactive" && (
          <div className="mt-4 border-t border-line pt-4">
            <ActionForm action={assignEquipmentAction} submitLabel="Add to this area" variant="secondary" hidden={{ productionLineId: line.id }}>
              <SelectField name="equipmentId" label="Equipment at this site" options={siteEquipment.map((e) => ({ value: e.id, label: `${e.name}${e.lineLabel ? ` (now: ${e.lineLabel})` : ""} · ${e.code}` }))} />
            </ActionForm>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Details</CardTitle>
        {canAdmin ? (
          <ActionForm action={saveLineAction} submitLabel="Save" hidden={{ _id: line.id }}>
            <Grid>
              <TextField name="name" label="Name" defaultValue={line.name} />
              <SelectField name="departmentId" label="Team (optional)" defaultValue={line.departmentId} emptyLabel="None" options={opts.departments.filter((d) => d.siteId === line.siteId).map((d) => ({ value: d.id, label: d.name }))} hint="Printed on the batch record." />
            </Grid>
            <MoreDetails>
              <TextField name="code" label="Your own code (optional)" defaultValue={line.code} mono hint="Fixed once batches use it." />
              <TextareaField name="notes" label="Notes" defaultValue={line.notes} />
            </MoreDetails>
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this line" />
        )}
      </Card>
      {canAdmin && moves.length > 0 && (
        <Card>
          <CardTitle>Working, stopped or switched off</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            {moves.map((s) => (
              <ActionForm key={s} action={lineStatusAction} submitLabel={VERB[s]} variant={s === "active" ? "primary" : "danger"} hidden={{ _id: line.id, status: s }}>
                <TextField name="reason" label="Why?" />
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
