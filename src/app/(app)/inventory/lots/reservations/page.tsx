import Link from "next/link";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { DomainError } from "@/lib/errors";
import { getInventorySetting } from "@/modules/inventory/policy";
import { expireReservations, itemKeyOfLot, listReservations, recommendLots, recommendableItems } from "@/modules/inventory/reservations";
import { Card, CardTitle, EmptyState, Input, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Expiry } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { releaseReservationAction } from "./actions";
import { ReserveForm } from "./reserve-form";

export const metadata = { title: "FEFO and reservations" };

type SP = { item?: string; customer?: string; qty?: string; lot?: string };

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="stock recommendations" />;
  const sp = await searchParams;
  const items = await recommendableItems(ctx);
  // ?lot=<id> (from the lot card) preselects the lot's item.
  let item = sp.item ?? "";
  if (!item && sp.lot) item = (await itemKeyOfLot(ctx, sp.lot)) ?? "";
  const [kind, itemId] = item.split(":");
  let rec: Awaited<ReturnType<typeof recommendLots>> | null = null;
  let recError: string | null = null;
  if (itemId) {
    try {
      rec = await recommendLots(ctx, { materialId: kind === "m" ? itemId : null, productId: kind === "p" ? itemId : null, customerId: sp.customer || null, qty: /^\d{1,12}(\.\d{1,6})?$/.test(sp.qty ?? "") ? sp.qty : null });
    } catch (e) {
      recError = e instanceof DomainError ? e.message : "The recommendation could not be computed.";
    }
  }
  const canReserve = ctx.can("inventory.reservation.create");
  const canSeeReservations = ctx.can("inventory.reservation.view");
  if (canSeeReservations) await expireReservations(db, ctx.currentSiteId);
  const reservations = canSeeReservations ? await listReservations(ctx, { status: "active" }) : [];
  const ttl = await getInventorySetting(db, ctx.organizationId, ctx.currentSiteId, "inventory.reservation.ttl_hours");

  return (
    <div className="space-y-5">
      <PageHeader title="FEFO recommendation & reservations" subtitle={`${ctx.currentSite.code} · which lot to use next, and stock held for a demand (reservations reduce what can be promised)`} />
      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1.5fr_1fr_auto] sm:items-end" role="search">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="item" className="text-[13px] font-medium">Material or product</label>
            <Select id="item" name="item" defaultValue={item}>
              <option value="">Choose…</option>
              <optgroup label="Materials">{items.materials.map((m) => <option key={m.id} value={`m:${m.id}`}>{m.code} · {m.name}</option>)}</optgroup>
              <optgroup label="Products">{items.products.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.code} · {p.name}</option>)}</optgroup>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="customer" className="text-[13px] font-medium">For customer (optional)</label>
            <Select id="customer" name="customer" defaultValue={sp.customer ?? ""}>
              <option value="">Any</option>
              {items.customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="qty" className="text-[13px] font-medium">Quantity needed</label>
            <Input id="qty" name="qty" inputMode="decimal" defaultValue={sp.qty ?? ""} />
          </div>
          <button type="submit" className={buttonClass("primary")}>Recommend</button>
        </form>
      </Card>

      {recError && <Banner tone="bad" title="No recommendation">{recError}</Banner>}
      {rec && (
        <Card>
          <CardTitle>
            {rec.strategy.toUpperCase()} order <span className="text-[13px] font-normal text-muted">· rule: {rec.source.replace("_", " ")}{rec.minShelfLifeDays ? ` · minimum ${rec.minShelfLifeDays} days shelf life` : ""}</span>
          </CardTitle>
          {rec.picks.length > 0 && (
            <Banner tone="ok" title="Use these first">
              {rec.picks.map((p) => `${p.qty} from ${p.lotNumber} at ${p.locationCode}`).join("; ")}{rec.shortfall ? ` — short by ${rec.shortfall}` : ""}
            </Banner>
          )}
          {rec.candidates.length === 0 ? (
            <EmptyState title="No stock of this item at this site" />
          ) : (
            <div className="mt-3">
              <Table head={["Rank", "Lot", "Location", "Expiry", "On hand", "Reserved", "Allocated", "Available", "Why not", ""]}>
                {rec.candidates.map((c) => (
                  <tr key={`${c.lotId}-${c.locationId}`} className={c.eligible ? "" : "text-muted"}>
                    <Td className="font-semibold">{c.rank ?? "—"}</Td>
                    <Td><Link href={`/inventory/${c.lotId}`} className="font-mono text-primary-text hover:underline">{c.lotNumber}</Link> <StatusChip status={c.qualityStatus} /></Td>
                    <Td className="font-mono">{c.locationCode}</Td>
                    <Td><Expiry date={c.expiresOn} /></Td>
                    <Td>{c.onHand}</Td>
                    <Td>{c.reserved}</Td>
                    <Td>{c.allocated}</Td>
                    <Td className="font-semibold">{c.available}</Td>
                    <Td className="text-[12px]">{c.reason ?? ""}</Td>
                    <Td>{canReserve && c.eligible ? <ReserveForm lotId={c.lotId} locationId={c.locationId} available={c.available} uom={c.baseUom} ttlDefault={ttl} idempotencyKey={randomUUID()} /> : null}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}

      {canSeeReservations && (
        <Card>
          <CardTitle>Active reservations</CardTitle>
          {reservations.length === 0 ? (
            <EmptyState title="No active reservations">Reserved stock is listed here until it is allocated, released or expires.</EmptyState>
          ) : (
            <Table head={["Number", "Lot", "Location", "Quantity", "For", "Expires", "By", ""]}>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono">{r.number}</Td>
                  <Td><Link href={`/inventory/${r.lotId}`} className="font-mono text-primary-text hover:underline">{r.lotNumber}</Link><div className="text-[12px] text-muted">{r.itemName}</div></Td>
                  <Td className="font-mono">{r.locationCode}</Td>
                  <Td>{Number(r.qtyBase).toLocaleString("en-PH")} {r.baseUom}</Td>
                  <Td>{r.demandReference} <Chip>{r.demandType.replace(/_/g, " ")}</Chip></Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(r.expiresAt)}</Td>
                  <Td>{r.createdBy}</Td>
                  <Td>{ctx.can("inventory.reservation.void") ? <CommandForm action={releaseReservationAction.bind(null, r.id)} label="Release" variant="ghost" reason={{ label: "Why release?" }} /> : null}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
