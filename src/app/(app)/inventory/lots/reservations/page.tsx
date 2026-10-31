import Link from "next/link";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDateTime } from "@/lib/qty";
import { DomainError } from "@/lib/errors";
import { getInventorySetting } from "@/modules/inventory/policy";
import { expireReservations, itemKeyOfLot, listReservations, recommendLots, recommendableItems } from "@/modules/inventory/reservations";
import { EmptyState, Input, PageHeader, Select, buttonClass } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Banner } from "@/ui/status";
import { Expiry, LOCATION_KIND_WORDS, LotStatusChip, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { releaseReservationAction } from "./actions";
import { ReserveForm } from "./reserve-form";

export const metadata = { title: "Which one to use first / set aside" };

type SP = { item?: string; customer?: string; qty?: string; lot?: string };

/** The server's reason a lot is not proposed, in plain words (the codes and rule names stay on the server). */
function plainReason(r: string | null): string | null {
  if (!r) return null;
  if (r.startsWith("Quarantined")) return "Waiting for QA check";
  if (r === "On QA hold") return "Stopped by QA";
  if (r.startsWith("Expired")) return "Expired";
  const loc = r.match(/^In a (\w+) location$/);
  if (loc) return `In the ${(LOCATION_KIND_WORDS[loc[1]] ?? loc[1]).toLowerCase()} area, not on a shelf`;
  const days = r.match(/^Only (-?\d+) days of shelf life left; minimum (\d+)$/);
  if (days) return `Only ${days[1]} days before it expires; needs at least ${days[2]}`;
  if (r === "Fully reserved or allocated") return "All of it is already set aside";
  return r;
}

/**
 * Which one to use first / set aside (US-2-20), grade-5 (ADR-088). The FEFO/FIFO rule is hidden: the list
 * is simply in the order to use, the first one marked "Use this first". Setting stock aside keeps it for a
 * demand and lowers what "can we deliver?" shows.
 */
export default async function ReservationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="which stock to use first" />;
  const sp = await searchParams;
  const items = await recommendableItems(ctx);
  // ?lot=<id> (from the lot page) preselects the lot's item.
  let item = sp.item ?? "";
  if (!item && sp.lot) item = (await itemKeyOfLot(ctx, sp.lot)) ?? "";
  const [kind, itemId] = item.split(":");
  let rec: Awaited<ReturnType<typeof recommendLots>> | null = null;
  let recError: string | null = null;
  if (itemId) {
    try {
      rec = await recommendLots(ctx, { materialId: kind === "m" ? itemId : null, productId: kind === "p" ? itemId : null, customerId: sp.customer || null, qty: /^\d{1,12}(\.\d{1,6})?$/.test(sp.qty ?? "") ? sp.qty : null });
    } catch (e) {
      recError = e instanceof DomainError ? e.message : "The list could not be made. Try again.";
    }
  }
  const itemName = kind === "m" ? items.materials.find((m) => m.id === itemId)?.name : items.products.find((p) => p.id === itemId)?.name;
  const canReserve = ctx.can("inventory.reservation.create");
  const canSeeReservations = ctx.can("inventory.reservation.view");
  if (canSeeReservations) await expireReservations(db, ctx.currentSiteId);
  const reservations = canSeeReservations ? await listReservations(ctx, { status: "active" }) : [];
  const ttl = await getInventorySetting(db, ctx.organizationId, ctx.currentSiteId, "inventory.reservation.ttl_hours");
  const uom = rec?.candidates[0]?.baseUom ?? "";
  const byName = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <PageHeader title={canSeeReservations ? "Which one to use first / set aside" : "Which one to use first"} subtitle={ctx.currentSite.name} />
      <PageIntro>
        This screen is for choosing which lot to take next (the one that expires first comes first) and, if you may, setting stock aside for an order or a batch so nobody else takes it.
      </PageIntro>

      <form method="get" className="grid grid-cols-1 gap-3 rounded-[20px] bg-surface p-4 shadow-[var(--shadow-card)] sm:grid-cols-[2fr_1fr_auto] sm:items-end" role="search">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="item" className="text-[14px] font-medium">What do you need?</label>
          <Select id="item" name="item" defaultValue={item}>
            <option value="">Choose…</option>
            <optgroup label="Raw materials and packaging">{byName(items.materials).map((m) => <option key={m.id} value={`m:${m.id}`}>{m.name}</option>)}</optgroup>
            <optgroup label="Finished goods">{byName(items.products).map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="qty" className="text-[14px] font-medium">How much? {uom && <span className="font-normal text-muted">({uom})</span>}</label>
          <Input id="qty" name="qty" inputMode="decimal" defaultValue={sp.qty ?? ""} placeholder="Leave empty to see all" />
        </div>
        <button type="submit" className={buttonClass("cta")}>Show the order to use</button>
        <div className="sm:col-span-3">
          <MoreDetails title="For a customer? (you can skip this)" open={!!sp.customer}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customer" className="text-[14px] font-medium">Customer</label>
              <Select id="customer" name="customer" defaultValue={sp.customer ?? ""}>
                <option value="">Any customer</option>
                {byName(items.customers).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <p className="text-[13px] text-muted">Some customers need stock with a long time left before it expires. Choosing them hides lots that expire too soon.</p>
            </div>
          </MoreDetails>
        </div>
      </form>

      {recError && <Banner tone="bad" title="No list">{recError}</Banner>}
      {rec && (
        <section className="space-y-2" aria-label="Order to use">
          <h2 className="text-[16px] font-semibold">{itemName ?? "This item"}: take them in this order</h2>
          {rec.minShelfLifeDays ? <p className="text-[13px] text-muted">Only lots with at least {rec.minShelfLifeDays} days before they expire.</p> : null}
          {rec.picks.length > 0 && (
            <Banner tone="ok" title="Use these first">
              {rec.picks.map((p) => `${fmtLotQty(p.qty, uom)} from lot ${p.lotNumber} on ${p.locationCode}`).join("; ")}
              {rec.shortfall ? `. Not enough: ${fmtLotQty(rec.shortfall, uom)} short.` : "."}
            </Banner>
          )}
          {rec.candidates.length === 0 ? (
            <EmptyState title={`No ${itemName ?? "stock of this item"} at ${ctx.currentSite.name}`}>Receive it first, or ask purchasing to order it.</EmptyState>
          ) : (
            <ol className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
              {rec.candidates.map((c) => (
                <li key={`${c.lotId}-${c.locationId}`} className={c.eligible ? "px-4 py-3" : "px-4 py-3 opacity-75"} data-testid="fefo-row">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                        {c.eligible && c.rank === 1 ? <span className="rounded-full bg-cta px-2 py-0.5 text-[12px] text-white">Use this first</span> : c.rank ? <span className="text-muted">{c.rank}.</span> : null}
                        <Link href={`/inventory/${c.lotId}`} className="inline-flex min-h-[44px] items-center text-primary-text hover:underline">On {c.locationCode}</Link>
                        <LotStatusChip status={c.qualityStatus} expiresOn={c.expiresOn} />
                      </p>
                      <p className="mt-0.5 text-[13px] text-fg-2">
                        <Expiry date={c.expiresOn} compact /> <span className="ml-1 font-mono text-[12px] text-muted">· {c.lotNumber}</span>
                      </p>
                      {!c.eligible && <p className="mt-0.5 text-[13px] text-[var(--warn-fg)]">Not this one: {plainReason(c.reason)}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular text-[15px]">{c.eligible ? fmtLotQty(c.available, c.baseUom) : fmtLotQty(c.onHand, c.baseUom)}</p>
                      <p className="text-[12px] text-muted">{c.eligible ? "free to use" : "not usable"}</p>
                    </div>
                  </div>
                  {c.eligible && (!D(c.reserved).isZero() || !D(c.allocated).isZero()) && (
                    <p className="mt-0.5 text-[12px] tabular text-muted">
                      In stock {fmtLotQty(c.onHand, c.baseUom)} · set aside {fmtLotQty(c.reserved, c.baseUom)} · for orders {fmtLotQty(c.allocated, c.baseUom)}
                    </p>
                  )}
                  {canReserve && c.eligible && (
                    <div className="mt-2">
                      <ReserveForm lotId={c.lotId} locationId={c.locationId} available={c.available} uom={c.baseUom} ttlDefault={ttl} idempotencyKey={randomUUID()} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {canSeeReservations && (
        <section className="space-y-2">
          <h2 className="text-[16px] font-semibold">Set aside now · {reservations.length}</h2>
          {reservations.length === 0 ? (
            <EmptyState title="Nothing is set aside">Choose an item above and tap “Set aside” on a lot. It stays here until it is used, let go, or the time runs out.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" aria-label="Stock set aside">
              {reservations.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">
                      <Link href={`/inventory/${r.lotId}`} className="hover:underline">{r.itemName}</Link> <span className="font-normal text-fg-2">for {r.demandReference}</span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-fg-2">
                      On {r.locationCode} · by {r.createdBy} · until {fmtDateTime(r.expiresAt)}
                      <span className="ml-1 font-mono text-[12px] text-muted">· {r.lotNumber} · {r.number}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="font-semibold tabular text-[15px]">{fmtLotQty(r.qtyBase, r.baseUom)}</span>
                    {ctx.can("inventory.reservation.void") ? <CommandForm action={releaseReservationAction.bind(null, r.id)} label="Let it go" variant="secondary" reason={{ label: "Why let it go?", placeholder: "e.g. The batch was moved to next week" }} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
