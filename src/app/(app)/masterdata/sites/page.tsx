import { requireContext } from "@/lib/auth/context";
import { listSites } from "@/modules/masterdata";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { ActionForm, Grid, TextField } from "../_org/form";
import { saveSiteAction } from "../_org/actions";
import { ActiveChip, AddCard, RowCard } from "../_org/ui";

export const metadata = { title: "Sites" };

export default async function SitesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.site.view")) return <Forbidden what="sites" />;
  const { all } = await searchParams;
  const rows = await listSites(ctx, { includeInactive: all === "1" });
  const canAdmin = ctx.can("masterdata.site.admin");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Sites"
        subtitle="Plants and warehouses of the organization. The site code appears in document numbers and is fixed once used."
        actions={<LinkButton href={all === "1" ? "/masterdata/sites" : "/masterdata/sites?all=1"} variant="secondary">{all === "1" ? "Hide inactive" : "Show inactive"}</LinkButton>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No sites">{canAdmin ? "Add the first site below." : "Sites are set up by the system administrator."}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <RowCard
              key={s.id}
              href={`/masterdata/sites/${s.id}`}
              code={s.code}
              title={s.name}
              chips={<ActiveChip active={s.isActive} />}
              meta={`${s.timezone}${s.city ? ` · ${s.city}` : ""} · ${s.warehouses} warehouse${s.warehouses === 1 ? "" : "s"} · ${s.departments} department${s.departments === 1 ? "" : "s"} · ${s.lines} line${s.lines === 1 ? "" : "s"}`}
            />
          ))}
        </ul>
      )}
      {canAdmin && (
        <AddCard title="Add a site">
          <ActionForm action={saveSiteAction} submitLabel="Create site" variant="cta">
            <Grid>
              <TextField name="code" label="Code" placeholder="BTG" mono hint="1 to 6 capital letters or digits; used as {SITE} in numbers." />
              <TextField name="name" label="Name" placeholder="Batangas Annex" />
              <TextField name="timezone" label="Time zone (optional)" placeholder="Asia/Manila" hint="Defaults to the organization's time zone." />
              <TextField name="addressLine1" label="Address (optional)" />
              <TextField name="city" label="City (optional)" />
              <TextField name="province" label="Province (optional)" />
              <TextField name="country" label="Country code (optional)" placeholder="PH" />
            </Grid>
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
