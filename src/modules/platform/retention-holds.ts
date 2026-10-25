import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { LEGAL_HOLD_ENTITY_TYPES, LEGAL_HOLD_KINDS, batches, complaints, customers, inventoryLots, legalHolds, salesOrders, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { auditDenied } from "@/modules/governance";

/**
 * Legal holds (US-9-05, docs/data-model.md §12.1): a hold on a lot, batch, customer, complaint,
 * sales order or user stops every retention action on what it references until a different person
 * releases it with a note. Holds are organisation-level records; site-scoped entities (lots,
 * batches, complaints, orders) can only be held or released by someone who can see that site.
 */
export type LegalHoldEntityType = (typeof LEGAL_HOLD_ENTITY_TYPES)[number];

export const ENTITY_LABELS: Record<LegalHoldEntityType, string> = {
  inventory_lot: "Lot",
  batch: "Batch",
  customer: "Customer",
  complaint: "Complaint",
  sales_order: "Sales order",
  user: "User",
};

type Resolved = { id: string; label: string; siteId: string | null };

/** Finds the entity by its human reference (lot number, batch number, customer code, …) inside the organisation. */
async function resolveEntity(q: DbOrTx, organizationId: string, type: LegalHoldEntityType, ref: string): Promise<Resolved | null> {
  const r = ref.trim();
  const one = async <T extends Resolved>(rows: Promise<T[]>) => (await rows)[0] ?? null;
  switch (type) {
    case "inventory_lot":
      return one(q.select({ id: inventoryLots.id, label: inventoryLots.lotNumber, siteId: inventoryLots.siteId }).from(inventoryLots).where(and(eq(inventoryLots.organizationId, organizationId), eq(inventoryLots.lotNumber, r))).limit(1));
    case "batch":
      return one(q.select({ id: batches.id, label: batches.batchNumber, siteId: batches.siteId }).from(batches).where(and(eq(batches.organizationId, organizationId), eq(batches.batchNumber, r))).limit(1));
    case "customer":
      return one(q.select({ id: customers.id, label: customers.code, siteId: sql<string | null>`null` }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.code, r))).limit(1));
    case "complaint":
      return one(q.select({ id: complaints.id, label: complaints.complaintNumber, siteId: complaints.siteId }).from(complaints).where(and(eq(complaints.organizationId, organizationId), eq(complaints.complaintNumber, r))).limit(1));
    case "sales_order":
      return one(q.select({ id: salesOrders.id, label: salesOrders.orderNumber, siteId: salesOrders.siteId }).from(salesOrders).where(and(eq(salesOrders.organizationId, organizationId), eq(salesOrders.orderNumber, r))).limit(1));
    case "user":
      return one(q.select({ id: users.id, label: users.email, siteId: sql<string | null>`null` }).from(users).where(and(eq(users.organizationId, organizationId), eq(users.email, r.toLowerCase()))).limit(1));
  }
}

/** Site scope of the entity a hold references (null for organisation-level entities). */
async function entitySite(q: DbOrTx, type: LegalHoldEntityType, id: string): Promise<string | null> {
  const t = { inventory_lot: "inventory_lots", batch: "batches", complaint: "complaints", sales_order: "sales_orders" } as Record<string, string>;
  if (!t[type]) return null;
  const rows = await q.execute<{ site_id: string }>(sql`select site_id from ${sql.identifier(t[type])} where id = ${id}`);
  return rows[0]?.site_id ?? null;
}

export const PlaceHoldSchema = z
  .object({
    holdKind: z.enum(LEGAL_HOLD_KINDS),
    entityType: z.enum(LEGAL_HOLD_ENTITY_TYPES),
    reference: z.string().trim().min(1, "Enter the number or code.").max(120),
    reason: z.string().trim().min(5, "Say why the records must be kept (at least 5 characters).").max(1000),
  })
  .strict();

export async function placeLegalHold(ctx: AuthContext, raw: z.input<typeof PlaceHoldSchema>) {
  ctx.require("platform.legal_hold.create");
  ctx.assertWritable();
  const input = PlaceHoldSchema.parse(raw);
  const found = await resolveEntity(db, ctx.organizationId, input.entityType, input.reference);
  // Unknown and out-of-scope look the same (docs/permissions-matrix.md §1: 404, never a hint).
  if (!found || (found.siteId && !ctx.allowedSiteIds.includes(found.siteId))) {
    throw new DomainError("not_found", `${ENTITY_LABELS[input.entityType]} ${input.reference} was not found in your sites.`, { field: "reference" });
  }
  return db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: legalHolds.id })
      .from(legalHolds)
      .where(and(eq(legalHolds.organizationId, ctx.organizationId), eq(legalHolds.entityType, input.entityType), eq(legalHolds.entityId, found.id), isNull(legalHolds.releasedAt)))
      .for("update");
    if (dup) throw new DomainError("conflict", `${ENTITY_LABELS[input.entityType]} ${found.label} is already under a legal hold.`, { field: "reference" });
    const [row] = await tx
      .insert(legalHolds)
      .values({ organizationId: ctx.organizationId, holdKind: input.holdKind, entityType: input.entityType, entityId: found.id, entityLabel: found.label, reason: input.reason, placedBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "platform.legal_hold.placed", entityType: "legal_holds", entityId: row.id, entityNumber: found.label, siteId: found.siteId, reason: input.reason, after: { holdKind: row.holdKind, entityType: row.entityType, entityId: row.entityId } });
    return row;
  });
}

export async function releaseLegalHold(ctx: AuthContext, input: { id: string; note: string }) {
  ctx.require("platform.legal_hold.void");
  ctx.assertWritable();
  const note = input.note.trim();
  if (note.length < 5) throw new DomainError("validation", "Say why the hold can end (at least 5 characters).", { field: "note" });
  const id = z.uuid().safeParse(input.id);
  if (!id.success) throw new DomainError("not_found", "Legal hold not found.");
  const [hold] = await db.select().from(legalHolds).where(and(eq(legalHolds.id, id.data), eq(legalHolds.organizationId, ctx.organizationId)));
  if (!hold) throw new DomainError("not_found", "Legal hold not found.");
  const site = await entitySite(db, hold.entityType as LegalHoldEntityType, hold.entityId);
  if (site && !ctx.allowedSiteIds.includes(site)) throw new DomainError("not_found", "Legal hold not found.");
  if (ctx.sodBlocks(hold.placedBy === ctx.userId, "You placed this hold; a different person must release it.")) {
    await auditDenied(ctx, { permission: "platform.legal_hold.void", entityType: "legal_holds", entityId: hold.id, siteId: site, rule: "releaser_is_placer" });
    throw new DomainError("separation_of_duties", "You placed this hold; a different person must release it.", ctx.refusalDetails());
  }
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(legalHolds)
      .set({ releasedBy: ctx.userId, releasedAt: now, releaseNote: note })
      .where(and(eq(legalHolds.id, hold.id), isNull(legalHolds.releasedAt)))
      .returning();
    if (!row) throw new DomainError("conflict", "This hold was already released.");
    await audit(tx, ctx, { action: "platform.legal_hold.released", entityType: "legal_holds", entityId: row.id, entityNumber: row.entityLabel, siteId: site, reason: note, before: { releasedAt: null }, after: { releasedAt: now.toISOString() } });
    return row;
  });
}

export type LegalHoldRow = typeof legalHolds.$inferSelect & { placedByName: string | null; releasedByName: string | null };

/** Holds whose entity is in the viewer's sites (organisation-level entities are always visible). */
export async function listLegalHolds(ctx: AuthContext, opts: { includeReleased?: boolean } = {}): Promise<LegalHoldRow[]> {
  ctx.require("platform.legal_hold.view");
  const placer = alias(users, "placer");
  const releaser = alias(users, "releaser");
  const rows = await db
    .select({ h: legalHolds, placedByName: placer.displayName, releasedByName: releaser.displayName })
    .from(legalHolds)
    .leftJoin(placer, eq(placer.id, legalHolds.placedBy))
    .leftJoin(releaser, eq(releaser.id, legalHolds.releasedBy))
    .where(and(eq(legalHolds.organizationId, ctx.organizationId), opts.includeReleased ? sql`true` : isNull(legalHolds.releasedAt)))
    .orderBy(desc(legalHolds.placedAt))
    .limit(200);
  const out: LegalHoldRow[] = [];
  for (const r of rows) {
    const site = await entitySite(db, r.h.entityType as LegalHoldEntityType, r.h.entityId);
    if (site && !ctx.allowedSiteIds.includes(site)) continue;
    out.push({ ...r.h, placedByName: r.placedByName, releasedByName: r.releasedByName });
  }
  return out;
}

export type HeldSet = {
  ids: string[];
  explicit: number;
  implicit: { openComplaints: number; openDeviations: number };
};

/**
 * Everything a retention action must not touch (docs/data-model.md §12.1, §12.4 item 5):
 * - explicit legal holds, expanded one step through the genealogy columns: a held lot also holds
 *   the batch that produced it and lots re-lotted from it; a held batch also holds its output lots;
 * - implicit holds: open complaints (the complaint, its lot, customer, order and shipment) and open
 *   deviations (the deviation, its batch and lot), with the same lot/batch expansion.
 * Returns ids only; every id is a UUID, so the purge queries can compare without the type.
 */
export async function resolveHeldSet(q: DbOrTx, organizationId: string): Promise<HeldSet> {
  const rows = await q.execute<{ id: string; src: string }>(sql`
    with seeds as (
      select entity_id as id, 'explicit' as src from legal_holds where organization_id = ${organizationId} and released_at is null
      union all
      select unnest(array[c.id, c.lot_id, c.customer_id, c.sales_order_id, c.shipment_id]), 'complaint'
        from complaints c where c.organization_id = ${organizationId} and c.status in ('open','investigating')
      union all
      select unnest(array[d.id, d.batch_id, d.lot_id]), 'deviation'
        from deviations d where d.organization_id = ${organizationId} and d.status in ('open','investigating')
    ), base as (
      select id, src from seeds where id is not null
    ), expanded as (
      select id, src from base
      union all select l.source_batch_id, b.src from base b join inventory_lots l on l.id = b.id where l.source_batch_id is not null
      union all select l.id, b.src from base b join inventory_lots l on l.origin_lot_id = b.id
      union all select l.id, b.src from base b join inventory_lots l on l.source_batch_id = b.id
      union all select bt.output_lot_id, b.src from base b join batches bt on bt.id = b.id where bt.output_lot_id is not null
    )
    select distinct id::text as id, src from expanded`);
  const ids = [...new Set(rows.map((r) => r.id))];
  const count = async (table: string, statuses: string) =>
    Number((await q.execute<{ n: string }>(sql`select count(*)::text as n from ${sql.identifier(table)} where organization_id = ${organizationId} and status in (${sql.raw(statuses)})`))[0]?.n ?? 0);
  return {
    ids,
    explicit: rows.filter((r) => r.src === "explicit").length,
    implicit: { openComplaints: await count("complaints", "'open','investigating'"), openDeviations: await count("deviations", "'open','investigating'") },
  };
}
