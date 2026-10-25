import { requireContext } from "@/lib/auth/context";
import { listSpareParts, maintenanceFormContext } from "@/modules/maintenance";
import { listMaterialMaster } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
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
      <PageHeader title="Spare parts" subtitle="Ordinary materials and lots, issued to maintenance work orders through the stock ledger; only released stock can be issued" />
      <div className="flex flex-col gap-5">
        <Card>
          {rows.length === 0 ? (
            <EmptyState title="No spare parts listed">Add the materials kept as spares (receive them like any material; QA releases them before use).</EmptyState>
          ) : (
            <Table head={["Material", "For equipment", "Site", "Released on hand", "Minimum", ""]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">
                    {r.materialCode} <span className="font-normal text-fg-2">{r.materialName}</span>
                    {r.note && <div className="text-[12px] text-muted">{r.note}</div>}
                  </Td>
                  <Td>{r.equipmentCode ?? <span className="text-muted">Any</span>}</Td>
                  <Td>{r.siteCode}</Td>
                  <Td className="whitespace-nowrap">
                    {Number(r.onHand)} {r.baseUom}
                    {r.belowMin && (
                      <div className="mt-0.5">
                        <Chip tone="warn">Below minimum</Chip>
                      </div>
                    )}
                  </Td>
                  <Td>{r.minQtyBase !== null ? Number(r.minQtyBase) : "—"}</Td>
                  <Td>{canEdit && ctx.canAt("maintenance.spare_part.edit", r.siteId) && <RemoveSparePartForm sparePartId={r.id} />}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {canEdit && sites.length > 0 && materials.length > 0 && (
          <Card>
            <CardTitle>Add a spare part</CardTitle>
            <RegisterSparePartForm sites={sites} materials={materials} equipment={equipment} />
          </Card>
        )}
      </div>
    </>
  );
}
