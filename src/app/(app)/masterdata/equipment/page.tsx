import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listEquipment } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { AvailabilityChip } from "../_eng/ui";

export const metadata: Metadata = { title: "Equipment" };

export default async function EquipmentPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.equipment.view")) return <Forbidden what="the equipment register" />;
  const rows = await listEquipment(ctx, { siteId: ctx.currentSiteId });
  const blocked = rows.filter((r) => !r.availability.selectable).length;
  return (
    <div>
      <PageHeader
        title="Equipment"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name}. Equipment overdue for calibration, cleaning or maintenance cannot be used without an approved override.${blocked ? ` ${blocked} item(s) blocked.` : ""}`}
        actions={ctx.can("masterdata.equipment.admin") ? <LinkButton href="/masterdata/equipment/new" variant="cta">Register equipment</LinkButton> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="No equipment registered at this site">Register scales, mixers and moulds so weighing and process steps can record the equipment used.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((e) => (
              <Link key={e.id} href={`/masterdata/equipment/${e.id}`}>
                <Card>
                  <div className="flex flex-col gap-1">
                    <p className="font-mono text-[13px] font-semibold">{e.code}</p>
                    <p className="font-medium">{e.name}</p>
                    <AvailabilityChip a={e.availability} />
                    <p className="text-[12px] text-muted">
                      {e.calibrationDueDate ? `Calibration due ${fmtDate(e.calibrationDueDate)}` : ""}
                      {e.maintenanceDueDate ? ` · maintenance due ${fmtDate(e.maintenanceDueDate)}` : ""}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          <div className="hidden md:block">
            <Table head={["Code", "Name", "Type", "Line / area", "Status", "Availability", "Calibration due", "Maintenance due", "Rule"]}>
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/masterdata/equipment/${e.id}`} className="font-mono font-semibold text-primary-text hover:underline">
                      {e.code}
                    </Link>
                  </Td>
                  <Td>{e.name}</Td>
                  <Td>{e.equipmentKind}</Td>
                  <Td>{e.lineLabel ?? "—"}</Td>
                  <Td>{e.status.replace(/_/g, " ")}</Td>
                  <Td>
                    <AvailabilityChip a={e.availability} />
                  </Td>
                  <Td className="whitespace-nowrap">{e.calibrationDueDate ? fmtDate(e.calibrationDueDate) : "—"}</Td>
                  <Td className="whitespace-nowrap">{e.maintenanceDueDate ? fmtDate(e.maintenanceDueDate) : "—"}</Td>
                  <Td>{e.blockingRule}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
