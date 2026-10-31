import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { db } from "@/db/client";
import { MATERIAL_STATUSES, listMaterialMaster, lookupLabels } from "@/modules/masterdata";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Banner, Chip } from "@/ui/status";
import { fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";
import { StateChip } from "../_org/ui";
import { KIND_ORDER, KIND_WORDS, countWords } from "./words";

export const metadata = { title: "Materials" };

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ created?: string; q?: string; kind?: string; status?: string; category?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.material.view")) return <Forbidden what="materials" />;
  const sp = await searchParams;
  const rows = await listMaterialMaster(ctx, { q: sp.q, materialKind: sp.kind, status: sp.status, category: sp.category });
  const categories = await lookupLabels(db, ctx.organizationId, "material_category");
  const canCreate = ctx.can("masterdata.material.create");
  const canSeeStock = ctx.can("inventory.lot.view");
  const filtered = !!(sp.q || sp.kind || sp.status || sp.category);
  const qs = new URLSearchParams(Object.entries({ q: sp.q ?? "", materialKind: sp.kind ?? "", status: sp.status ?? "", category: sp.category ?? "" }).filter(([, v]) => v)).toString();
  const stock = (m: (typeof rows)[number]) => {
    const text = fmtLotQty(m.onHand, m.baseUom);
    return canSeeStock ? (
      <Link className="text-primary-text underline" href={`/inventory/items/material/${m.id}`}>
        {text}
      </Link>
    ) : (
      text
    );
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Materials"
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
      <PageIntro>Everything you buy: ingredients, packaging and supplies. Tap the amount to see the stock at {ctx.currentSite.name}.</PageIntro>
      {sp.created && <Banner tone="ok" title={`Material ${sp.created} added`}>It can now be ordered, received and used in recipes.</Banner>}
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px]">
            Search
            <Input name="q" defaultValue={sp.q} placeholder="Name, brand or number" />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            What kind
            <Select name="kind" defaultValue={sp.kind ?? ""}>
              <option value="">All</option>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>{KIND_WORDS[k]}</option>
              ))}
            </Select>
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Search</button>
          <div className="w-full">
            <MoreDetails title="More filters">
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-[13px]">
                  Category
                  <Select name="category" defaultValue={sp.category ?? ""}>
                    <option value="">All</option>
                    {[...categories].map(([code, label]) => (
                      <option key={code} value={code}>{label}</option>
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
              </div>
            </MoreDetails>
          </div>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No materials match" : "No materials yet"}
          action={filtered ? <LinkButton href="/masterdata/materials" variant="secondary">Clear search</LinkButton> : canCreate ? <LinkButton href="/masterdata/materials/new">Add your first material</LinkButton> : undefined}
        >
          {filtered ? "Try another word, or clear the search." : canCreate ? "Add the oils, packaging and supplies you buy. It takes three questions." : "Ask the owner or the QA manager to add materials."}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((m) => (
              <li key={m.id}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/masterdata/materials/${m.id}`} className="min-w-0 break-words text-[16px] font-semibold text-primary-text">
                      {m.name}
                    </Link>
                    {m.status !== "active" && <StateChip status={m.status} />}
                  </div>
                  <p className="mt-1 text-[13px] text-fg-2">
                    {KIND_WORDS[m.materialKind] ?? m.materialKind} · {countWords(m.baseUom)}
                    {m.category ? ` · ${categories.get(m.category) ?? m.category}` : ""}
                  </p>
                  <p className="mt-1 text-[14px]">In stock: {stock(m)}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted">{m.code}</p>
                  {m.warnings.length > 0 && <p className="mt-1 text-[12px] text-[var(--warn-fg)]">INCI name missing</p>}
                </Card>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table head={["Name", "What kind", "We count it in", "Status", `In stock (${ctx.currentSite.code})`]}>
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-surface-2">
                  <Td>
                    <Link className="font-medium text-primary-text hover:underline" href={`/masterdata/materials/${m.id}`}>{m.name}</Link>
                    <div className="text-[12px] text-muted">
                      <span className="font-mono">{m.code}</span>
                      {m.category ? ` · ${categories.get(m.category) ?? m.category}` : ""}
                      {m.brand ? ` · ${m.brand}` : ""}
                    </div>
                    {m.warnings.length > 0 && <Chip tone="warn">INCI name missing</Chip>}
                  </Td>
                  <Td><Chip tone={m.materialKind === "packaging" ? "info" : m.materialKind === "consumable" ? "neu" : "appr"}>{KIND_WORDS[m.materialKind] ?? m.materialKind}</Chip></Td>
                  <Td>{m.baseUom}</Td>
                  <Td><StateChip status={m.status} /></Td>
                  <Td className="whitespace-nowrap text-right font-medium">{stock(m)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
