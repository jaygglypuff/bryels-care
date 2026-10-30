import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, notInArray, sql, type SQL } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { batches, productionDailyLogs, productionDefectEntries, products, users, workOrders } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { addDays, idempotent, manilaToday } from "./shared";

/**
 * Production order daily log, "What happened today" (ADR-074). Append-only (src/db/sql/s2.sql):
 * a correction is a new entry naming the entry it replaces plus a reason. Replaced entries stay
 * visible and no longer count in totals. Defect types come from setting `production.defect_types`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const qtyStr = (msg: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,3})?$/.test(v), msg);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .nullish()
    .transform((v) => (v ? v : null));

const entrySchema = z
  .object({
    batchId: z
      .string()
      .uuid("Choose a batch of this order.")
      .nullish()
      .or(z.literal("").transform(() => null)),
    logDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date.")
      .nullish()
      .or(z.literal("").transform(() => null)),
    shift: optText(40),
    notes: optText(1000),
    goodQty: qtyStr("Enter how many good pieces were made, for example 120.").nullish().or(z.literal("").transform(() => null)),
    defects: z
      .array(z.object({ defectType: z.string().trim().min(1, "Choose the defect type."), quantity: qtyStr("Enter how many, for example 3."), note: optText(200) }))
      .max(30)
      .default([]),
  })
  .strict();
export type DailyLogEntryInput = z.input<typeof entrySchema>;

function parse(raw: unknown) {
  const r = entrySchema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new DomainError("validation", issues.length > 1 ? "Check the highlighted fields." : issues[0].message, { issues, fieldErrors: Object.fromEntries(issues.map((i) => [i.path.split(".")[0], i.message])) });
  }
  return r.data;
}

/** Defect types configured for a site (owner-editable list). */
export async function defectTypes(ctx: AuthContext, siteId = ctx.currentSiteId) {
  return getSetting(db, ctx.organizationId, "production.defect_types", siteId);
}

async function loadOrder(q: Tx | typeof db, ctx: AuthContext, workOrderId: string) {
  if (!UUID.test(workOrderId)) throw new DomainError("not_found", "Production order not found in your sites.");
  const [wo] = await q
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, ctx.organizationId), inArray(workOrders.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!wo) throw new DomainError("not_found", "Production order not found in your sites.");
  ctx.requireSite(wo.siteId);
  return wo;
}

const LOGGABLE = ["released", "in_progress", "completed"];

/** Validates an entry against the order, its batches, the date and the defect type list. */
async function validateEntry(tx: Tx, ctx: AuthContext, wo: typeof workOrders.$inferSelect, e: ReturnType<typeof parse>, fallbackDate: string) {
  if (!LOGGABLE.includes(wo.status)) {
    throw new DomainError(
      "state",
      wo.status === "draft" || wo.status === "planned" ? `Approve production order ${wo.workOrderNumber} first; the daily log starts once it is approved.` : `Production order ${wo.workOrderNumber} is ${wo.status === "closed" ? "closed" : "cancelled"}; no more daily log entries.`,
    );
  }
  if (e.batchId) {
    const [b] = await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.id, e.batchId), eq(batches.workOrderId, wo.id))).limit(1);
    if (!b) throw new DomainError("validation", "Choose a batch of this order.", { fieldErrors: { batchId: "Not a batch of this order." } });
  }
  const logDate = e.logDate ?? fallbackDate;
  const today = manilaToday();
  if (logDate > today) throw new DomainError("validation", "The date cannot be in the future.", { fieldErrors: { logDate: "Choose today or an earlier day." } });
  if (logDate < addDays(wo.plannedStart, -60)) throw new DomainError("validation", "The date is long before this order was planned. Check the date.", { fieldErrors: { logDate: "Too early for this order." } });
  const allowed = await getSetting(tx, ctx.organizationId, "production.defect_types", wo.siteId);
  const seen = new Set<string>();
  const defects = e.defects.map((d) => {
    const type = allowed.find((t) => t.toLowerCase() === d.defectType.toLowerCase());
    if (!type) throw new DomainError("validation", `"${d.defectType}" is not in the reject list. Choose one of: ${allowed.join(", ")}.`, { fieldErrors: { defects: "Choose a reject type from the list." } });
    if (seen.has(type)) throw new DomainError("validation", `${type} is listed twice. Add the quantities together in one line.`, { fieldErrors: { defects: "Each reject type once." } });
    seen.add(type);
    const qty = new Decimal(d.quantity);
    if (qty.lte(0)) throw new DomainError("validation", `Enter how many pieces had "${type}" (more than 0).`, { fieldErrors: { defects: "More than 0." } });
    return { defectType: type, quantity: qty, note: d.note };
  });
  const good = new Decimal(e.goodQty ?? 0);
  if (!e.notes && good.eq(0) && defects.length === 0) throw new DomainError("validation", "Write what happened, or enter the good quantity or a reject.", { fieldErrors: { notes: "Write what happened today." } });
  return { logDate, good, defects };
}

async function insertEntry(
  tx: Tx,
  ctx: AuthContext,
  wo: typeof workOrders.$inferSelect,
  e: ReturnType<typeof parse>,
  v: Awaited<ReturnType<typeof validateEntry>>,
  correction: { correctsId: string; reason: string } | null,
) {
  const [row] = await tx
    .insert(productionDailyLogs)
    .values({
      organizationId: wo.organizationId,
      siteId: wo.siteId,
      workOrderId: wo.id,
      batchId: e.batchId ?? null,
      productId: wo.productId,
      logDate: v.logDate,
      shift: e.shift,
      notes: e.notes,
      goodQty: v.good.toString(),
      qtyUom: "units",
      correctsId: correction?.correctsId ?? null,
      correctionReason: correction?.reason ?? null,
      createdBy: ctx.userId,
    })
    .returning();
  if (v.defects.length) {
    await tx.insert(productionDefectEntries).values(v.defects.map((d) => ({ organizationId: wo.organizationId, siteId: wo.siteId, dailyLogId: row.id, defectType: d.defectType, quantity: d.quantity.toString(), note: d.note })));
  }
  return row;
}

const snapshot = (v: Awaited<ReturnType<typeof validateEntry>>, e: ReturnType<typeof parse>) => ({
  logDate: v.logDate,
  shift: e.shift,
  goodQty: v.good.toString(),
  defects: v.defects.map((d) => `${d.defectType} ${d.quantity.toString()}`),
  notes: e.notes,
});

/** Adds a "What happened today" entry to an approved / in-progress production order. */
export async function addDailyLog(ctx: AuthContext, input: DailyLogEntryInput & { workOrderId: string; idempotencyKey?: string | null }) {
  ctx.require("production.daily_log.create");
  const { workOrderId, idempotencyKey, ...raw } = input;
  const e = parse(raw);
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, idempotencyKey, "production.daily_log.create", async () => {
      const wo = await loadOrder(tx, ctx, workOrderId);
      ctx.requireAt("production.daily_log.create", wo.siteId);
      const v = await validateEntry(tx, ctx, wo, e, manilaToday());
      const row = await insertEntry(tx, ctx, wo, e, v, null);
      await audit(tx, ctx, {
        action: "production.daily_log.created",
        entityType: "production_daily_log",
        entityId: row.id,
        entityNumber: wo.workOrderNumber,
        siteId: wo.siteId,
        after: snapshot(v, e),
      });
      return { id: row.id, workOrderNumber: wo.workOrderNumber, logDate: v.logDate };
    });
    return result;
  });
}

/**
 * Corrects an entry by writing a NEW entry that replaces it (reason required, at least 5
 * characters). The replaced entry stays and stops counting. An entry is replaced at most once;
 * to fix a correction, correct the newer entry.
 */
export async function correctDailyLog(ctx: AuthContext, input: DailyLogEntryInput & { logId: string; reason: string; idempotencyKey?: string | null }) {
  ctx.require("production.daily_log.create");
  const { logId, reason, idempotencyKey, ...raw } = input;
  const why = reason?.trim() ?? "";
  if (why.length < 5) throw new DomainError("validation", "Say why you are correcting this entry (at least 5 characters).", { fieldErrors: { reason: "Give a reason." } });
  const e = parse(raw);
  if (!UUID.test(logId)) throw new DomainError("not_found", "Daily log entry not found in your sites.");
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, idempotencyKey, "production.daily_log.correct", async () => {
      const [orig] = await tx
        .select()
        .from(productionDailyLogs)
        .where(and(eq(productionDailyLogs.id, logId), eq(productionDailyLogs.organizationId, ctx.organizationId)))
        .for("update")
        .limit(1);
      if (!orig || !ctx.allowedSiteIds.includes(orig.siteId)) throw new DomainError("not_found", "Daily log entry not found in your sites.");
      ctx.requireAt("production.daily_log.create", orig.siteId);
      const [already] = await tx.select({ id: productionDailyLogs.id }).from(productionDailyLogs).where(eq(productionDailyLogs.correctsId, orig.id)).limit(1);
      if (already) throw new DomainError("state", "This entry was already corrected. Correct the newer entry instead.");
      const wo = await loadOrder(tx, ctx, orig.workOrderId);
      const v = await validateEntry(tx, ctx, wo, { ...e, batchId: e.batchId === undefined ? orig.batchId : e.batchId }, orig.logDate);
      const beforeDefects = await tx.select().from(productionDefectEntries).where(eq(productionDefectEntries.dailyLogId, orig.id));
      const row = await insertEntry(tx, ctx, wo, { ...e, batchId: e.batchId === undefined ? orig.batchId : e.batchId }, v, { correctsId: orig.id, reason: why });
      await audit(tx, ctx, {
        action: "production.daily_log.corrected",
        entityType: "production_daily_log",
        entityId: row.id,
        entityNumber: wo.workOrderNumber,
        siteId: wo.siteId,
        reason: why,
        before: { entryId: orig.id, logDate: orig.logDate, shift: orig.shift, goodQty: orig.goodQty, defects: beforeDefects.map((d) => `${d.defectType} ${d.quantity}`), notes: orig.notes },
        after: snapshot(v, e),
      });
      return { id: row.id, replacedId: orig.id, workOrderNumber: wo.workOrderNumber };
    });
    return result;
  });
}

/** Every entry of a production order, newest first, with its defects and whether it was replaced. */
export async function listDailyLogs(ctx: AuthContext, workOrderId: string) {
  ctx.require("production.daily_log.view");
  const wo = await loadOrder(db, ctx, workOrderId);
  const rows = await db
    .select({ log: productionDailyLogs, author: users.displayName })
    .from(productionDailyLogs)
    .innerJoin(users, eq(users.id, productionDailyLogs.createdBy))
    .where(and(eq(productionDailyLogs.workOrderId, wo.id), eq(productionDailyLogs.siteId, wo.siteId)))
    .orderBy(desc(productionDailyLogs.logDate), desc(productionDailyLogs.createdAt));
  const ids = rows.map((r) => r.log.id);
  const defects = ids.length ? await db.select().from(productionDefectEntries).where(inArray(productionDefectEntries.dailyLogId, ids)).orderBy(asc(productionDefectEntries.defectType)) : [];
  const replacedBy = new Map(rows.filter((r) => r.log.correctsId).map((r) => [r.log.correctsId!, r.log.id]));
  const batchNo = new Map((await db.select({ id: batches.id, n: batches.batchNumber }).from(batches).where(eq(batches.workOrderId, wo.id))).map((b) => [b.id, b.n]));
  return rows.map((r) => {
    const ds = defects.filter((d) => d.dailyLogId === r.log.id);
    return {
      id: r.log.id,
      logDate: r.log.logDate,
      shift: r.log.shift,
      notes: r.log.notes,
      goodQty: r.log.goodQty,
      qtyUom: r.log.qtyUom,
      batchNumber: r.log.batchId ? (batchNo.get(r.log.batchId) ?? null) : null,
      batchId: r.log.batchId,
      defects: ds.map((d) => ({ defectType: d.defectType, quantity: d.quantity, note: d.note })),
      defectTotal: ds.reduce((a, d) => a.plus(d.quantity), new Decimal(0)).toString(),
      author: r.author,
      createdAt: r.log.createdAt,
      correctsId: r.log.correctsId,
      correctionReason: r.log.correctionReason,
      replacedById: replacedBy.get(r.log.id) ?? null,
    };
  });
}
export type DailyLogRow = Awaited<ReturnType<typeof listDailyLogs>>[number];

/**
 * "Today" (ADR-080 §11, stage G1): the daily log entries of ONE day for every production order of
 * the current site, newest first, with the order and product. Read-only; entries are added on the
 * order page (the full plant "Today" page with one row per order is stage G4). Replaced entries
 * are returned with `replacedById` so the screen can show them as not counted.
 */
export async function listSiteDailyLogs(ctx: AuthContext, f: { date?: string } = {}) {
  ctx.require("production.daily_log.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const date = f.date && /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : manilaToday();
  const rows = await db
    .select({ log: productionDailyLogs, author: users.displayName, orderNumber: workOrders.workOrderNumber, productName: products.name, productFamily: products.family, batchNumber: batches.batchNumber })
    .from(productionDailyLogs)
    .innerJoin(users, eq(users.id, productionDailyLogs.createdBy))
    .innerJoin(workOrders, eq(workOrders.id, productionDailyLogs.workOrderId))
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(batches, eq(batches.id, productionDailyLogs.batchId))
    .where(and(eq(productionDailyLogs.organizationId, ctx.organizationId), eq(productionDailyLogs.siteId, siteId), eq(workOrders.siteId, siteId), eq(productionDailyLogs.logDate, date)))
    .orderBy(desc(productionDailyLogs.createdAt))
    .limit(500);
  const ids = rows.map((r) => r.log.id);
  const defects = ids.length ? await db.select().from(productionDefectEntries).where(inArray(productionDefectEntries.dailyLogId, ids)).orderBy(asc(productionDefectEntries.defectType)) : [];
  const replacers = ids.length ? await db.select({ id: productionDailyLogs.id, correctsId: productionDailyLogs.correctsId }).from(productionDailyLogs).where(inArray(productionDailyLogs.correctsId, ids)) : [];
  const replacedBy = new Map(replacers.map((r) => [r.correctsId!, r.id]));
  return {
    date,
    entries: rows.map((r) => {
      const ds = defects.filter((d) => d.dailyLogId === r.log.id);
      return {
        id: r.log.id,
        workOrderId: r.log.workOrderId,
        orderNumber: r.orderNumber,
        productName: r.productName,
        productFamily: r.productFamily,
        batchNumber: r.batchNumber,
        shift: r.log.shift,
        notes: r.log.notes,
        goodQty: r.log.goodQty,
        rejects: ds.map((d) => ({ type: d.defectType, quantity: d.quantity })),
        rejectTotal: ds.reduce((a, d) => a.plus(d.quantity), new Decimal(0)).toString(),
        author: r.author,
        createdAt: r.log.createdAt,
        correctsId: r.log.correctsId,
        replacedById: replacedBy.get(r.log.id) ?? null,
      };
    }),
  };
}
export type SiteDailyLog = Awaited<ReturnType<typeof listSiteDailyLogs>>;

export type DefectSummaryRow = { productId: string; productName: string; productSku: string; logDate: string; good: string; defects: string; defectPct: string | null; byType: Record<string, string> };

/**
 * Good output vs defects per product and day from the entries that count (not replaced), with
 * defect % = defects ÷ (good + defects) × 100 (A-S2-04). Scoped to one order, or to the current
 * site (or a given site the caller may see) over a date range (default the last 30 days).
 */
export async function defectSummary(ctx: AuthContext, f: { workOrderId?: string; siteId?: string; from?: string; to?: string; productId?: string } = {}) {
  ctx.require("production.daily_log.view");
  const conds: SQL[] = [eq(productionDailyLogs.organizationId, ctx.organizationId)];
  if (f.workOrderId) {
    const wo = await loadOrder(db, ctx, f.workOrderId);
    conds.push(eq(productionDailyLogs.workOrderId, wo.id), eq(productionDailyLogs.siteId, wo.siteId));
  } else {
    const siteId = f.siteId ?? ctx.currentSiteId;
    ctx.requireSite(siteId);
    conds.push(eq(productionDailyLogs.siteId, siteId));
    const to = f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? f.to : manilaToday();
    const from = f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? f.from : addDays(to, -29);
    conds.push(gte(productionDailyLogs.logDate, from), lte(productionDailyLogs.logDate, to));
    if (f.productId && UUID.test(f.productId)) conds.push(eq(productionDailyLogs.productId, f.productId));
  }
  // Entries that count: not replaced by a later correction.
  const replaced = db.select({ id: productionDailyLogs.correctsId }).from(productionDailyLogs).where(isNotNull(productionDailyLogs.correctsId));
  conds.push(notInArray(productionDailyLogs.id, sql`(${replaced})`));
  const logs = await db
    .select({ id: productionDailyLogs.id, productId: productionDailyLogs.productId, logDate: productionDailyLogs.logDate, good: productionDailyLogs.goodQty, productName: products.name, productSku: products.skuCode })
    .from(productionDailyLogs)
    .innerJoin(products, eq(products.id, productionDailyLogs.productId))
    .where(and(...conds))
    .limit(5000);
  const ids = logs.map((l) => l.id);
  const defects = ids.length ? await db.select().from(productionDefectEntries).where(inArray(productionDefectEntries.dailyLogId, ids)) : [];
  const byLog = new Map<string, typeof defects>();
  for (const d of defects) byLog.set(d.dailyLogId, [...(byLog.get(d.dailyLogId) ?? []), d]);

  type Acc = { productId: string; productName: string; productSku: string; logDate: string; good: Decimal; defects: Decimal; byType: Map<string, Decimal> };
  const acc = new Map<string, Acc>();
  const totals = { good: new Decimal(0), defects: new Decimal(0), byType: new Map<string, Decimal>() };
  for (const l of logs) {
    const k = `${l.productId}|${l.logDate}`;
    const a = acc.get(k) ?? { productId: l.productId, productName: l.productName, productSku: l.productSku, logDate: l.logDate, good: new Decimal(0), defects: new Decimal(0), byType: new Map() };
    a.good = a.good.plus(l.good);
    totals.good = totals.good.plus(l.good);
    for (const d of byLog.get(l.id) ?? []) {
      a.defects = a.defects.plus(d.quantity);
      a.byType.set(d.defectType, (a.byType.get(d.defectType) ?? new Decimal(0)).plus(d.quantity));
      totals.defects = totals.defects.plus(d.quantity);
      totals.byType.set(d.defectType, (totals.byType.get(d.defectType) ?? new Decimal(0)).plus(d.quantity));
    }
    acc.set(k, a);
  }
  const pct = (part: Decimal, whole: Decimal) => (whole.gt(0) ? part.div(whole).mul(100).toDecimalPlaces(1).toString() : null);
  const rows: DefectSummaryRow[] = [...acc.values()]
    .sort((x, y) => (x.logDate === y.logDate ? x.productName.localeCompare(y.productName) : x.logDate < y.logDate ? 1 : -1))
    .map((a) => ({
      productId: a.productId,
      productName: a.productName,
      productSku: a.productSku,
      logDate: a.logDate,
      good: a.good.toString(),
      defects: a.defects.toString(),
      defectPct: pct(a.defects, a.good.plus(a.defects)),
      byType: Object.fromEntries([...a.byType].map(([t, q]) => [t, q.toString()])),
    }));
  const made = totals.good.plus(totals.defects);
  const prod = new Map<string, { productId: string; productName: string; productSku: string; good: Decimal; defects: Decimal }>();
  for (const a of acc.values()) {
    const p = prod.get(a.productId) ?? { productId: a.productId, productName: a.productName, productSku: a.productSku, good: new Decimal(0), defects: new Decimal(0) };
    p.good = p.good.plus(a.good);
    p.defects = p.defects.plus(a.defects);
    prod.set(a.productId, p);
  }
  return {
    rows,
    byProduct: [...prod.values()]
      .sort((a, b) => a.productName.localeCompare(b.productName))
      .map((p) => ({ productId: p.productId, productName: p.productName, productSku: p.productSku, good: p.good.toString(), defects: p.defects.toString(), defectPct: pct(p.defects, p.good.plus(p.defects)) })),
    totals: {
      good: totals.good.toString(),
      defects: totals.defects.toString(),
      defectPct: pct(totals.defects, made),
      byType: [...totals.byType]
        .sort((a, b) => b[1].comparedTo(a[1]))
        .map(([type, qty]) => ({ type, qty: qty.toString(), pctOfMade: pct(qty, made), pctOfDefects: pct(qty, totals.defects) })),
    },
  };
}
export type DefectSummary = Awaited<ReturnType<typeof defectSummary>>;
