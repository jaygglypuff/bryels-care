import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { MATERIAL_CLASSES, MATERIAL_CLASS_LABELS, MATERIAL_STATUSES, listMaterialMaster, type MaterialClass } from "@/modules/masterdata";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";
import { StateChip } from "../_org/ui";

export const metadata = { title: "Materials" };

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ created?: string; q?: string; kind?: string; status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.material.view")) return <Forbidden what="materials" />;
  const sp = await searchParams;
  const rows = await listMaterialMaster(ctx, { q: sp.q, materialKind: sp.kind, status: sp.status });
  const canCreate = ctx.can("masterdata.material.create");
  const filtered = !!(sp.q || sp.kind || sp.status);
  const qs = new URLSearchParams(Object.entries({ q: sp.q ?? "", materialKind: sp.kind ?? "", status: sp.status ?? "" }).filter(([, v]) => v)).toString();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Materials"
        subtitle={`Raw materials, packaging, intermediates and consumables (organization-wide). On hand is for ${ctx.currentSite.code}.`}
        actions={
          <>
            {ctx.can("masterdata.material.export") && (
              <a href={`/api/v1/masterdata/export/materials${qs ? `?${qs}` : ""}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2">
                Export CSV
              </a>
            )}
            {canCreate && <LinkButton href="/masterdata/materials/new" variant="cta">New material</LinkButton>}
          </>
        }
      />
      {sp.created && <Banner tone="ok" title={`Material ${sp.created} created`}>It can now be received and used in formulas.</Banner>}
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px]">
            Search
            <Input name="q" defaultValue={sp.q} placeholder="Code, name, INCI or common name" />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Class
            <Select name="kind" defaultValue={sp.kind ?? ""}>
              <option value="">All</option>
              {MATERIAL_CLASSES.map((k) => (
                <option key={k} value={k}>{MATERIAL_CLASS_LABELS[k]}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Status
            <Select name="status" defaultValue={sp.status ?? ""}>
              <option value="">All</option>
              {MATERIAL_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Filter</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No materials match" : "No materials yet"}
          action={filtered ? <LinkButton href="/masterdata/materials" variant="secondary">Clear filters</LinkButton> : canCreate ? <LinkButton href="/masterdata/materials/new">New material</LinkButton> : undefined}
        >
          {filtered ? "Try another filter." : "Materials are the items you buy and weigh: oils, extracts, packaging."}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((m) => (
              <li key={m.id}>
                <Link href={`/masterdata/materials/${m.id}`}>
                  <Card>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-semibold">{m.code}</span>
                      <StateChip status={m.status} />
                    </div>
                    <p className="font-medium">{m.name}</p>
                    <p className="mt-1 text-[12px] text-muted">
                      {MATERIAL_CLASS_LABELS[m.materialKind as MaterialClass] ?? m.materialKind} · {m.baseUom} · on hand {fmtLotQty(m.onHand, m.baseUom)}
                    </p>
                    {m.warnings.length > 0 && <p className="mt-1 text-[12px] text-[var(--warn-fg)]">INCI name missing</p>}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table head={["Code", "Name", "INCI", "Class", "Base unit", "Shelf life", "Status", `On hand (${ctx.currentSite.code})`]}>
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-surface-2">
                  <Td className="font-mono font-semibold">
                    <Link className="text-primary-text hover:underline" href={`/masterdata/materials/${m.id}`}>{m.code}</Link>
                  </Td>
                  <Td>{m.name}{m.storageConditions && <div className="text-[12px] text-muted">{m.storageConditions}</div>}</Td>
                  <Td className="text-[12px]">{m.inciName ?? (m.warnings.length ? <Chip tone="warn">Missing</Chip> : <span className="text-muted">—</span>)}</Td>
                  <Td><Chip tone={m.materialKind === "packaging" ? "info" : m.materialKind === "intermediate" ? "appr" : "neu"}>{MATERIAL_CLASS_LABELS[m.materialKind as MaterialClass] ?? m.materialKind}</Chip></Td>
                  <Td>{m.baseUom}</Td>
                  <Td className="whitespace-nowrap">{m.shelfLifeDays ? `${m.shelfLifeDays} days` : <span className="text-muted">—</span>}</Td>
                  <Td><StateChip status={m.status} /></Td>
                  <Td className="whitespace-nowrap text-right font-medium">{fmtLotQty(m.onHand, m.baseUom)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
