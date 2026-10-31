import { requireContext } from "@/lib/auth/context";
import { SPECIAL_ROLE_LABELS, WAREHOUSE_KINDS, WAREHOUSE_KIND_LABELS, listWarehouses } from "@/modules/masterdata";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
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
        actions={<LinkButton href={sp.all === "1" ? "/masterdata/warehouses" : "/masterdata/warehouses?all=1"} variant="secondary">{sp.all === "1" ? "Hide switched-off" : "Show switched-off"}</LinkButton>}
      />
      <PageIntro>A warehouse is a building or store room at a site. Each one needs a few special places, like where deliveries arrive and where stock waits for the QA check.</PageIntro>
      {rows.length === 0 ? (
        <EmptyState title="No warehouses yet">{canAdmin ? "Add your store room below: type its name and press Add warehouse." : "Ask the owner or the system administrator to add a warehouse."}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((w) => (
            <RowCard
              key={w.id}
              href={`/masterdata/warehouses/${w.id}`}
              code={w.code}
              title={w.name}
              chips={
                <>
                  <ActiveChip active={w.isActive} />
                  {w.missing.length > 0 && <Chip tone="warn">{w.missing.length} places to set</Chip>}
                </>
              }
              meta={`${ctx.allowedSites.find((x) => x.id === w.siteId)?.name ?? w.siteCode} · ${WAREHOUSE_KIND_LABELS[w.warehouseKind as keyof typeof WAREHOUSE_KIND_LABELS] ?? w.warehouseKind} · ${w.locations} place${w.locations === 1 ? "" : "s"}${w.missing.length ? ` · still to set: ${w.missing.map((r) => SPECIAL_ROLE_LABELS[r]).join(", ")}` : ""}`}
            />
          ))}
        </ul>
      )}
      {canAdmin && (
        <AddCard title="Add a warehouse">
          <ActionForm action={saveWarehouseAction} submitLabel="Add warehouse" variant="cta">
            <TextField name="name" label="Name" placeholder="e.g. Packaging store" />
            <Grid>
              {ctx.allowedSites.length > 1 ? (
                <SelectField name="siteId" label="At which site?" defaultValue={ctx.currentSiteId} options={ctx.allowedSites.map((s) => ({ value: s.id, label: s.name }))} />
              ) : (
                <input type="hidden" name="siteId" value={ctx.currentSiteId} />
              )}
              <SelectField name="warehouseKind" label="What is kept there?" defaultValue="general" options={WAREHOUSE_KINDS.map((k) => ({ value: k, label: WAREHOUSE_KIND_LABELS[k] }))} />
            </Grid>
            <MoreDetails>
              <TextField name="code" label="Your own code (optional)" placeholder="The system gives one, e.g. WH-0001" mono />
            </MoreDetails>
            <p className="text-[13px] text-muted">Next you set its special places: where deliveries arrive, where stock waits for QA, and so on.</p>
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
