import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { LOCATION_KIND_LABELS, SPECIAL_ROLE_KIND, SPECIAL_ROLE_LABELS, WAREHOUSE_KINDS, WAREHOUSE_KIND_LABELS, getWarehouse, type LocationKind, type SpecialRole } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ActionForm, Grid, SelectField, TextField } from "../../_org/form";
import { designateAction, saveWarehouseAction, warehouseActiveAction } from "../../_org/actions";
import { ActiveChip, ReadOnlyNote, StateChip } from "../../_org/ui";

export const metadata = { title: "Warehouse" };

const ROLES = Object.keys(SPECIAL_ROLE_LABELS) as SpecialRole[];

export default async function WarehousePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.warehouse.view")) return <Forbidden what="warehouses" />;
  const { id } = await params;
  const { created } = await searchParams;
  let w;
  try {
    w = await getWarehouse(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Warehouse not found in your sites" action={<LinkButton href="/masterdata/warehouses" variant="secondary">All warehouses</LinkButton>} />;
    throw e;
  }
  const canAdmin = ctx.can("masterdata.warehouse.admin");
  const canDesignate = ctx.can("masterdata.location.admin");
  return (
    <div className="space-y-5">
      <PageHeader title={`${w.siteCode} · ${w.code} · ${w.name}`} subtitle={<>{WAREHOUSE_KIND_LABELS[w.warehouseKind as keyof typeof WAREHOUSE_KIND_LABELS]} · <ActiveChip active={w.isActive} /></>} actions={<LinkButton href="/masterdata/warehouses" variant="secondary">All warehouses</LinkButton>} />
      {created === "1" && <Banner tone="ok" title="Warehouse created">Create its locations, then designate the special locations below.</Banner>}
      {w.missing.length > 0 ? (
        <Banner tone="warn" title={`Special locations still missing: ${w.missing.map((r) => SPECIAL_ROLE_LABELS[r]).join(", ")}`}>
          Stock receipts, holds, rejections and recalls need these locations. Create a location of the matching class, then designate it here.
        </Banner>
      ) : (
        <Banner tone="ok" title="Every special location is designated" />
      )}
      <Card>
        <CardTitle>Special locations</CardTitle>
        <ul className="space-y-3">
          {ROLES.map((role) => {
            const current = w.designations.find((d) => d.role === role);
            const kind = SPECIAL_ROLE_KIND[role];
            const options = w.locations.filter((l) => l.kind === kind && l.status === "active");
            return (
              <li key={role} className="rounded-[14px] border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{SPECIAL_ROLE_LABELS[role]}</span>
                  <span className="text-[13px]">{current ? <span className="font-mono">{current.locationCode}</span> : <span className="text-[var(--warn-fg)]">Not designated</span>}</span>
                </div>
                {canDesignate &&
                  (options.length ? (
                    <div className="mt-2">
                      <ActionForm action={designateAction} submitLabel={current ? "Change" : "Designate"} hidden={{ warehouseId: w.id, role }}>
                        <SelectField name="locationId" label={`${LOCATION_KIND_LABELS[kind as LocationKind]} location`} defaultValue={current?.locationId ?? options[0].id} options={options.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} />
                      </ActionForm>
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] text-muted">
                      No active {kind} location in this warehouse yet. <Link href={`/masterdata/locations?warehouse=${w.id}#add`} className="text-primary-text underline">Create one</Link>.
                    </p>
                  ))}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <CardTitle action={<LinkButton size="sm" variant="secondary" href={`/masterdata/locations?warehouse=${w.id}`}>Manage locations</LinkButton>}>Locations ({w.locations.length})</CardTitle>
        {w.locations.length === 0 ? (
          <p className="text-[13px] text-muted">No locations yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {w.locations.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line p-2.5 text-[13px]">
                <Link href={`/masterdata/locations/${l.id}`} className="font-mono font-semibold text-primary-text hover:underline">{l.code}</Link>
                <span className="text-muted">{LOCATION_KIND_LABELS[l.kind as LocationKind] ?? l.kind}</span>
                <StateChip status={l.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardTitle>Warehouse details</CardTitle>
        {canAdmin ? (
          <ActionForm action={saveWarehouseAction} submitLabel="Save warehouse" hidden={{ _id: w.id }}>
            <Grid>
              <TextField name="code" label="Code" defaultValue={w.code} mono hint="Fixed once locations exist." />
              <TextField name="name" label="Name" defaultValue={w.name} />
              <SelectField name="warehouseKind" label="Kind" defaultValue={w.warehouseKind} options={WAREHOUSE_KINDS.map((k) => ({ value: k, label: WAREHOUSE_KIND_LABELS[k] }))} />
            </Grid>
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this warehouse" />
        )}
      </Card>
      {canAdmin && (
        <Card>
          <CardTitle>{w.isActive ? "Deactivate warehouse" : "Reactivate warehouse"}</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Warehouses are never deleted. Deactivate its locations first; locations that hold stock cannot be deactivated.</p>
          <ActionForm action={warehouseActiveAction} submitLabel={w.isActive ? "Deactivate" : "Reactivate"} variant={w.isActive ? "danger" : "primary"} hidden={{ _id: w.id, _active: w.isActive ? "false" : "true" }}>
            <TextField name="reason" label="Reason" />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
