import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { LOCATION_KINDS, LOCATION_KIND_LABELS, LOCATION_TRANSITIONS, SPECIAL_ROLE_LABELS, getLocation, locationFormOptions, type LocationKind, type LocationStatus, type SpecialRole } from "@/modules/masterdata";
import { LOCATION_SECTIONS, SECTION_LABELS, isSection } from "@/lib/location-sections";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ActionForm, CheckField, Grid, SelectField, TextField } from "../../_org/form";
import { locationStatusAction, saveLocationAction } from "../../_org/actions";
import { ReadOnlyNote, StateChip } from "../../_org/ui";
import { LocationHelp } from "../../_org/location-help";

export const metadata = { title: "Location" };

const VERB: Record<LocationStatus, string> = { active: "Turn on (in use)", blocked: "Block (no stock in or out)", inactive: "Switch off (no longer used)" };

export default async function LocationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.location.view")) return <Forbidden what="locations" />;
  const { id } = await params;
  const { created } = await searchParams;
  let l;
  try {
    l = await getLocation(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Location not found in your sites" action={<LinkButton href="/masterdata/locations" variant="secondary">All locations</LinkButton>} />;
    throw e;
  }
  const canEdit = ctx.can("masterdata.location.edit");
  const canAdmin = ctx.can("masterdata.location.admin");
  const opts = canEdit ? await locationFormOptions(ctx, l.siteId) : { warehouses: [], locations: [] };
  const parents = opts.locations.filter((x) => x.warehouseId === l.warehouseId && x.id !== l.id);
  const moves = (LOCATION_TRANSITIONS[l.status as LocationStatus] ?? []).filter((s) => (s === "inactive" || l.status === "inactive" ? canAdmin : canEdit));
  return (
    <div className="space-y-5">
      <PageHeader title={l.name} subtitle={<><span className="font-mono text-[12px] text-muted">{l.code}</span> · {l.warehouse.name} · {LOCATION_KIND_LABELS[l.kind as LocationKind] ?? l.kind} · <StateChip status={l.status} /></>} actions={<>{canEdit && <LinkButton href="#edit" variant="cta">Edit location</LinkButton>}<LinkButton href={`/masterdata/locations?warehouse=${l.warehouseId}`} variant="secondary">All locations</LinkButton></>} />
      <PageIntro>One place where stock sits. Rename it, move it inside a bigger place, or switch it off.</PageIntro>
      <LocationHelp canSeeSites={ctx.can("masterdata.site.view")} />
      {created === "1" && <Banner tone="ok" title="Location added">It can receive stock now. Print its label from the label station when needed.</Banner>}
      <Card>
        <Dl
          items={[
            ["Warehouse", l.warehouse.name],
            ["Inside", l.parent ? <Link className="underline" href={`/masterdata/locations/${l.parent.id}`}>{l.parent.name}</Link> : "—"],
            ["Special role", l.specialRoles.length ? l.specialRoles.map((r) => SPECIAL_ROLE_LABELS[r as SpecialRole] ?? r).join(", ") : "—"],
            ["Lots in stock", String(l.lotsInStock)],
            ["Section", isSection(l.section) ? SECTION_LABELS[l.section] : "Not set (worked out from the class)"],
            ["Stock may be taken from here", l.isPickable ? "Yes" : "No"],
            ["Contains", l.children.length ? l.children.map((c) => c.name).join(", ") : "—"],
          ]}
        />
      </Card>
      <Card id="edit">
        <CardTitle>Edit location</CardTitle>
        {canEdit ? (
          <ActionForm action={saveLocationAction} submitLabel="Save" hidden={{ _id: l.id }}>
            <TextField name="name" label="Name of the place" defaultValue={l.name} />
            <Grid>
              <SelectField name="kind" label="Type of place" defaultValue={l.kind} options={LOCATION_KINDS.map((k) => ({ value: k, label: LOCATION_KIND_LABELS[k] }))} hint="Changes only while the place is empty and not a special place." />
              <SelectField name="parentLocationId" label="Inside a bigger place? (optional)" defaultValue={l.parentLocationId} emptyLabel="No" options={parents.map((p) => ({ value: p.id, label: p.name }))} />
            </Grid>
            <MoreDetails>
              <Grid>
                <TextField name="code" label="Your own code (optional)" defaultValue={l.code} mono hint="Fixed once stock has been recorded here." />
                <SelectField name="section" label="Warehouse section" defaultValue={l.section} emptyLabel="Work it out from the type" options={LOCATION_SECTIONS.map((x) => ({ value: x, label: SECTION_LABELS[x] }))} hint="Groups stock on the warehouse screens. Does not change any stock rule." />
              </Grid>
              <CheckField name="isPickable" label="Stock here may be taken for orders and batches" defaultChecked={l.isPickable} />
            </MoreDetails>
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this location" />
        )}
      </Card>
      {moves.length > 0 && (
        <Card>
          <CardTitle>In use or switched off</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Locations are never deleted. A location that holds stock, is a designated special location or contains active locations cannot be deactivated.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {moves.map((s) => (
              <ActionForm key={s} action={locationStatusAction} submitLabel={VERB[s]} variant={s === "active" ? "primary" : "danger"} hidden={{ _id: l.id, status: s }}>
                <TextField name="reason" label="Why?" />
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
