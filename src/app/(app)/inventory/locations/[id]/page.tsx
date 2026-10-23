import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getLocationDetail } from "@/modules/inventory/lots-admin";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Expiry, LocationKindChip, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";

export const metadata = { title: "Location" };

export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.location.view")) return <Forbidden what="locations" />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getLocationDetail>>;
  try {
    d = await getLocationDetail(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const canMove = ctx.can("inventory.movement.post") && d.siteId === ctx.currentSiteId && d.isActive && !d.frozenBy;
  return (
    <div className="space-y-5">
      <PageHeader
        title={d.code}
        subtitle={<><Link href="/inventory/locations" className="text-primary-text hover:underline">Locations</Link> · {d.name} · {d.warehouseCode}</>}
        actions={
          <>
            <LocationKindChip kind={d.kind} />
            {canMove && <LinkButton href={`/inventory/move?to=${d.id}`} variant="cta" size="sm">Move stock here</LinkButton>}
          </>
        }
      />
      {d.frozenBy && (
        <Banner tone="warn" title={`Frozen by stock count ${d.frozenBy.countNumber}`} action={ctx.can("inventory.stock_count.view") ? <LinkButton href={`/inventory/counts/${d.frozenBy.countId}`} variant="secondary" size="sm">Open count</LinkButton> : undefined}>
          Nothing can move in or out until the count is posted or cancelled.
        </Banner>
      )}
      <Card>
        <CardTitle>Lots here</CardTitle>
        {d.lots.length === 0 ? (
          <EmptyState title="Empty location">{ctx.can("inventory.lot.view") ? "No stock is recorded here." : "Your role cannot see lots."}</EmptyState>
        ) : (
          <Table head={["Lot", "Item", "Expiry", "On hand", "In boxes", "Status"]}>
            {d.lots.map((l) => (
              <tr key={l.id}>
                <Td><Link href={`/inventory/${l.id}`} className="font-mono font-semibold text-primary-text hover:underline">{l.lotNumber}</Link></Td>
                <Td>{l.itemName}<div className="text-[12px] text-muted">{l.itemCode}</div></Td>
                <Td><Expiry date={l.expiresOn} /></Td>
                <Td className="font-medium">{fmtLotQty(l.onHand, l.baseUom)}</Td>
                <Td>{new Decimal(l.boxed).gt(0) ? fmtLotQty(l.boxed, l.baseUom) : "—"}</Td>
                <Td><StatusChip status={l.qualityStatus} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {ctx.can("inventory.container.view") && (
        <Card>
          <CardTitle>Boxes here</CardTitle>
          {d.boxes.length === 0 ? (
            <EmptyState title="No boxes">Stock here is loose.</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-2">
              {d.boxes.map((b) => (
                <Link key={b.id} href={`/inventory/containers/${b.id}`} className="rounded-full border border-line px-3 py-1.5 font-mono text-[13px] hover:bg-surface-2">
                  {b.number} {b.status === "sealed" && <Chip>sealed</Chip>}
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
