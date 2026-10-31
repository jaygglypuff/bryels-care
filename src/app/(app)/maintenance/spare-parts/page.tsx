import { requireContext } from "@/lib/auth/context";
import { listSpareParts, maintenanceFormContext } from "@/modules/maintenance";
import { listMaterialMaster } from "@/modules/masterdata";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { RegisterSparePartForm, RemoveSparePartForm } from "../forms";

export const dynamic = "force-dynamic";

/** Spare-parts list (US-6-19): materials kept as spares per site, released stock on hand, below-minimum flag. */
export default async function SparePartsPage() {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.spare_part.view")) return <Forbidden what="spare parts" />;
  const rows = await listSpareParts(ctx);
  const canEdit = ctx.can("maintenance.spare_part.edit");
  const sites = ctx.allowedSites.filter((s) => ctx.canAt("maintenance.spare_part.edit", s.id));
  const materials = canEdit && ctx.can("masterdata.material.view") ? (await listMaterialMaster(ctx)).map((m) => ({ id: m.id, code: m.code, name: m.name })) : [];
  const equipment = canEdit && ctx.can("maintenance.work_order.create") ? (await maintenanceFormContext(ctx)).equipment : [];
  return (
    <>
      <PageHeader title="Spare parts" />
      <PageIntro>This screen is for the technician: the parts we keep for repairs and how many are left. Parts are taken from stock on the repair job; only parts that are OK to use can be taken.</PageIntro>
      {rows.some((r) => r.belowMin) && <NextStep text={`Next: ask purchasing to buy more of ${rows.filter((r) => r.belowMin).map((r) => r.materialName).join(", ")} (running low).`} />}
      <div className="flex flex-col gap-5">
        <Card>
          {rows.length === 0 ? (
            <EmptyState title="No spare parts listed">Add the parts you keep for repairs below. They are received like any material and QA says OK before use. Questions? Ask the maintenance lead.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{r.materialName}</span>
                      {r.belowMin && <Chip tone="warn">Running low</Chip>}
                    </p>
                    <p className="text-[13px] text-fg-2">
                      {Number(r.onHand)} {r.baseUom} ready to use{r.minQtyBase !== null ? ` · keep at least ${Number(r.minQtyBase)}` : ""} · {r.equipmentCode ? `for ${r.equipmentCode}` : "any machine"} · {r.siteCode}
                      <span className="ml-1 font-mono text-[12px] text-muted">· {r.materialCode}</span>
                    </p>
                    {r.note && <p className="text-[12px] text-muted">{r.note}</p>}
                  </div>
                  {canEdit && ctx.canAt("maintenance.spare_part.edit", r.siteId) && <RemoveSparePartForm sparePartId={r.id} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canEdit && sites.length > 0 && materials.length > 0 && (
          <Card>
            <MoreDetails title="Add a spare part to the list" open={rows.length === 0}>
              <RegisterSparePartForm sites={sites} materials={materials} equipment={equipment} />
            </MoreDetails>
          </Card>
        )}
      </div>
    </>
  );
}
