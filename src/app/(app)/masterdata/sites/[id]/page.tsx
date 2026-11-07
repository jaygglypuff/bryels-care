import { screenPreferences } from "@/modules/governance";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSite, listDepartments, listLines, listWarehouses } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { EditDetails, FormSection } from "@/ui/form-section";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { ActionForm, CheckField, Grid, TextField } from "../../_org/form";
import { saveDepartmentAction, saveSiteAction, siteActiveAction } from "../../_org/actions";
import { ActiveChip, ReadOnlyNote, Saved, StateChip } from "../../_org/ui";

export const metadata = { title: "Site" };

export default async function SitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireContext();
  const { setupFormsFolded } = await screenPreferences(ctx); // ADR-126: setting ui.setup_edit_forms_folded
  if (!ctx.can("masterdata.site.view")) return <Forbidden what="sites" permission="masterdata.site.view" />;
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
    <div className="space-y-4">
      <RecordHeader back={{ href: "/masterdata/sites", label: "Sites" }} typeLabel="Site" title={site.name} chip={<ActiveChip active={site.isActive} />} meta={[<span key="code" className="font-mono">{site.code}</span>]} />
      <PageIntro>One address where you work or keep stock, with its warehouses, making areas and teams.</PageIntro>
      <Saved show={saved === "1"} title="Site added">Next: add its warehouse (store room), then its making areas.</Saved>
      {!site.isActive ? (
        <NextStep text="Switched off: this site is no longer used. Kept on record." />
      ) : inScope && whs.length === 0 && ctx.can("masterdata.warehouse.view") ? (
        <NextStep text="Next: add the store room (warehouse) of this site." action={{ label: "Add a warehouse", href: `/masterdata/warehouses?site=${site.id}` }} />
      ) : inScope && lines.length === 0 && ctx.can("masterdata.production_line.view") ? (
        <NextStep text="Next: add the making areas (lines) of this site." action={{ label: "Add a making area", href: "/masterdata/lines" }} />
      ) : (
        <NextStep text="This site is set up. Nothing to do now." />
      )}
      {/* ADR-123: the shared fold and titled sections (same form, same action). */}
      <EditDetails open={!setupFormsFolded} title="Change the name or address">
        {canAdmin ? (
          <ActionForm action={saveSiteAction} submitLabel="Save" hidden={{ _id: site.id }}>
            <FormSection
              title="Name and address"
              moreTitle="Code, time zone, province, country (you can skip this)"
              more={
                <Grid>
                  <TextField name="code" label="Your own code (optional)" defaultValue={site.code} mono hint="Appears in document numbers. Fixed once anything uses the site." />
                  <TextField name="timezone" label="Time zone" defaultValue={site.timezone} />
                  <TextField name="province" label="Province" defaultValue={site.province} />
                  <TextField name="country" label="Country code" defaultValue={site.country} />
                </Grid>
              }
            >
              <TextField name="name" label="Name of the place" defaultValue={site.name} />
              <Grid>
                <TextField name="addressLine1" label="Street address" defaultValue={site.addressLine1} />
                <TextField name="city" label="Town or city" defaultValue={site.city} />
              </Grid>
            </FormSection>
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this site" />
        )}
      </EditDetails>
      {inScope && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle action={ctx.can("masterdata.warehouse.view") ? <LinkButton size="sm" variant="secondary" href={`/masterdata/warehouses?site=${site.id}`}>Warehouses</LinkButton> : undefined}>Warehouses</CardTitle>
            {whs.length === 0 ? (
              <p className="text-[13px] text-muted">None yet. Add one under Management › Master data › Warehouses.</p>
            ) : (
              <ul className="space-y-2 text-[14px]">
                {whs.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="inline-flex min-h-[44px] items-center font-medium text-primary-text hover:underline" href={`/masterdata/warehouses/${w.id}`}>{w.name}</Link>
                    <ActiveChip active={w.isActive} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Making areas / lines</CardTitle>
            {lines.length === 0 ? (
              <p className="text-[13px] text-muted">None yet. Add one under Management › Master data › Making areas / lines.</p>
            ) : (
              <ul className="space-y-2 text-[14px]">
                {lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="inline-flex min-h-[44px] items-center font-medium text-primary-text hover:underline" href={`/masterdata/lines/${l.id}`}>{l.name}</Link>
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
                  // Round 4 (UX re-audit C #7): one row per team; its form opens with "Change" (was one open form per team).
                  <details>
                    <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-2 text-[14px] [&::-webkit-details-marker]:hidden">
                      <span className="font-medium">{d.name}</span> <ActiveChip active={d.isActive} />
                      <span className="ml-auto text-[13px] font-medium text-primary-text">Change</span>
                    </summary>
                    <ActionForm action={saveDepartmentAction} submitLabel="Save" variant="secondary" hidden={{ _id: d.id }}>
                      <TextField name="name" label="Team name" defaultValue={d.name} />
                      <CheckField name="isActive" label="In use" defaultChecked={d.isActive} hint="A team used by a making area that is in use cannot be switched off." />
                      <MoreDetails>
                        <TextField name="code" label="Your own code (optional)" defaultValue={d.code} mono />
                      </MoreDetails>
                    </ActionForm>
                  </details>
                ) : (
                  <p className="flex flex-wrap items-center gap-2 text-[14px]">
                    {d.name} <span className="font-mono text-[11px] text-muted">{d.code}</span> <ActiveChip active={d.isActive} />
                  </p>
                )}
              </li>
            ))}
          </ul>
          {canDept && (
            <details className="mt-4 border-t border-line pt-2">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Add a team</summary>
              <ActionForm action={saveDepartmentAction} submitLabel="Add team" variant="secondary" hidden={{ siteId: site.id }}>
                <TextField name="name" label="New team or department" placeholder="e.g. Maintenance" />
              </ActionForm>
            </details>
          )}
        </Card>
      )}
      {canAdmin && (
        <MoreDetails title={site.isActive ? "Switch this site off" : "Switch this site on again"}>
          <p className="mb-3 text-[13px] text-muted">
            {site.isActive ? "Sites are never deleted. A site that still holds stock, or the last active site, cannot be deactivated." : "Reactivating makes the site selectable again for assignments and documents."}
          </p>
          <ActionForm action={siteActiveAction} submitLabel={site.isActive ? "Switch off" : "Switch on"} variant={site.isActive ? "danger" : "primary"} hidden={{ _id: site.id, _active: site.isActive ? "false" : "true" }}>
            <TextField name="reason" label="Why?" />
          </ActionForm>
        </MoreDetails>
      )}
    </div>
  );
}
