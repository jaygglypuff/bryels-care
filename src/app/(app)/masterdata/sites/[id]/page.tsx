import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSite, listDepartments, listLines, listWarehouses } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { ActionForm, CheckField, Grid, TextField } from "../../_org/form";
import { saveDepartmentAction, saveSiteAction, siteActiveAction } from "../../_org/actions";
import { ActiveChip, ReadOnlyNote, Saved, StateChip } from "../../_org/ui";

export const metadata = { title: "Site" };

export default async function SitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.site.view")) return <Forbidden what="sites" />;
  const { id } = await params;
  const { saved } = await searchParams;
  let site;
  try {
    site = await getSite(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Site not found" action={<LinkButton href="/masterdata/sites" variant="secondary">All sites</LinkButton>} />;
    throw e;
  }
  const inScope = ctx.allowedSiteIds.includes(site.id);
  const depts = inScope && ctx.can("masterdata.department.view") ? (await listDepartments(ctx, { siteId: site.id, includeInactive: true })).filter((d) => d.siteId === site.id) : [];
  const whs = inScope && ctx.can("masterdata.warehouse.view") ? (await listWarehouses(ctx, { siteId: site.id, includeInactive: true })).filter((w) => w.siteId === site.id) : [];
  const lines = inScope && ctx.can("masterdata.production_line.view") ? (await listLines(ctx, { siteId: site.id, includeInactive: true })).filter((l) => l.siteId === site.id) : [];
  const canAdmin = ctx.can("masterdata.site.admin");
  const canDept = ctx.can("masterdata.department.admin") && inScope;
  return (
    <div className="space-y-5">
      <PageHeader title={site.name} subtitle={<><span className="font-mono text-[12px] text-muted">{site.code}</span> · <ActiveChip active={site.isActive} /></>} actions={<LinkButton href="/masterdata/sites" variant="secondary">All sites</LinkButton>} />
      <PageIntro>One address where you work or keep stock, with its warehouses, making areas and teams.</PageIntro>
      <Saved show={saved === "1"} title="Site added">Next: add its warehouse (store room), then its making areas.</Saved>
      <Card>
        <CardTitle>Details</CardTitle>
        {canAdmin ? (
          <ActionForm action={saveSiteAction} submitLabel="Save" hidden={{ _id: site.id }}>
            <TextField name="name" label="Name of the place" defaultValue={site.name} />
            <Grid>
              <TextField name="addressLine1" label="Street address" defaultValue={site.addressLine1} />
              <TextField name="city" label="Town or city" defaultValue={site.city} />
            </Grid>
            <MoreDetails>
              <Grid>
                <TextField name="code" label="Your own code (optional)" defaultValue={site.code} mono hint="Appears in document numbers. Fixed once anything uses the site." />
                <TextField name="timezone" label="Time zone" defaultValue={site.timezone} />
                <TextField name="province" label="Province" defaultValue={site.province} />
                <TextField name="country" label="Country code" defaultValue={site.country} />
              </Grid>
            </MoreDetails>
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this site" />
        )}
      </Card>
      {inScope && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle action={ctx.can("masterdata.warehouse.view") ? <LinkButton size="sm" variant="secondary" href={`/masterdata/warehouses?site=${site.id}`}>Warehouses</LinkButton> : undefined}>Warehouses</CardTitle>
            {whs.length === 0 ? (
              <p className="text-[13px] text-muted">None yet. Add one under Setup → Warehouses.</p>
            ) : (
              <ul className="space-y-2 text-[14px]">
                {whs.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="font-medium text-primary-text hover:underline" href={`/masterdata/warehouses/${w.id}`}>{w.name}</Link>
                    <ActiveChip active={w.isActive} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Making areas / lines</CardTitle>
            {lines.length === 0 ? (
              <p className="text-[13px] text-muted">None yet. Add one under Setup → Making areas.</p>
            ) : (
              <ul className="space-y-2 text-[14px]">
                {lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="font-medium text-primary-text hover:underline" href={`/masterdata/lines/${l.id}`}>{l.name}</Link>
                    <StateChip status={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {inScope && ctx.can("masterdata.department.view") && (
        <Card>
          <CardTitle>Teams (departments)</CardTitle>
          {depts.length === 0 && <p className="mb-3 text-[13px] text-muted">No teams yet. A making area&apos;s team is printed on the batch record.</p>}
          <ul className="space-y-3">
            {depts.map((d) => (
              <li key={d.id} className="rounded-[14px] border border-line p-3">
                {canDept ? (
                  <ActionForm action={saveDepartmentAction} submitLabel="Save" hidden={{ _id: d.id }}>
                    <TextField name="name" label="Team name" defaultValue={d.name} />
                    <CheckField name="isActive" label="In use" defaultChecked={d.isActive} hint="A team used by a making area that is in use cannot be switched off." />
                    <MoreDetails>
                      <TextField name="code" label="Your own code (optional)" defaultValue={d.code} mono />
                    </MoreDetails>
                  </ActionForm>
                ) : (
                  <p className="flex flex-wrap items-center gap-2 text-[14px]">
                    {d.name} <span className="font-mono text-[11px] text-muted">{d.code}</span> <ActiveChip active={d.isActive} />
                  </p>
                )}
              </li>
            ))}
          </ul>
          {canDept && (
            <div className="mt-4 border-t border-line pt-4">
              <ActionForm action={saveDepartmentAction} submitLabel="Add team" hidden={{ siteId: site.id }}>
                <TextField name="name" label="New team or department" placeholder="e.g. Maintenance" />
              </ActionForm>
            </div>
          )}
        </Card>
      )}
      {canAdmin && (
        <Card>
          <CardTitle>{site.isActive ? "Switch this site off" : "Switch this site on again"}</CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            {site.isActive ? "Sites are never deleted. A site that still holds stock, or the last active site, cannot be deactivated." : "Reactivating makes the site selectable again for assignments and documents."}
          </p>
          <ActionForm action={siteActiveAction} submitLabel={site.isActive ? "Switch off" : "Switch on"} variant={site.isActive ? "danger" : "primary"} hidden={{ _id: site.id, _active: site.isActive ? "false" : "true" }}>
            <TextField name="reason" label="Why?" />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
