import { requireContext } from "@/lib/auth/context";
import { maintenancePlanFormContext } from "@/modules/maintenance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { CreatePlanForm } from "../../forms";

export const dynamic = "force-dynamic";

/** New PM plan (W13-01 "preventive maintenance plan"), optionally for one piece of equipment (?equipmentId=). */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ equipmentId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.plan.create")) return <Forbidden what="creating PM plans" />;
  const sp = await searchParams;
  const v = await maintenancePlanFormContext(ctx, { equipmentId: sp.equipmentId });
  return (
    <>
      <PageHeader title="New PM plan" subtitle="Intervals come from the manufacturer's manual or the company's maintenance lead; they are not rules of this system" actions={<LinkButton href="/maintenance/plans" variant="secondary">PM plans</LinkButton>} />
      <Card>
        {v.equipment.length === 0 ? (
          <EmptyState title="No equipment at your sites" action={<LinkButton href="/masterdata/equipment" variant="secondary">Equipment register</LinkButton>}>
            Register the equipment first.
          </EmptyState>
        ) : (
          <CreatePlanForm equipment={v.equipment} technicians={v.technicians} preselected={v.preselected?.id ?? null} dueSoonDays={v.dueSoonDays} />
        )}
      </Card>
    </>
  );
}
