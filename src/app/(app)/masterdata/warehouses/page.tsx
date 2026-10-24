import { requireContext } from "@/lib/auth/context";
import { SPECIAL_ROLE_LABELS, WAREHOUSE_KINDS, WAREHOUSE_KIND_LABELS, listWarehouses } from "@/modules/masterdata";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ActionForm, Grid, SelectField, TextField } from "../_org/form";
import { saveWarehouseAction } from "../_org/actions";
import { ActiveChip, AddCard, RowCard } from "../_org/ui";

export const metadata = { title: "Warehouses" };

export default async function WarehousesPage({ searchParams }: { searchParams: Promise<{ site?: string; all?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.warehouse.view")) return <Forbidden what="warehouses" />;
  const sp = await searchParams;
  const rows = await listWarehouses(ctx, { siteId: sp.site, includeInactive: sp.all === "1" });
  const canAdmin = ctx.can("masterdata.warehouse.admin");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Warehouses"
        subtitle="Warehouses at your sites and which special locations (receiving, staging, quarantine, hold, rejected, recall) are still to be designated."
        actions={<LinkButton href={sp.all === "1" ? "/masterdata/warehouses" : "/masterdata/warehouses?all=1"} variant="secondary">{sp.all === "1" ? "Hide inactive" : "Show inactive"}</LinkButton>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No warehouses at your sites">{canAdmin ? "Add one below." : "Warehouses are set up by the system administrator."}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((w) => (
            <RowCard
              key={w.id}
              href={`/masterdata/warehouses/${w.id}`}
              code={`${w.siteCode} · ${w.code}`}
              title={w.name}
              chips={
                <>
                  <ActiveChip active={w.isActive} />
                  {w.missing.length > 0 && <Chip tone="warn">{w.missing.length} special missing</Chip>}
                </>
              }
              meta={`${WAREHOUSE_KIND_LABELS[w.warehouseKind as keyof typeof WAREHOUSE_KIND_LABELS] ?? w.warehouseKind} · ${w.locations} active location${w.locations === 1 ? "" : "s"}${w.missing.length ? ` · missing: ${w.missing.map((r) => SPECIAL_ROLE_LABELS[r]).join(", ")}` : ""}`}
            />
          ))}
        </ul>
      )}
      {canAdmin && (
        <AddCard title="Add a warehouse">
          <ActionForm action={saveWarehouseAction} submitLabel="Create warehouse" variant="cta">
            <Grid>
              <SelectField name="siteId" label="Site" defaultValue={ctx.currentSiteId} options={ctx.allowedSites.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
              <SelectField name="warehouseKind" label="Kind" defaultValue="general" options={WAREHOUSE_KINDS.map((k) => ({ value: k, label: WAREHOUSE_KIND_LABELS[k] }))} />
              <TextField name="code" label="Code" placeholder="WH2" mono />
              <TextField name="name" label="Name" placeholder="Packaging store" />
            </Grid>
            <p className="text-[13px] text-muted">After creating the warehouse you will designate its special locations.</p>
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
