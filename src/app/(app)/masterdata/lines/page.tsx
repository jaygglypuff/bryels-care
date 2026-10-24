import { requireContext } from "@/lib/auth/context";
import { lineFormOptions, listLines } from "@/modules/masterdata";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { ActionForm, Grid, SelectField, TextField, TextareaField } from "../_org/form";
import { saveLineAction } from "../_org/actions";
import { AddCard, RowCard, StateChip } from "../_org/ui";

export const metadata = { title: "Production lines" };

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
        title="Production lines"
        subtitle="Lines at your sites, their department (printed on the batch record) and the equipment registered to each line."
        actions={<LinkButton href={all === "1" ? "/masterdata/lines" : "/masterdata/lines?all=1"} variant="secondary">{all === "1" ? "Hide inactive" : "Show inactive"}</LinkButton>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No production lines at your sites">{canAdmin ? "Add one below." : "Lines are set up by the system administrator."}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((l) => (
            <RowCard key={l.id} href={`/masterdata/lines/${l.id}`} code={`${l.siteCode} · ${l.code}`} title={l.name} chips={<StateChip status={l.status} />} meta={`${l.departmentName ?? "No department"} · ${l.equipmentCount} equipment`} />
          ))}
        </ul>
      )}
      {canAdmin && (
        <AddCard title="Add a production line">
          <ActionForm action={saveLineAction} submitLabel="Create line" variant="cta">
            <Grid>
              <SelectField name="siteId" label="Site" defaultValue={ctx.currentSiteId} options={ctx.allowedSites.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
              <SelectField
                name="departmentId"
                label="Department (optional)"
                emptyLabel="— none —"
                options={opts.departments.map((d) => ({ value: d.id, label: `${ctx.allowedSites.find((s) => s.id === d.siteId)?.code ?? ""} · ${d.name}` }))}
                hint="Must be a department of the same site."
              />
              <TextField name="code" label="Code" placeholder="SOAP-2" mono />
              <TextField name="name" label="Name" placeholder="Soap line 2" />
            </Grid>
            <TextareaField name="notes" label="Notes (optional)" />
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
