import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { LINE_TRANSITIONS, getLine, lineFormOptions, listEquipment } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ActionForm, Grid, SelectField, TextField, TextareaField } from "../../_org/form";
import { assignEquipmentAction, blockingRuleAction, lineStatusAction, saveLineAction } from "../../_org/actions";
import { ReadOnlyNote, StateChip } from "../../_org/ui";

export const metadata = { title: "Production line" };

const VERB: Record<string, string> = { active: "Back in service", down: "Mark as down", inactive: "Deactivate" };
const RULES = [
  { value: "block", label: "Block: overdue calibration, maintenance or cleaning stops the step" },
  { value: "warn", label: "Warn: record a warning, allow the step" },
  { value: "none", label: "None: no check" },
];

export default async function LinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.production_line.view")) return <Forbidden what="production lines" />;
  const { id } = await params;
  const { created } = await searchParams;
  let line;
  try {
    line = await getLine(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Line not found in your sites" action={<LinkButton href="/masterdata/lines" variant="secondary">All lines</LinkButton>} />;
    throw e;
  }
  const canAdmin = ctx.can("masterdata.production_line.admin");
  const canEquip = ctx.can("masterdata.equipment.admin");
  const opts = canAdmin ? await lineFormOptions(ctx, line.siteId) : { departments: [], lines: [] };
  const siteEquipment = canEquip ? (await listEquipment(ctx, { siteId: line.siteId })).filter((e) => !line.equipment.some((x) => x.id === e.id)) : [];
  const moves = LINE_TRANSITIONS[line.status as keyof typeof LINE_TRANSITIONS] ?? [];
  return (
    <div className="space-y-5">
      <PageHeader title={`${line.code} · ${line.name}`} subtitle={<>{line.department ? line.department.name : "No department"} · <StateChip status={line.status} /></>} actions={<LinkButton href="/masterdata/lines" variant="secondary">All lines</LinkButton>} />
      {created === "1" && <Banner tone="ok" title="Line created">Assign its equipment below.</Banner>}
      <Card>
        <CardTitle>Equipment on this line ({line.equipment.length})</CardTitle>
        {line.equipment.length === 0 ? (
          <p className="text-[13px] text-muted">No equipment assigned yet.</p>
        ) : (
          <ul className="space-y-3">
            {line.equipment.map((e) => (
              <li key={e.id} className="rounded-[14px] border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/masterdata/equipment/${e.id}`} className="font-mono font-semibold text-primary-text hover:underline">{e.code}</Link>
                  <span className="text-[13px]">{e.name} · {e.kind} · {e.status.replace(/_/g, " ")}</span>
                </div>
                {canEquip && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <ActionForm action={blockingRuleAction} submitLabel="Save blocking rule" hidden={{ equipmentId: e.id }}>
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
            <ActionForm action={assignEquipmentAction} submitLabel="Assign to this line" hidden={{ productionLineId: line.id }}>
              <SelectField name="equipmentId" label="Equipment at this site" options={siteEquipment.map((e) => ({ value: e.id, label: `${e.code} · ${e.name}${e.lineLabel ? ` (now: ${e.lineLabel})` : ""}` }))} />
            </ActionForm>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Line details</CardTitle>
        {canAdmin ? (
          <ActionForm action={saveLineAction} submitLabel="Save line" hidden={{ _id: line.id }}>
            <Grid>
              <TextField name="code" label="Code" defaultValue={line.code} mono hint="Fixed once referenced." />
              <TextField name="name" label="Name" defaultValue={line.name} />
              <SelectField name="departmentId" label="Department" defaultValue={line.departmentId} emptyLabel="— none —" options={opts.departments.filter((d) => d.siteId === line.siteId).map((d) => ({ value: d.id, label: d.name }))} />
            </Grid>
            <TextareaField name="notes" label="Notes" defaultValue={line.notes} />
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this line" />
        )}
      </Card>
      {canAdmin && moves.length > 0 && (
        <Card>
          <CardTitle>Status</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            {moves.map((s) => (
              <ActionForm key={s} action={lineStatusAction} submitLabel={VERB[s]} variant={s === "active" ? "primary" : "danger"} hidden={{ _id: line.id, status: s }}>
                <TextField name="reason" label="Reason" />
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
