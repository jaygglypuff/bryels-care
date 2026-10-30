import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { LOCATION_KINDS, LOCATION_KIND_LABELS, LOCATION_TRANSITIONS, SPECIAL_ROLE_LABELS, getLocation, locationFormOptions, type LocationKind, type LocationStatus, type SpecialRole } from "@/modules/masterdata";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
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
      <PageHeader title={`${l.code} · ${l.name}`} subtitle={<>{l.warehouse.code} · {LOCATION_KIND_LABELS[l.kind as LocationKind] ?? l.kind} · <StateChip status={l.status} /></>} actions={<>{canEdit && <LinkButton href="#edit" variant="cta">Edit location</LinkButton>}<LinkButton href={`/masterdata/locations?warehouse=${l.warehouseId}`} variant="secondary">All locations</LinkButton></>} />
      <LocationHelp canSeeSites={ctx.can("masterdata.site.view")} />
      {created === "1" && <Banner tone="ok" title="Location created">It can receive stock now. Print its label from the label station when needed.</Banner>}
      <Card>
        <Dl
          items={[
            ["Warehouse", `${l.warehouse.code} · ${l.warehouse.name}`],
            ["Section or zone", l.parent ? <Link className="font-mono underline" href={`/masterdata/locations/${l.parent.id}`}>{l.parent.code}</Link> : "—"],
            ["Special role", l.specialRoles.length ? l.specialRoles.map((r) => SPECIAL_ROLE_LABELS[r as SpecialRole] ?? r).join(", ") : "—"],
            ["Lots in stock", String(l.lotsInStock)],
            ["Pickable", l.isPickable ? "Yes" : "No"],
            ["Contains", l.children.length ? l.children.map((c) => c.code).join(", ") : "—"],
          ]}
        />
      </Card>
      <Card id="edit">
        <CardTitle>Edit location</CardTitle>
        {canEdit ? (
          <ActionForm action={saveLocationAction} submitLabel="Save location" hidden={{ _id: l.id }}>
            <Grid>
              <TextField name="code" label="Code" defaultValue={l.code} mono hint="Fixed once stock has been recorded here." />
              <TextField name="name" label="Name" defaultValue={l.name} />
              <SelectField name="kind" label="Type of place" defaultValue={l.kind} options={LOCATION_KINDS.map((k) => ({ value: k, label: LOCATION_KIND_LABELS[k] }))} hint="Changes only while the location is empty and not a designated special location." />
              <SelectField name="parentLocationId" label="Section or zone (optional)" hint="The bigger place this one is inside, e.g. zone A." defaultValue={l.parentLocationId} emptyLabel="— top level —" options={parents.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />
            </Grid>
            <CheckField name="isPickable" label="Pickable" defaultChecked={l.isPickable} />
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
                <TextField name="reason" label="Reason" />
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
