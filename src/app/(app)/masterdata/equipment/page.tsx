import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listEquipment } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { EQUIPMENT_KIND_WORDS } from "./words";
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
      <PageHeader title="Equipment" actions={ctx.can("masterdata.equipment.admin") ? <LinkButton href="/masterdata/equipment/new" variant="cta">Register equipment</LinkButton> : undefined} />
      <PageIntro>
        The scales, mixers and moulds at {ctx.currentSite.name}. A machine that is late for its check or not cleaned cannot be used until someone approves it.{blocked ? ` ${blocked} cannot be used right now.` : ""}
      </PageIntro>
      {rows.length === 0 ? (
        <EmptyState title="No equipment yet" action={ctx.can("masterdata.equipment.admin") ? <LinkButton href="/masterdata/equipment/new">Register your first machine</LinkButton> : undefined}>
          Register your scales, mixers and moulds so the weighing and making steps can record which one was used.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((e) => (
              <Link key={e.id} href={`/masterdata/equipment/${e.id}`}>
                <Card>
                  <div className="flex flex-col gap-1">
                    <p className="text-[16px] font-semibold text-primary-text">{e.name}</p>
                    <p className="text-[13px] text-fg-2">{EQUIPMENT_KIND_WORDS[e.equipmentKind] ?? e.equipmentKind}{e.lineLabel ? ` · ${e.lineLabel}` : ""}</p>
                    <AvailabilityChip a={e.availability} />
                    <p className="text-[12px] text-muted">
                      {e.calibrationDueDate ? `Calibration due ${fmtDate(e.calibrationDueDate)}` : ""}
                      {e.maintenanceDueDate ? ` · maintenance due ${fmtDate(e.maintenanceDueDate)}` : ""}
                    </p>
                    <p className="font-mono text-[11px] text-muted">{e.code}</p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          <div className="hidden md:block">
            <Table head={["Name", "What kind", "Making area / line", "Can it be used?", "Calibration due", "Maintenance due"]}>
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/masterdata/equipment/${e.id}`} className="font-medium text-primary-text hover:underline">
                      {e.name}
                    </Link>
                    <div className="font-mono text-[12px] text-muted">{e.code}</div>
                  </Td>
                  <Td>{EQUIPMENT_KIND_WORDS[e.equipmentKind] ?? e.equipmentKind}</Td>
                  <Td>{e.lineLabel ?? "—"}</Td>
                  <Td>
                    <AvailabilityChip a={e.availability} />
                  </Td>
                  <Td className="whitespace-nowrap">{e.calibrationDueDate ? fmtDate(e.calibrationDueDate) : "—"}</Td>
                  <Td className="whitespace-nowrap">{e.maintenanceDueDate ? fmtDate(e.maintenanceDueDate) : "—"}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
