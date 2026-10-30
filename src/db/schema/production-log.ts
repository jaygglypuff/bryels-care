import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, date, index, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { products } from "./masterdata";
import { batches } from "./production";
import { workOrders } from "./planning";

/**
 * Production order daily log (ADR-074, stream S2). Operators write "what happened today" against a
 * production order (a work order in the data model) and optionally one of its batches: a note,
 * the good quantity made and defects by type. Both tables are append-only (src/db/sql/s2.sql):
 * a mistake is corrected by a NEW entry that names the entry it replaces (`corrects_id`) and a
 * reason; the replaced entry stays visible and stops counting in totals.
 */
export const productionDailyLogs = pgTable(
  "production_daily_logs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id),
    batchId: uuid("batch_id").references(() => batches.id),
    /** Denormalised from the work order so defect summaries group by product without a join chain. */
    productId: uuid("product_id").notNull().references(() => products.id),
    /** Plant calendar date (Asia/Manila) the entry is about. */
    logDate: date("log_date").notNull(),
    /** Optional shift name ("Morning", "Night"); free text, not a roster. */
    shift: text("shift"),
    notes: text("notes"),
    /** Good output made in this entry, in `qty_uom` (default "units", A-S2-03). */
    goodQty: numeric("good_qty", QTY).notNull().default("0"),
    qtyUom: text("qty_uom").notNull().default("units"),
    /** The earlier entry this entry replaces (correction). Each entry is replaced at most once. */
    correctsId: uuid("corrects_id").references((): AnyPgColumn => productionDailyLogs.id),
    correctionReason: text("correction_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("production_daily_logs_wo_idx").on(t.workOrderId, t.logDate),
    index("production_daily_logs_site_date_idx").on(t.siteId, t.logDate),
    uniqueIndex("production_daily_logs_corrects_uq").on(t.correctsId),
    check("ck_production_daily_logs_qty", sql`${t.goodQty} >= 0`),
    check("ck_production_daily_logs_correction", sql`(${t.correctsId} is null) = (${t.correctionReason} is null)`),
  ],
);

/** Defects of one daily log entry, by configured type (setting `production.defect_types`). Append-only. */
export const productionDefectEntries = pgTable(
  "production_defect_entries",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    dailyLogId: uuid("daily_log_id").notNull().references(() => productionDailyLogs.id),
    defectType: text("defect_type").notNull(),
    quantity: numeric("quantity", QTY).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("production_defect_entries_log_idx").on(t.dailyLogId), check("ck_production_defect_entries_qty", sql`${t.quantity} > 0`)],
);
