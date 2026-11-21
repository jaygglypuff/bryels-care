import "server-only";
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx } from "@/db/client";
import { containerContents, containers, customers, inventoryLots, locations, products, shelfChecks, stockAdjustments, stockTakeoutLines, stockTakeouts, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { getSetting } from "@/lib/settings";
import { isUuid } from "./lots";
import { takeoutCandidates, takeoutChannels } from "./takeouts";
import { type Channel, daysSince, purposeSentence, STATUS_WORDS, type TakeoutStatus, undoRefusal } from "./takeout-rules";

/** ADR-138: the read side of "Take a few out" (form data, the Taken out list and report, detail, trace, Home, reminders). */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const manilaDay = (d: Date = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const dayStart = (d: string) => new Date(`${d}T00:00:00+08:00`);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export type TakeoutProductOption = { productId: string; name: string; sku: string; free: string; uom: string; where: string };

/** What the phone needs: products with free pieces here (in the order to use them), shops, customers, shelves, limits. */
export async function takeoutFormData(ctx: AuthContext) {
  ctx.require("inventory.takeout.create");
  ctx.requireSite(ctx.currentSiteId);
  const prods = await db
    .selectDistinct({ id: products.id, name: products.name, sku: products.skuCode, uom: products.baseUom })
    .from(inventoryLots)
    .innerJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(eq(inventoryLots.siteId, ctx.currentSiteId), eq(inventoryLots.qualityStatus, "released"), sql`exists (select 1 from inventory_balances b where b.lot_id = ${inventoryLots.id} and b.qty_base > 0)`));
  const options: (TakeoutProductOption & { firstPlace: string })[] = [];
  for (const p of prods.sort((a, b) => a.name.localeCompare(b.name))) {
    const c = await takeoutCandidates(db, ctx, p.id);
    if (!c.length) continue;
    const free = c.reduce((s, x) => s.plus(x.free), new Decimal(0));
    const first = c[0];
    options.push({ productId: p.id, name: p.name, sku: p.sku, free: free.toString(), uom: p.uom, where: `${first.boxNumber ? `box ${first.boxNumber}${first.boxStatus === "open" ? " (open)" : ""} on ` : "loose on "}${first.locationCode}`, firstPlace: first.locationCode });
  }
  const [channels, maxLine, maxDay, shelves] = await Promise.all([
    takeoutChannels(db, ctx.organizationId),
    getSetting(db, ctx.organizationId, "inventory.takeout.max_pieces_per_line", ctx.currentSiteId),
    getSetting(db, ctx.organizationId, "inventory.takeout.max_pieces_per_person_day", ctx.currentSiteId),
    db.select({ id: locations.id, code: locations.code, name: locations.name }).from(locations).where(and(eq(locations.siteId, ctx.currentSiteId), eq(locations.takeoutShelf, true), eq(locations.isActive, true))).orderBy(asc(locations.code)),
  ]);
  const custs = ctx.can("masterdata.customer.view")
    ? await db.select({ id: customers.id, name: customers.name, code: customers.code }).from(customers).where(and(eq(customers.organizationId, ctx.organizationId), sql`coalesce(${customers.status}, 'active') = 'active'`)).orderBy(asc(customers.name)).limit(500)
    : [];
  return { products: options, channels, customers: custs, shelves, limits: { perLine: maxLine, perPersonDay: maxDay } };
}

export type SourceView = { key: string; productId: string; productName: string; lotId: string; lotNumber: string; expiresOn: string | null; locationId: string; locationCode: string; shopShelf: boolean; containerId: string | null; boxNumber: string | null; boxStatus: string | null; free: string; uom: string };

/** Where a product's pieces can come from, in the order to use them (the phone's "Take from" list). */
export async function takeoutSourcesFor(ctx: AuthContext, productId: string): Promise<SourceView[]> {
  ctx.require("inventory.takeout.create");
  if (!isUuid(productId)) throw new DomainError("not_found", "Product not found.");
  const [p] = await db.select().from(products).where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId))).limit(1);
  if (!p) throw new DomainError("not_found", "Product not found.");
  return (await takeoutCandidates(db, ctx, p.id)).map((c) => ({ ...c, key: `${c.lotId}|${c.locationId}|${c.containerId ?? "loose"}`, productId: p.id, productName: p.name, shopShelf: c.shopShelf, uom: p.baseUom }));
}

/**
 * A scanned or typed box or lot label (BC:BOX:/BC:LOT: or the printed number) → the sources it stands for at the
 * current site: a box gives itself; a lot gives its free boxes and loose pieces. Refusals in plain words.
 */
export async function takeoutSourcesForLabel(ctx: AuthContext, raw: string): Promise<{ ok: true; sources: SourceView[] } | { ok: false; message: string }> {
  ctx.require("inventory.takeout.create");
  const code = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().toUpperCase().slice(0, 100);
  if (!code) return { ok: false, message: "Scan a box or lot label, or type its number." };
  const boxNo = code.replace(/^BC:BOX:/, "");
  const [box] = await db
    .select({ id: containers.id, siteId: containers.siteId, status: containers.status, number: containers.containerNumber })
    .from(containers)
    .where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, boxNo), inArray(containers.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (box) {
    if (box.siteId !== ctx.currentSiteId) return { ok: false, message: `Box ${box.number} is at another site. Switch to that site first.` };
    const [c] = await db.select({ lotId: containerContents.lotId, productId: inventoryLots.productId }).from(containerContents).innerJoin(inventoryLots, eq(inventoryLots.id, containerContents.lotId)).where(and(eq(containerContents.containerId, box.id), gt(containerContents.qtyBase, "0"))).limit(1);
    if (!c) return { ok: false, message: `Box ${box.number} is empty.` };
    if (!c.productId) return { ok: false, message: `Box ${box.number} holds a material, not a finished product.` };
    const all = await takeoutSourcesFor(ctx, c.productId);
    const mine = all.filter((s) => s.containerId === box.id);
    if (!mine.length) return { ok: false, message: await whyNot(box.id, box.number) };
    return { ok: true, sources: mine };
  }
  const lotNo = code.replace(/^BC:LOT:/, "");
  const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, lotNo), inArray(inventoryLots.siteId, ctx.allowedSiteIds))).limit(1);
  if (!lot) return { ok: false, message: `Nothing matches ${lotNo}. Scan the label again, or choose the product.` };
  if (lot.siteId !== ctx.currentSiteId) return { ok: false, message: `Lot ${lot.lotNumber} is at another site.` };
  if (!lot.productId) return { ok: false, message: `Lot ${lot.lotNumber} is a material, not a finished product.` };
  if (lot.qualityStatus !== "released") return { ok: false, message: `Lot ${lot.lotNumber} is ${({ quarantine: "waiting for the QA check", on_hold: "stopped by QA", rejected: "rejected", expired: "expired", recalled: "recalled" } as Record<string, string>)[lot.qualityStatus] ?? lot.qualityStatus}. Its pieces cannot go out.` };
  if (lot.expiresOn && lot.expiresOn < manilaDay()) return { ok: false, message: `Lot ${lot.lotNumber} expired. Its pieces cannot go out.` };
  const mine = (await takeoutSourcesFor(ctx, lot.productId)).filter((s) => s.lotId === lot.id);
  if (!mine.length) return { ok: false, message: `No free pieces of lot ${lot.lotNumber} on a finished goods shelf here (it may be set aside for an order).` };
  return { ok: true, sources: mine };
}

async function whyNot(boxId: string, number: string): Promise<string> {
  const [b] = await db.select({ status: containers.status, kind: locations.kind, code: locations.code, q: inventoryLots.qualityStatus, exp: inventoryLots.expiresOn }).from(containers).leftJoin(locations, eq(locations.id, containers.currentLocationId)).leftJoin(containerContents, eq(containerContents.containerId, containers.id)).leftJoin(inventoryLots, eq(inventoryLots.id, containerContents.lotId)).where(eq(containers.id, boxId)).limit(1);
  if (!b) return `Box ${number} cannot be used.`;
  if (!["open", "sealed"].includes(b.status)) return `Box ${number} is ${b.status === "shipped" ? "sent out" : b.status}.`;
  if (b.q && b.q !== "released") return `Box ${number} is not released by QA. Its pieces cannot go out.`;
  if (b.exp && b.exp < manilaDay()) return `Box ${number} is expired. Its pieces cannot go out.`;
  if (b.kind && b.kind !== "storage") return `Box ${number} is in ${b.code}, not on a finished goods shelf (a box in the sending-out bay is for a customer order).`;
  return `Box ${number} is set aside for a customer order. Take the pieces from another box.`;
}

export type TakeoutFilter = { from?: string; to?: string; purpose?: string; channel?: string; productId?: string; personId?: string; status?: string; q?: string };

export type TakeoutLineRow = {
  takeoutId: string;
  takeoutNumber: string;
  day: string;
  at: Date;
  status: TakeoutStatus;
  purpose: string;
  channel: string | null;
  channelLabel: string | null;
  platformOrderRef: string | null;
  customerId: string | null;
  customerName: string | null;
  recipientName: string | null;
  note: string | null;
  sentence: string;
  personId: string;
  personName: string;
  lineNo: number;
  productId: string;
  productName: string;
  sku: string;
  lotId: string;
  lotNumber: string;
  placeCode: string;
  boxNumber: string | null;
  pieces: string;
  uom: string;
};

function normFilter(f: TakeoutFilter) {
  const to = f.to && DATE.test(f.to) ? f.to : manilaDay();
  const from = f.from && DATE.test(f.from) ? f.from : addDays(to, -6);
  if (from > to) throw new DomainError("validation", "The first day must not be after the last day.", { field: "from" });
  return { ...f, from, to };
}

/** Line rows of the Taken out list (current site, a date range, filters). Undone and refused entries are included with their state. */
export async function takeoutLineRows(ctx: AuthContext, f0: TakeoutFilter = {}, limit = 2000): Promise<TakeoutLineRow[]> {
  ctx.require("inventory.takeout.view");
  ctx.requireSite(ctx.currentSiteId);
  const f = normFilter(f0);
  const conds: SQL[] = [eq(stockTakeouts.organizationId, ctx.organizationId), eq(stockTakeouts.siteId, ctx.currentSiteId), sql`${stockTakeouts.createdAt} >= ${dayStart(f.from).toISOString()}::timestamptz`, sql`${stockTakeouts.createdAt} < ${dayStart(addDays(f.to, 1)).toISOString()}::timestamptz`];
  if (f.purpose) conds.push(eq(stockTakeouts.purpose, f.purpose));
  if (f.channel) conds.push(eq(stockTakeouts.channel, f.channel));
  if (f.status) conds.push(eq(stockTakeouts.status, f.status));
  if (f.personId && isUuid(f.personId)) conds.push(eq(stockTakeouts.createdBy, f.personId));
  if (f.productId && isUuid(f.productId)) conds.push(eq(stockTakeoutLines.productId, f.productId));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    conds.push(sql`(${stockTakeouts.takeoutNumber} ilike ${like} or ${products.name} ilike ${like} or ${inventoryLots.lotNumber} ilike ${like} or coalesce(${stockTakeouts.platformOrderRef}, '') ilike ${like} or coalesce(${customers.name}, ${stockTakeouts.recipientName}, '') ilike ${like})`);
  }
  const rows = await db
    .select({ t: stockTakeouts, l: stockTakeoutLines, person: users.displayName, productName: products.name, sku: products.skuCode, lotNumber: inventoryLots.lotNumber, placeCode: locations.code, boxNumber: containers.containerNumber, customerName: customers.name })
    .from(stockTakeoutLines)
    .innerJoin(stockTakeouts, eq(stockTakeouts.id, stockTakeoutLines.takeoutId))
    .innerJoin(users, eq(users.id, stockTakeouts.createdBy))
    .innerJoin(products, eq(products.id, stockTakeoutLines.productId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockTakeoutLines.lotId))
    .innerJoin(locations, eq(locations.id, stockTakeoutLines.locationId))
    .leftJoin(containers, eq(containers.id, stockTakeoutLines.containerId))
    .leftJoin(customers, eq(customers.id, stockTakeouts.customerId))
    .where(and(...conds))
    .orderBy(desc(stockTakeouts.createdAt), asc(stockTakeoutLines.lineNo))
    .limit(limit);
  const channels = await takeoutChannels(db, ctx.organizationId);
  return rows.map((r) => toLineRow(r, channels));
}

function toLineRow(r: { t: typeof stockTakeouts.$inferSelect; l: typeof stockTakeoutLines.$inferSelect; person: string; productName: string; sku: string; lotNumber: string; placeCode: string; boxNumber: string | null; customerName: string | null }, channels: Channel[]): TakeoutLineRow {
  return {
    takeoutId: r.t.id,
    takeoutNumber: r.t.takeoutNumber,
    day: manilaDay(r.t.createdAt),
    at: r.t.createdAt,
    status: r.t.status as TakeoutStatus,
    purpose: r.t.purpose,
    channel: r.t.channel,
    channelLabel: r.t.channel ? (channels.find((c) => c.code === r.t.channel)?.label ?? r.t.channel) : null,
    platformOrderRef: r.t.platformOrderRef,
    customerId: r.t.customerId,
    customerName: r.customerName,
    recipientName: r.t.recipientName,
    note: r.t.note,
    sentence: purposeSentence({ ...r.t, customerName: r.customerName }, channels),
    personId: r.t.createdBy,
    personName: r.person,
    lineNo: r.l.lineNo,
    productId: r.l.productId,
    productName: r.productName,
    sku: r.sku,
    lotId: r.l.lotId,
    lotNumber: r.lotNumber,
    placeCode: r.placeCode,
    boxNumber: r.boxNumber,
    pieces: new Decimal(r.l.qtyBase).toString(),
    uom: r.l.baseUom,
  };
}

export type TakeoutListEntry = { id: string; number: string; day: string; at: Date; status: TakeoutStatus; statusWord: string; sentence: string; purpose: string; personName: string; products: string; pieces: string };
export type TakeoutTotals = { label: string; pieces: string; entries: number }[];

/** The Taken out list: one row per entry, and totals (posted only) by day, product, reason/shop and person. */
export async function listTakeouts(ctx: AuthContext, f0: TakeoutFilter = {}) {
  const f = normFilter(f0);
  const lines = await takeoutLineRows(ctx, f);
  const byEntry = new Map<string, TakeoutListEntry>();
  for (const l of lines) {
    const e = byEntry.get(l.takeoutId);
    if (!e) byEntry.set(l.takeoutId, { id: l.takeoutId, number: l.takeoutNumber, day: l.day, at: l.at, status: l.status, statusWord: STATUS_WORDS[l.status], sentence: l.sentence, purpose: l.purpose, personName: l.personName, products: `${l.pieces} ${l.productName}`, pieces: l.pieces });
    else {
      e.pieces = new Decimal(e.pieces).plus(l.pieces).toString();
      if (!e.products.includes(l.productName)) e.products += `, ${l.pieces} ${l.productName}`;
    }
  }
  const posted = lines.filter((l) => l.status === "posted");
  const group = (key: (l: TakeoutLineRow) => string): TakeoutTotals => {
    const m = new Map<string, { pieces: Decimal; ids: Set<string> }>();
    for (const l of posted) {
      const k = key(l);
      const cur = m.get(k) ?? { pieces: new Decimal(0), ids: new Set<string>() };
      cur.pieces = cur.pieces.plus(l.pieces);
      cur.ids.add(l.takeoutId);
      m.set(k, cur);
    }
    return [...m.entries()].map(([label, v]) => ({ label, pieces: v.pieces.toString(), entries: v.ids.size })).sort((a, b) => new Decimal(b.pieces).cmp(a.pieces) || a.label.localeCompare(b.label));
  };
  const reasonLabel = (l: TakeoutLineRow) => (l.purpose === "sold_online" ? `Sold online · ${l.channelLabel ?? "?"}` : l.sentence.split(" for ")[0].replace(/^Other:.*/, "Other"));
  return {
    filter: f,
    entries: [...byEntry.values()],
    totals: {
      pieces: posted.reduce((s, l) => s.plus(l.pieces), new Decimal(0)).toString(),
      byDay: group((l) => l.day).sort((a, b) => b.label.localeCompare(a.label)),
      byProduct: group((l) => l.productName),
      byReason: group(reasonLabel),
      byPerson: group((l) => l.personName),
    },
    counts: { all: byEntry.size, waiting: [...byEntry.values()].filter((e) => e.status === "awaiting_approval").length },
    people: [...new Map(lines.map((l) => [l.personId, l.personName])).entries()].map(([id, name]) => ({ id, name })),
  };
}

/** One take-out with its lines, names and what the viewer may do now. */
export async function getTakeout(ctx: AuthContext, id: string) {
  if (!ctx.can("inventory.takeout.view") && !ctx.can("inventory.takeout.create")) ctx.require("inventory.takeout.view");
  if (!isUuid(id)) throw new DomainError("not_found", "Take-out not found in your sites.");
  const [t] = await db.select().from(stockTakeouts).where(and(eq(stockTakeouts.id, id), eq(stockTakeouts.organizationId, ctx.organizationId), inArray(stockTakeouts.siteId, ctx.allowedSiteIds))).limit(1);
  if (!t) throw new DomainError("not_found", "Take-out not found in your sites.");
  ctx.requireSite(t.siteId);
  // People who may only record take-outs see their own; viewers see all.
  if (!ctx.can("inventory.takeout.view") && t.createdBy !== ctx.userId) throw new DomainError("not_found", "Take-out not found in your sites.");
  const channels = await takeoutChannels(db, ctx.organizationId);
  const rows = await db
    .select({ t: stockTakeouts, l: stockTakeoutLines, person: users.displayName, productName: products.name, sku: products.skuCode, lotNumber: inventoryLots.lotNumber, placeCode: locations.code, boxNumber: containers.containerNumber, customerName: customers.name })
    .from(stockTakeoutLines)
    .innerJoin(stockTakeouts, eq(stockTakeouts.id, stockTakeoutLines.takeoutId))
    .innerJoin(users, eq(users.id, stockTakeouts.createdBy))
    .innerJoin(products, eq(products.id, stockTakeoutLines.productId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockTakeoutLines.lotId))
    .innerJoin(locations, eq(locations.id, stockTakeoutLines.locationId))
    .leftJoin(containers, eq(containers.id, stockTakeoutLines.containerId))
    .leftJoin(customers, eq(customers.id, stockTakeouts.customerId))
    .where(eq(stockTakeoutLines.takeoutId, t.id))
    .orderBy(asc(stockTakeoutLines.lineNo));
  const lines = rows.map((r) => ({ ...toLineRow(r, channels), openedBox: r.l.openedBox, containerId: r.l.containerId, movementId: r.l.stockMovementId, reversalId: r.l.reversalMovementId }));
  const names = new Map((await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [t.createdBy, t.postedBy, t.approvedBy, t.rejectedBy, t.reversedBy, t.cancelledBy].filter((x): x is string => !!x)))).map((u) => [u.id, u.name]));
  const n = (u: string | null) => (u ? (names.get(u) ?? null) : null);
  const undoWhy = t.status === "posted" ? undoRefusal({ createdBy: t.createdBy, postedAt: t.postedAt, userId: ctx.userId, canVoid: ctx.canAt("inventory.takeout.void", t.siteId) }) : "Only a take-out that went out can be undone.";
  return {
    ...t,
    totalPieces: new Decimal(t.totalPieces).toString(),
    statusWord: STATUS_WORDS[t.status as TakeoutStatus],
    sentence: lines[0]?.sentence ?? purposeSentence(t, channels),
    customerName: rows[0]?.customerName ?? null,
    channelLabel: lines[0]?.channelLabel ?? null,
    createdByName: n(t.createdBy),
    postedByName: n(t.postedBy),
    approvedByName: n(t.approvedBy),
    rejectedByName: n(t.rejectedBy),
    reversedByName: n(t.reversedBy),
    cancelledByName: n(t.cancelledBy),
    lines,
    can: {
      undo: ctx.can("inventory.takeout.create") && !undoWhy,
      undoWhy,
      cancel: t.status === "awaiting_approval" && (t.createdBy === ctx.userId || ctx.canAt("inventory.takeout.approve", t.siteId)),
      decide: t.status === "awaiting_approval" && ctx.canAt("inventory.takeout.approve", t.siteId) && !ctx.sodConflictAt(t.createdBy, t.siteId),
    },
  };
}
export type TakeoutDetail = Awaited<ReturnType<typeof getTakeout>>;

/** Take-outs of one lot (lot page, trace): posted and undone, with reason, shop and sample customer. */
export async function lotTakeouts(ctx: AuthContext, lotId: string, q: DbOrTx = db) {
  if (!ctx.can("inventory.takeout.view")) return [];
  if (!isUuid(lotId)) return [];
  const rows = await q
    .select({ t: stockTakeouts, l: stockTakeoutLines, person: users.displayName, productName: products.name, sku: products.skuCode, lotNumber: inventoryLots.lotNumber, placeCode: locations.code, boxNumber: containers.containerNumber, customerName: customers.name })
    .from(stockTakeoutLines)
    .innerJoin(stockTakeouts, eq(stockTakeouts.id, stockTakeoutLines.takeoutId))
    .innerJoin(users, eq(users.id, stockTakeouts.createdBy))
    .innerJoin(products, eq(products.id, stockTakeoutLines.productId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockTakeoutLines.lotId))
    .innerJoin(locations, eq(locations.id, stockTakeoutLines.locationId))
    .leftJoin(containers, eq(containers.id, stockTakeoutLines.containerId))
    .leftJoin(customers, eq(customers.id, stockTakeouts.customerId))
    .where(and(eq(stockTakeoutLines.lotId, lotId), eq(stockTakeouts.organizationId, ctx.organizationId), inArray(stockTakeouts.siteId, ctx.allowedSiteIds), inArray(stockTakeouts.status, ["posted", "reversed"])))
    .orderBy(desc(stockTakeouts.createdAt))
    .limit(200);
  const channels = await takeoutChannels(q, ctx.organizationId);
  return rows.map((r) => toLineRow(r, channels));
}

/** Free samples given to one customer (customer page), newest first; needs `inventory.takeout.view`. */
export async function customerSamples(ctx: AuthContext, customerId: string) {
  if (!ctx.can("inventory.takeout.view") || !isUuid(customerId)) return [];
  const rows = await db
    .select({ t: stockTakeouts, l: stockTakeoutLines, person: users.displayName, productName: products.name, sku: products.skuCode, lotNumber: inventoryLots.lotNumber, placeCode: locations.code, boxNumber: containers.containerNumber, customerName: customers.name })
    .from(stockTakeoutLines)
    .innerJoin(stockTakeouts, eq(stockTakeouts.id, stockTakeoutLines.takeoutId))
    .innerJoin(users, eq(users.id, stockTakeouts.createdBy))
    .innerJoin(products, eq(products.id, stockTakeoutLines.productId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockTakeoutLines.lotId))
    .innerJoin(locations, eq(locations.id, stockTakeoutLines.locationId))
    .leftJoin(containers, eq(containers.id, stockTakeoutLines.containerId))
    .leftJoin(customers, eq(customers.id, stockTakeouts.customerId))
    .where(and(eq(stockTakeouts.customerId, customerId), eq(stockTakeouts.organizationId, ctx.organizationId), inArray(stockTakeouts.siteId, ctx.allowedSiteIds), eq(stockTakeouts.status, "posted")))
    .orderBy(desc(stockTakeouts.createdAt))
    .limit(100);
  const channels = await takeoutChannels(db, ctx.organizationId);
  return rows.map((r) => toLineRow(r, channels));
}

export type WatchRow = {
  kind: "box" | "loose";
  containerId: string | null;
  boxNumber: string | null;
  lotId: string;
  lotNumber: string;
  productName: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  shopShelf: boolean;
  pieces: string;
  lastActivity: Date;
  lastCount: Date | null;
  days: number;
  stale: boolean;
};

/**
 * Places to keep an eye on (ADR-138 §3): every open box of finished goods on a shelf, and loose finished pieces on an
 * online shop shelf. `lastActivity` = the latest take-out, count or change of the box (for loose pieces: the latest
 * change of that stock or count); stale = nothing for `inventory.takeout.stale_days` days. Organisation-level for the
 * reminder job (`siteIds` given) or the viewer's site.
 */
export async function watchList(q: DbOrTx, organizationId: string, siteIds: string[], now: Date = new Date()): Promise<(WatchRow & { siteId: string })[]> {
  if (!siteIds.length) return [];
  const ids = sql.join(siteIds.map((s) => sql`${s}::uuid`), sql`, `);
  const rows = (await q.execute(sql`
    select 'box' as kind, c.site_id, c.id as container_id, c.container_number as box_number, l.id as lot_id, l.lot_number, p.name as product_name,
           loc.id as location_id, loc.code as location_code, loc.name as location_name, loc.takeout_shelf as shop_shelf, cc.qty_base::text as pieces,
           greatest(c.updated_at, coalesce((select max(sc.counted_at) from shelf_checks sc where sc.container_id = c.id), c.updated_at)) as last_activity,
           (select max(sc.counted_at) from shelf_checks sc where sc.container_id = c.id) as last_count
    from containers c
    join container_contents cc on cc.container_id = c.id and cc.qty_base > 0
    join inventory_lots l on l.id = cc.lot_id and l.item_kind = 'product' and l.quality_status = 'released'
    join products p on p.id = l.product_id
    join locations loc on loc.id = c.current_location_id and loc.kind = 'storage' and loc.is_active
    where c.organization_id = ${organizationId}::uuid and c.site_id in (${ids}) and c.status = 'open'
    union all
    select 'loose', b.site_id, null, null, l.id, l.lot_number, p.name, loc.id, loc.code, loc.name, true,
           (b.qty_base - coalesce((select sum(cc2.qty_base) from container_contents cc2 join containers c2 on c2.id = cc2.container_id
             where cc2.lot_id = b.lot_id and c2.current_location_id = b.location_id and c2.status in ('open', 'sealed')), 0))::text,
           greatest(b.updated_at, coalesce((select max(sc.counted_at) from shelf_checks sc where sc.location_id = b.location_id and sc.lot_id = b.lot_id and sc.container_id is null), b.updated_at)),
           (select max(sc.counted_at) from shelf_checks sc where sc.location_id = b.location_id and sc.lot_id = b.lot_id and sc.container_id is null)
    from inventory_balances b
    join inventory_lots l on l.id = b.lot_id and l.item_kind = 'product' and l.quality_status = 'released' and l.organization_id = ${organizationId}::uuid
    join products p on p.id = l.product_id
    join locations loc on loc.id = b.location_id and loc.takeout_shelf and loc.is_active
    where b.site_id in (${ids}) and b.qty_base > 0`)) as unknown as Record<string, unknown>[];
  const stale = new Map<string, number>();
  for (const s of siteIds) stale.set(s, await getSetting(q, organizationId, "inventory.takeout.stale_days", s));
  return rows
    .filter((r) => new Decimal(String(r.pieces)).gt(0))
    .map((r) => {
      const last = new Date(String(r.last_activity));
      const days = daysSince(last, now) ?? 0;
      return {
        siteId: String(r.site_id),
        kind: r.kind as "box" | "loose",
        containerId: (r.container_id as string | null) ?? null,
        boxNumber: (r.box_number as string | null) ?? null,
        lotId: String(r.lot_id),
        lotNumber: String(r.lot_number),
        productName: String(r.product_name),
        locationId: String(r.location_id),
        locationCode: String(r.location_code),
        locationName: String(r.location_name),
        shopShelf: r.shop_shelf === true || r.shop_shelf === "t",
        pieces: new Decimal(String(r.pieces)).toString(),
        lastActivity: last,
        lastCount: r.last_count ? new Date(String(r.last_count)) : null,
        days,
        stale: days >= (stale.get(String(r.site_id)) ?? 3),
      };
    })
    .sort((a, b) => Number(b.stale) - Number(a.stale) || Number(b.shopShelf) - Number(a.shopShelf) || a.lastActivity.getTime() - b.lastActivity.getTime());
}

/** Home card "Online shop shelf and open boxes" at the viewer's site. */
export async function shopShelfStatus(ctx: AuthContext) {
  if (!ctx.can("inventory.takeout.create") && !ctx.can("inventory.takeout.view")) return null;
  ctx.requireSite(ctx.currentSiteId);
  const rows = await watchList(db, ctx.organizationId, [ctx.currentSiteId]);
  const [today] = await db
    .select({ n: sql<number>`count(*)::int`, pieces: sql<string>`coalesce(sum(${stockTakeouts.totalPieces}), 0)::text` })
    .from(stockTakeouts)
    .where(and(eq(stockTakeouts.siteId, ctx.currentSiteId), eq(stockTakeouts.status, "posted"), sql`(${stockTakeouts.createdAt} at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date`));
  const staleDays = await getSetting(db, ctx.organizationId, "inventory.takeout.stale_days", ctx.currentSiteId);
  return { rows, stale: rows.filter((r) => r.stale), staleDays, today: { entries: today?.n ?? 0, pieces: new Decimal(today?.pieces ?? 0).toString() } };
}

/** Count history of a box (box page): the quick counts with their difference and stock fix. */
export async function shelfChecksOf(ctx: AuthContext, containerId: string) {
  if (!isUuid(containerId)) return [];
  return db
    .select({ id: shelfChecks.id, at: shelfChecks.countedAt, expected: shelfChecks.expectedQty, counted: shelfChecks.countedQty, uom: shelfChecks.baseUom, by: users.displayName, adjustmentId: shelfChecks.stockAdjustmentId, adjustmentNumber: stockAdjustments.adjustmentNumber })
    .from(shelfChecks)
    .innerJoin(users, eq(users.id, shelfChecks.countedBy))
    .leftJoin(stockAdjustments, eq(stockAdjustments.id, shelfChecks.stockAdjustmentId))
    .where(and(eq(shelfChecks.containerId, containerId), eq(shelfChecks.organizationId, ctx.organizationId), inArray(shelfChecks.siteId, ctx.allowedSiteIds)))
    .orderBy(desc(shelfChecks.countedAt))
    .limit(20);
}

/** CSV/XLSX of the Taken out lines (inventory.takeout.export), the same rows and scope as the screen. No money: costs are not recorded yet (A-TAKE-04). */
export const takeoutsExport: ExportDefinition<TakeoutFilter & Record<string, unknown>, TakeoutLineRow> = {
  code: "inventory.takeouts",
  title: "Taken out",
  permission: "inventory.takeout.export",
  sensitivity: "N",
  siteScope: (ctx) => [ctx.currentSiteId],
  fileName: (f) => `taken-out-${f.from ?? ""}-${f.to ?? manilaDay()}`,
  fetch: (ctx, f, limit) => takeoutLineRows(ctx, f, limit),
  columns: [
    { header: "Day", value: (r) => r.day },
    { header: "Number", value: (r) => r.takeoutNumber },
    { header: "State", value: (r) => STATUS_WORDS[r.status] },
    { header: "Why", value: (r) => r.sentence },
    { header: "Online shop", value: (r) => r.channelLabel ?? "" },
    { header: "Shop order number", value: (r) => r.platformOrderRef ?? "" },
    { header: "Sample for", value: (r) => r.customerName ?? r.recipientName ?? "" },
    { header: "Product", value: (r) => r.productName },
    { header: "Product code", value: (r) => r.sku },
    { header: "Lot", value: (r) => r.lotNumber },
    { header: "Shelf", value: (r) => r.placeCode },
    { header: "Box", value: (r) => r.boxNumber ?? "" },
    { header: "Pieces", value: (r) => r.pieces, numeric: true },
    { header: "Unit", value: (r) => r.uom },
    { header: "Person", value: (r) => r.personName },
    { header: "Note", value: (r) => r.note ?? "" },
  ],
};
