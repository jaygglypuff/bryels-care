import { requireContext } from "@/lib/auth/context";
import { maintenanceFormContext } from "@/modules/maintenance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { CreateWorkOrderForm } from "../../forms";

export const dynamic = "force-dynamic";

/** Report a problem / raise a corrective or inspection work order (W13), optionally for one piece of equipment. */
export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ equipmentId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.work_order.create")) return <Forbidden what="raising maintenance work orders" />;
  const sp = await searchParams;
  const v = await maintenanceFormContext(ctx, { equipmentId: sp.equipmentId });
  return (
    <>
      <PageHeader title="Report a problem" subtitle="A breakdown taken out of service is blocked for production at once; the work order tracks the repair" actions={<LinkButton href="/maintenance/work-orders" variant="secondary">Work orders</LinkButton>} />
      <Card>
        {v.equipment.length === 0 ? (
          <EmptyState title="No equipment at your sites" action={<LinkButton href="/masterdata/equipment" variant="secondary">Equipment register</LinkButton>}>
            Register the equipment first.
          </EmptyState>
        ) : (
          <CreateWorkOrderForm equipment={v.equipment} technicians={v.technicians} preselected={v.preselected?.id ?? null} />
        )}
      </Card>
    </>
  );
}
