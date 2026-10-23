import { requireContext } from "@/lib/auth/context";
import { listMaterials } from "@/modules/inventory/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Materials" };

const KIND: Record<string, string> = { raw_material: "Raw material", intermediate: "Intermediate", packaging: "Packaging" };

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.material.view")) return <Forbidden what="materials" />;
  const { created } = await searchParams;
  const rows = await listMaterials(ctx);
  const canCreate = ctx.can("masterdata.material.create");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Materials"
        subtitle={`Raw materials, intermediates and packaging (organization-wide). On hand is for ${ctx.currentSite.code}.`}
        actions={canCreate ? <LinkButton href="/masterdata/materials/new" variant="cta">New material</LinkButton> : undefined}
      />
      {created && <Banner tone="ok" title={`Material ${created} created`}>It can now be received and used in formulas.</Banner>}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No materials yet" action={canCreate ? <LinkButton href="/masterdata/materials/new">New material</LinkButton> : undefined}>
            Materials are the items you buy and weigh: oils, extracts, packaging.
          </EmptyState>
        ) : (
          <Table head={["Code", "Name", "INCI", "Kind", "Base unit", "Shelf life", `On hand (${ctx.currentSite.code})`]}>
            {rows.map((m) => (
              <tr key={m.id} className="hover:bg-surface-2">
                <Td className="font-mono font-semibold">{m.code}</Td>
                <Td>{m.name}{m.storageConditions && <div className="text-[12px] text-muted">{m.storageConditions}</div>}</Td>
                <Td className="text-[12px]">{m.inciName ?? <span className="text-muted">—</span>}</Td>
                <Td><Chip tone={m.materialKind === "packaging" ? "info" : m.materialKind === "intermediate" ? "appr" : "neu"}>{KIND[m.materialKind] ?? m.materialKind}</Chip></Td>
                <Td>{m.baseUom}</Td>
                <Td className="whitespace-nowrap">{m.shelfLifeDays ? `${m.shelfLifeDays} days` : <span className="text-muted">—</span>}</Td>
                <Td className="whitespace-nowrap text-right font-medium">{fmtLotQty(m.onHand, m.baseUom)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
