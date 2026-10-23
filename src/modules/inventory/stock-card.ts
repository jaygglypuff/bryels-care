import "server-only";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, products, stockMovements, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { isUuid } from "./lots";
import { documentHref } from "./movements";

export type StockCardLine = {
  movementId: string;
  postedAt: Date;
  number: string;
  movementType: string;
  fromCode: string | null;
  toCode: string | null;
  container: string | null;
  qtyIn: string | null;
  qtyOut: string | null;
  /** Transfers inside the lot's own locations move stock without changing the lot total. */
  qtyMoved: string | null;
  running: string;
  statusAtPosting: string | null;
  sourceDocumentType: string | null;
  sourceDocumentNumber: string | null;
  sourceHref: string | null;
  postedBy: string;
  reason: string | null;
  /** "reversal of …" / "reversed by …" marker. */
  reversalOf: string | null;
  reversedBy: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Start of a Manila business day as an instant. */
const dayStart = (d: string) => new Date(`${d}T00:00:00+08:00`);
const addDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

const fromLoc = alias(locations, "from_loc");
const toLoc = alias(locations, "to_loc");

/**
 * Stock card for one lot (FR-documents-09, A-RPT-16): opening balance from the ledger, every
 * movement of the range with in/out and running balance, status at posting, source document,
 * poster, reason and reversal marker, and a closing line compared with the projection. With a
 * location, the card is for that location only (transfers then count as in or out).
 */
export async function getStockCard(ctx: AuthContext, f: { lotId: string; from: string; to: string; locationId?: string | null }) {
  ctx.require("inventory.movement.view");
  if (!isUuid(f.lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  if (!DATE_RE.test(f.from) || !DATE_RE.test(f.to)) throw new DomainError("validation", "Dates must be YYYY-MM-DD.", { field: "from" });
  if (f.from > f.to) throw new DomainError("validation", "The start date must not be after the end date.", { field: "from" });
  const [lot] = await db
    .select({
      lot: inventoryLots,
      itemCode: sql<string>`coalesce(${materials.code}, ${products.skuCode})`,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(eq(inventoryLots.id, f.lotId), eq(inventoryLots.organizationId, ctx.organizationId), inArray(inventoryLots.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!lot) throw new DomainError("not_found", "Lot not found in your sites.");
  ctx.requireSite(lot.lot.siteId);
  let location: { id: string; code: string; name: string } | null = null;
  if (f.locationId) {
    if (!isUuid(f.locationId)) throw new DomainError("not_found", "Location not found in your sites.");
    const [l] = await db.select({ id: locations.id, code: locations.code, name: locations.name }).from(locations).where(and(eq(locations.id, f.locationId), eq(locations.siteId, lot.lot.siteId))).limit(1);
    if (!l) throw new DomainError("not_found", "Location not found in your sites.");
    location = l;
  }

  const start = dayStart(f.from);
  const end = dayStart(addDay(f.to));
  const deltaSql = location
    ? sql`case when ${stockMovements.toLocationId} = ${location.id} then ${stockMovements.qtyBase} else 0 end - case when ${stockMovements.fromLocationId} = ${location.id} then ${stockMovements.qtyBase} else 0 end`
    : sql`case when ${stockMovements.toLocationId} is not null then ${stockMovements.qtyBase} else 0 end - case when ${stockMovements.fromLocationId} is not null then ${stockMovements.qtyBase} else 0 end`;
  const [{ opening, ledgerNow }] = await db
    .select({
      opening: sql<string>`coalesce(sum(${deltaSql}) filter (where ${stockMovements.postedAt} < ${start.toISOString()}::timestamptz), 0)::text`,
      ledgerNow: sql<string>`coalesce(sum(${deltaSql}), 0)::text`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.lotId, lot.lot.id));

  const rows = await db
    .select({ m: stockMovements, fromCode: fromLoc.code, toCode: toLoc.code, postedBy: users.displayName })
    .from(stockMovements)
    .leftJoin(fromLoc, eq(fromLoc.id, stockMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, stockMovements.toLocationId))
    .innerJoin(users, eq(users.id, stockMovements.postedBy))
    .where(and(eq(stockMovements.lotId, lot.lot.id), gte(stockMovements.postedAt, start), lt(stockMovements.postedAt, end)))
    .orderBy(asc(stockMovements.postedAt), asc(stockMovements.id));

  // Reversal markers in both directions (the reversing row may fall outside the range).
  const ids = rows.map((r) => r.m.id);
  const reversers = ids.length
    ? await db.select({ id: stockMovements.id, reversalOfId: stockMovements.reversalOfId, postedAt: stockMovements.postedAt }).from(stockMovements).where(inArray(stockMovements.reversalOfId, ids))
    : [];
  const ref = (m: { id: string; sourceDocumentNumber: string | null }) => m.sourceDocumentNumber ?? m.id.slice(0, 8);
  const reversedOriginals = rows.filter((r) => r.m.reversalOfId).map((r) => r.m.reversalOfId!);
  const originals = reversedOriginals.length
    ? await db.select({ id: stockMovements.id, sourceDocumentNumber: stockMovements.sourceDocumentNumber, movementType: stockMovements.movementType }).from(stockMovements).where(inArray(stockMovements.id, reversedOriginals))
    : [];

  let running = new Decimal(opening);
  const lines: StockCardLine[] = rows
    .filter((r) => !location || r.m.fromLocationId === location.id || r.m.toLocationId === location.id)
    .map((r) => {
      const m = r.m;
      const qty = new Decimal(m.qtyBase);
      let qtyIn: Decimal | null = null;
      let qtyOut: Decimal | null = null;
      let moved: Decimal | null = null;
      if (location) {
        if (m.toLocationId === location.id) qtyIn = qty;
        if (m.fromLocationId === location.id) qtyOut = qty;
      } else if (m.fromLocationId && m.toLocationId) moved = qty;
      else if (m.toLocationId) qtyIn = qty;
      else qtyOut = qty;
      running = running.plus(qtyIn ?? 0).minus(qtyOut ?? 0);
      const orig = m.reversalOfId ? originals.find((o) => o.id === m.reversalOfId) : null;
      const rev = reversers.find((x) => x.reversalOfId === m.id);
      return {
        movementId: m.id,
        postedAt: m.postedAt,
        number: ref(m),
        movementType: m.movementType,
        fromCode: r.fromCode,
        toCode: r.toCode,
        container: null,
        qtyIn: qtyIn?.toString() ?? null,
        qtyOut: qtyOut?.toString() ?? null,
        qtyMoved: moved?.toString() ?? null,
        running: running.toString(),
        statusAtPosting: m.qualityStatusAtPosting,
        sourceDocumentType: m.sourceDocumentType,
        sourceDocumentNumber: m.sourceDocumentNumber,
        sourceHref: documentHref(m),
        postedBy: r.postedBy,
        reason: m.reason,
        reversalOf: orig ? `${orig.movementType} ${ref(orig)}` : m.reversalOfId ? m.reversalOfId.slice(0, 8) : null,
        reversedBy: rev ? rev.id.slice(0, 8) : null,
      };
    });

  const projRows = await db
    .select({ qty: sql<string>`coalesce(sum(${inventoryBalances.qtyBase}), 0)::text` })
    .from(inventoryBalances)
    .where(location ? and(eq(inventoryBalances.lotId, lot.lot.id), eq(inventoryBalances.locationId, location.id)) : eq(inventoryBalances.lotId, lot.lot.id));
  const projection = new Decimal(projRows[0]?.qty ?? 0);
  const ledger = new Decimal(ledgerNow);
  const difference = projection.minus(ledger);
  return {
    lot: { ...lot.lot, itemCode: lot.itemCode, itemName: lot.itemName },
    location,
    from: f.from,
    to: f.to,
    opening: new Decimal(opening).toString(),
    lines,
    closing: running.toString(),
    /** Compares the whole ledger with the projection now (A-RPT-16); any difference is flagged on the card. */
    check: { ledgerNow: ledger.toString(), projection: projection.toString(), difference: difference.toString(), flagged: !difference.isZero() },
  };
}

export type StockCard = Awaited<ReturnType<typeof getStockCard>>;
