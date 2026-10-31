import { requireContext } from "@/lib/auth/context";
import { listSites } from "@/modules/masterdata";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
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
        actions={<LinkButton href={all === "1" ? "/masterdata/sites" : "/masterdata/sites?all=1"} variant="secondary">{all === "1" ? "Hide switched-off sites" : "Show switched-off sites"}</LinkButton>}
      />
      <PageIntro>A site is one address where you work or keep stock, for example the factory or a store room in another town.</PageIntro>
      {rows.length === 0 ? (
        <EmptyState title="No sites yet">{canAdmin ? "Add your factory below: type its name and press Add site." : "Ask the owner or the system administrator to add a site."}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <RowCard
              key={s.id}
              href={`/masterdata/sites/${s.id}`}
              code={s.code}
              title={s.name}
              chips={<ActiveChip active={s.isActive} />}
              meta={`${s.city ? `${s.city} · ` : ""}${s.warehouses} warehouse${s.warehouses === 1 ? "" : "s"} · ${s.lines} making area${s.lines === 1 ? "" : "s"}`}
            />
          ))}
        </ul>
      )}
      {canAdmin && (
        <AddCard title="Add a site">
          <ActionForm action={saveSiteAction} submitLabel="Add site" variant="cta">
            <TextField name="name" label="Name of the place" placeholder="e.g. Batangas store room" />
            <Grid>
              <TextField name="addressLine1" label="Street address (optional)" />
              <TextField name="city" label="Town or city (optional)" />
            </Grid>
            <MoreDetails>
              <Grid>
                <TextField name="code" label="Your own code (optional)" placeholder="The system makes one from the name" mono hint="1 to 6 capital letters or digits. It appears in document numbers." />
                <TextField name="timezone" label="Time zone" placeholder="Asia/Manila" hint="Leave empty to use the company's time zone." />
                <TextField name="province" label="Province" />
                <TextField name="country" label="Country code" placeholder="PH" hint="Leave empty for the Philippines." />
              </Grid>
            </MoreDetails>
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
