import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSite, listDepartments, listLines, listWarehouses } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
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
      <PageHeader title={`${site.code} · ${site.name}`} subtitle={<>Time zone {site.timezone} · <ActiveChip active={site.isActive} /></>} actions={<LinkButton href="/masterdata/sites" variant="secondary">All sites</LinkButton>} />
      <Saved show={saved === "1"} title="Site created">Add its warehouses, departments and production lines next.</Saved>
      <Card>
        <CardTitle>Site details</CardTitle>
        {canAdmin ? (
          <ActionForm action={saveSiteAction} submitLabel="Save site" hidden={{ _id: site.id }}>
            <Grid>
              <TextField name="code" label="Code" defaultValue={site.code} mono hint="Fixed once anything references the site." />
              <TextField name="name" label="Name" defaultValue={site.name} />
              <TextField name="timezone" label="Time zone" defaultValue={site.timezone} />
              <TextField name="addressLine1" label="Address" defaultValue={site.addressLine1} />
              <TextField name="city" label="City" defaultValue={site.city} />
              <TextField name="province" label="Province" defaultValue={site.province} />
              <TextField name="country" label="Country code" defaultValue={site.country} />
            </Grid>
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
              <p className="text-[13px] text-muted">No warehouses yet.</p>
            ) : (
              <ul className="space-y-2 text-[14px]">
                {whs.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="font-medium text-primary-text hover:underline" href={`/masterdata/warehouses/${w.id}`}>{w.code} · {w.name}</Link>
                    <ActiveChip active={w.isActive} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Production lines</CardTitle>
            {lines.length === 0 ? (
              <p className="text-[13px] text-muted">No production lines yet.</p>
            ) : (
              <ul className="space-y-2 text-[14px]">
                {lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="font-medium text-primary-text hover:underline" href={`/masterdata/lines/${l.id}`}>{l.code} · {l.name}</Link>
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
          <CardTitle>Departments</CardTitle>
          {depts.length === 0 && <p className="mb-3 text-[13px] text-muted">No departments yet.</p>}
          <ul className="space-y-3">
            {depts.map((d) => (
              <li key={d.id} className="rounded-[14px] border border-line p-3">
                {canDept ? (
                  <ActionForm action={saveDepartmentAction} submitLabel="Save" hidden={{ _id: d.id }}>
                    <Grid>
                      <TextField name="code" label="Code" defaultValue={d.code} mono />
                      <TextField name="name" label="Name" defaultValue={d.name} />
                    </Grid>
                    <CheckField name="isActive" label="Active" defaultChecked={d.isActive} hint="A department used by an active line cannot be deactivated." />
                  </ActionForm>
                ) : (
                  <p className="flex flex-wrap items-center gap-2 text-[14px]">
                    <span className="font-mono">{d.code}</span> {d.name} <ActiveChip active={d.isActive} />
                  </p>
                )}
              </li>
            ))}
          </ul>
          {canDept && (
            <div className="mt-4 border-t border-line pt-4">
              <ActionForm action={saveDepartmentAction} submitLabel="Add department" hidden={{ siteId: site.id }}>
                <Grid>
                  <TextField name="code" label="Code" placeholder="MNT" mono />
                  <TextField name="name" label="Name" placeholder="Maintenance" />
                </Grid>
              </ActionForm>
            </div>
          )}
        </Card>
      )}
      {canAdmin && (
        <Card>
          <CardTitle>{site.isActive ? "Deactivate site" : "Reactivate site"}</CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            {site.isActive ? "Sites are never deleted. A site that still holds stock, or the last active site, cannot be deactivated." : "Reactivating makes the site selectable again for assignments and documents."}
          </p>
          <ActionForm action={siteActiveAction} submitLabel={site.isActive ? "Deactivate" : "Reactivate"} variant={site.isActive ? "danger" : "primary"} hidden={{ _id: site.id, _active: site.isActive ? "false" : "true" }}>
            <TextField name="reason" label="Reason" />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
