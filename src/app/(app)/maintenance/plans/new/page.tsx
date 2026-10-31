import { requireContext } from "@/lib/auth/context";
import { maintenancePlanFormContext } from "@/modules/maintenance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { CreatePlanForm } from "../../forms";

export const dynamic = "force-dynamic";

/** New PM plan (W13-01 "preventive maintenance plan"), optionally for one piece of equipment (?equipmentId=). */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ equipmentId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.plan.create")) return <Forbidden what="planning regular maintenance" />;
  const sp = await searchParams;
  const v = await maintenancePlanFormContext(ctx, { equipmentId: sp.equipmentId });
  return (
    <>
      <PageHeader title="Plan new regular maintenance" actions={<LinkButton href="/maintenance/plans" variant="secondary">All regular maintenance</LinkButton>} />
      <PageIntro>This screen is for the technician: choose the machine, what to do and how often. How often comes from the machine&apos;s manual or the maintenance lead, not from this system.</PageIntro>
      <Card>
        {v.equipment.length === 0 ? (
          <EmptyState title="No machines at your sites" action={<LinkButton href="/masterdata/equipment" variant="secondary">Machines list</LinkButton>}>
            Add the machine to the machines list first (ask the site manager).
          </EmptyState>
        ) : (
          <CreatePlanForm equipment={v.equipment} technicians={v.technicians} preselected={v.preselected?.id ?? null} dueSoonDays={v.dueSoonDays} />
        )}
      </Card>
    </>
  );
}
