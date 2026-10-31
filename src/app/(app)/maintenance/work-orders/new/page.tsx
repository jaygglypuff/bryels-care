import { requireContext } from "@/lib/auth/context";
import { maintenanceFormContext } from "@/modules/maintenance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { CreateWorkOrderForm } from "../../forms";

export const dynamic = "force-dynamic";

/** Report a problem / raise a corrective or inspection work order (W13), optionally for one piece of equipment. */
export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ equipmentId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.work_order.create")) return <Forbidden what="reporting broken machines" />;
  const sp = await searchParams;
  const v = await maintenanceFormContext(ctx, { equipmentId: sp.equipmentId });
  return (
    <>
      <PageHeader title="Report a broken machine" actions={<LinkButton href="/maintenance/work-orders" variant="secondary">All repair jobs</LinkButton>} />
      <PageIntro>This screen is for anyone: say which machine and what is wrong. A technician gets a repair job; a machine marked “broken now” cannot be used by production.</PageIntro>
      <Card>
        {v.equipment.length === 0 ? (
          <EmptyState title="No machines at your sites" action={<LinkButton href="/masterdata/equipment" variant="secondary">Machines list</LinkButton>}>
            Add the machine to the machines list first (ask the site manager).
          </EmptyState>
        ) : (
          <CreateWorkOrderForm equipment={v.equipment} technicians={v.technicians} preselected={v.preselected?.id ?? null} />
        )}
      </Card>
    </>
  );
}
