import { requireContext } from "@/lib/auth/context";
import { lineFormOptions, listLines } from "@/modules/masterdata";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { ActionForm, Grid, SelectField, TextField, TextareaField } from "../_org/form";
import { saveLineAction } from "../_org/actions";
import { AddCard, RowCard, StateChip } from "../_org/ui";

export const metadata = { title: "Making areas / lines" };

export default async function LinesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.production_line.view")) return <Forbidden what="production lines" />;
  const { all } = await searchParams;
  const rows = await listLines(ctx, { includeInactive: all === "1" });
  const canAdmin = ctx.can("masterdata.production_line.admin");
  const opts = canAdmin ? await lineFormOptions(ctx) : { departments: [], lines: [] };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Making areas / lines"
        actions={<LinkButton href={all === "1" ? "/masterdata/lines" : "/masterdata/lines?all=1"} variant="secondary">{all === "1" ? "Hide switched-off" : "Show switched-off"}</LinkButton>}
      />
      <PageIntro>A making area (or line) is where batches are made, for example the soap room. Each one has its own machines.</PageIntro>
      {rows.length === 0 ? (
        <EmptyState title="No making areas yet">{canAdmin ? "Add one below: type its name and press Add making area." : "Ask the owner or the system administrator to add one."}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((l) => (
            <RowCard key={l.id} href={`/masterdata/lines/${l.id}`} code={l.code} title={l.name} chips={<StateChip status={l.status} />} meta={`${ctx.allowedSites.find((x) => x.id === l.siteId)?.name ?? l.siteCode} · ${l.departmentName ?? "No team"} · ${l.equipmentCount} machine${l.equipmentCount === 1 ? "" : "s"}`} />
          ))}
        </ul>
      )}
      {canAdmin && (
        <AddCard title="Add a making area">
          <ActionForm action={saveLineAction} submitLabel="Add making area" variant="cta">
            <TextField name="name" label="Name" placeholder="e.g. Soap room" />
            <Grid>
              {ctx.allowedSites.length > 1 ? (
                <SelectField name="siteId" label="At which site?" defaultValue={ctx.currentSiteId} options={ctx.allowedSites.map((s) => ({ value: s.id, label: s.name }))} />
              ) : (
                <input type="hidden" name="siteId" value={ctx.currentSiteId} />
              )}
              <SelectField
                name="departmentId"
                label="Team (optional)"
                emptyLabel="None"
                options={opts.departments.map((d) => ({ value: d.id, label: ctx.allowedSites.length > 1 ? `${d.name} (${ctx.allowedSites.find((s) => s.id === d.siteId)?.name ?? ""})` : d.name }))}
                hint="Printed on the batch record. Must be a team of the same site."
              />
            </Grid>
            <MoreDetails>
              <TextField name="code" label="Your own code (optional)" placeholder="The system gives one, e.g. LINE-0001" mono />
              <TextareaField name="notes" label="Notes" />
            </MoreDetails>
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
