import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { LOCATION_KINDS, LOCATION_KIND_LABELS, SPECIAL_ROLE_LABELS, listLocations, locationFormOptions, type LocationKind, type SpecialRole } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, Input, LinkButton, PageHeader, Select } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ActionForm, CheckField, Grid, SelectField, TextField } from "../_org/form";
import { saveLocationAction } from "../_org/actions";
import { StateChip } from "../_org/ui";

export const metadata = { title: "Locations" };

type Row = Awaited<ReturnType<typeof listLocations>>[number];

/** Orders a warehouse's locations as a zone → rack → bin tree (depth-first) with their depth. */
function tree(rows: Row[]): { row: Row; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<string | null, Row[]>();
  for (const r of rows) {
    const p = r.parentLocationId && ids.has(r.parentLocationId) ? r.parentLocationId : null;
    kids.set(p, [...(kids.get(p) ?? []), r]);
  }
  const out: { row: Row; depth: number }[] = [];
  const walk = (p: string | null, depth: number) => {
    for (const r of kids.get(p) ?? []) {
      out.push({ row: r, depth });
      if (depth < 8) walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ site?: string; warehouse?: string; kind?: string; q?: string; all?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.location.view")) return <Forbidden what="locations" />;
  const sp = await searchParams;
  const siteId = sp.site && ctx.allowedSiteIds.includes(sp.site) ? sp.site : ctx.currentSiteId;
  const rows = await listLocations(ctx, { siteId, warehouseId: sp.warehouse, kind: sp.kind, q: sp.q, includeInactive: sp.all === "1" });
  const opts = await locationFormOptions(ctx, siteId);
  const groups = new Map<string, { title: string; rows: Row[] }>();
  for (const r of rows) {
    const g = groups.get(r.warehouseId) ?? { title: `${r.siteCode} · ${r.warehouseCode} · ${r.warehouseName}`, rows: [] };
    g.rows.push(r);
    groups.set(r.warehouseId, g);
  }
  const filtered = !!(sp.warehouse || sp.kind || sp.q || sp.all);
  const canCreate = ctx.can("masterdata.location.create");
  const canSeeLots = ctx.can("inventory.lot.view");
  const site = ctx.allowedSites.find((s) => s.id === siteId)!;
  return (
    <div className="space-y-5">
      <PageHeader title="Locations" subtitle={`${site.code} · ${site.name}. The location class decides what may be stored or moved there; blocked locations take no movements.`} />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          {ctx.allowedSites.length > 1 && (
            <label className="flex flex-col gap-1 text-[13px]">
              Site
              <Select name="site" defaultValue={siteId}>
                {ctx.allowedSites.map((s) => (
                  <option key={s.id} value={s.id}>{s.code}</option>
                ))}
              </Select>
            </label>
          )}
          <label className="flex min-w-0 flex-col gap-1 text-[13px]">
            Warehouse
            <Select name="warehouse" defaultValue={sp.warehouse ?? ""}>
              <option value="">All</option>
              {opts.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code}</option>
              ))}
            </Select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[13px]">
            Class
            <Select name="kind" defaultValue={sp.kind ?? ""}>
              <option value="">All</option>
              {LOCATION_KINDS.map((k) => (
                <option key={k} value={k}>{LOCATION_KIND_LABELS[k]}</option>
              ))}
            </Select>
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px]">
            Search
            <Input name="q" defaultValue={sp.q} placeholder="Code or name" />
          </label>
          <label className="flex items-center gap-2 pb-3 text-[13px]">
            <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="size-4" /> Inactive too
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Filter</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title={filtered ? "No locations match" : "No locations at this site"} action={filtered ? <LinkButton href="/masterdata/locations" variant="secondary">Clear filters</LinkButton> : undefined}>
          {filtered ? "Try another filter." : canCreate ? "Add the first location below." : "Locations are set up by the site manager or system administrator."}
        </EmptyState>
      ) : (
        [...groups.entries()].map(([wid, g]) => (
          <Card key={wid}>
            <CardTitle action={<LinkButton size="sm" variant="secondary" href={`/masterdata/warehouses/${wid}`}>Warehouse</LinkButton>}>{g.title}</CardTitle>
            <ul className="flex flex-col gap-2">
              {tree(g.rows).map(({ row: l, depth }) => (
                <li key={l.id} style={{ marginLeft: `${Math.min(depth, 3) * 16}px` }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line p-3">
                    <div className="min-w-0">
                      <Link href={`/masterdata/locations/${l.id}`} className="font-mono font-semibold text-primary-text hover:underline">{l.code}</Link>
                      <span className="ml-2 text-[13px]">{l.name}</span>
                      <p className="text-[12px] text-muted">
                        {LOCATION_KIND_LABELS[l.kind as LocationKind] ?? l.kind} ·{" "}
                        {canSeeLots && l.lotCount > 0 ? <Link className="underline" href={`/inventory?loc=${l.id}`}>{l.lotCount} lot{l.lotCount === 1 ? "" : "s"} in stock</Link> : `${l.lotCount} lots in stock`}
                        {!l.isPickable && " · not pickable"}
                      </p>
                    </div>
                    <span className="flex flex-wrap gap-1">
                      {l.specialRoles.map((r) => (
                        <Chip key={r} tone="info">{SPECIAL_ROLE_LABELS[r as SpecialRole] ?? r}</Chip>
                      ))}
                      <StateChip status={l.status} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      {canCreate && opts.warehouses.length > 0 && (
        <Card id="add">
          <CardTitle>Add a location</CardTitle>
          <ActionForm action={saveLocationAction} submitLabel="Create location" variant="cta">
            <Grid>
              <SelectField name="warehouseId" label="Warehouse" defaultValue={sp.warehouse ?? opts.warehouses[0].id} options={opts.warehouses.map((w) => ({ value: w.id, label: `${w.siteCode} · ${w.code} · ${w.name}` }))} />
              <SelectField name="kind" label="Class" defaultValue="storage" options={LOCATION_KINDS.map((k) => ({ value: k, label: LOCATION_KIND_LABELS[k] }))} hint="Receiving, quarantine, hold, rejected and recall locations can be designated per warehouse." />
              <TextField name="code" label="Code" placeholder="A-03" mono hint="Unique across the organization; printed as BC:LOC:<code>." />
              <TextField name="name" label="Name" placeholder="Oils rack A-03" />
              <SelectField name="parentLocationId" label="Inside (optional)" emptyLabel="— top level —" options={opts.locations.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} hint="Builds the zone → rack → bin tree; same warehouse only." />
            </Grid>
            <CheckField name="isPickable" label="Pickable (stock here may be picked for orders and batches)" defaultChecked />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
