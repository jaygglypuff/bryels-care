import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { departments, equipment, productionLines, sites } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertTransition, assertUuid, diff, isReferenced, optText, optUuid, reqText, scanCode, uniqueConflict } from "./org-common";
import { parseInput } from "./schemas";

/**
 * Production lines per site (US-1-20). The equipment register (W1D) links to a line through
 * equipment.production_line_id (assignEquipmentToLine in lines-equipment.ts). status: active |
 * down | inactive (LINE_TRANSITIONS); inactive = deactivated, never deleted.
 */
export const LINE_STATUSES = ["active", "down", "inactive"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export const LINE_TRANSITIONS: Record<LineStatus, readonly LineStatus[]> = {
  active: ["down", "inactive"],
  down: ["active", "inactive"],
  inactive: ["active"],
};

const LineInput = z
  .object({
    siteId: z.string().uuid("Choose a site."),
    code: scanCode("Line code", "SOAP-1"),
    name: reqText("the line name", 120),
    departmentId: optUuid,
    notes: optText(1000),
  })
  .strict();

export async function listLines(ctx: AuthContext, opts: { siteId?: string; includeInactive?: boolean } = {}) {
  ctx.require("masterdata.production_line.view");
  const siteIds = opts.siteId && ctx.allowedSiteIds.includes(opts.siteId) ? [opts.siteId] : ctx.allowedSiteIds;
  if (!siteIds.length) return [];
  return db
    .select({
      id: productionLines.id,
      siteId: productionLines.siteId,
      siteCode: sites.code,
      code: productionLines.code,
      name: productionLines.name,
      status: productionLines.status,
      departmentId: productionLines.departmentId,
      departmentName: departments.name,
      equipmentCount: sql<number>`(select count(*) from ${equipment} e where e.production_line_id = "production_lines"."id")::int`,
    })
    .from(productionLines)
    .innerJoin(sites, eq(sites.id, productionLines.siteId))
    .leftJoin(departments, eq(departments.id, productionLines.departmentId))
    .where(and(eq(productionLines.organizationId, ctx.organizationId), inArray(productionLines.siteId, siteIds), opts.includeInactive ? undefined : sql`${productionLines.status} <> 'inactive'`))
    .orderBy(asc(sites.code), asc(productionLines.code));
}

async function loadLine(q: DbOrTx, ctx: AuthContext, lineId: string, lock = false) {
  assertUuid(lineId, "Production line");
  const base = q.select().from(productionLines).where(and(eq(productionLines.id, lineId), eq(productionLines.organizationId, ctx.organizationId))).limit(1);
  const [l] = lock ? await base.for("update") : await base;
  if (!l) throw new DomainError("not_found", "Production line not found.");
  ctx.requireSite(l.siteId);
  return l;
}

export async function getLine(ctx: AuthContext, lineId: string) {
  ctx.require("masterdata.production_line.view");
  const l = await loadLine(db, ctx, lineId);
  const [dept] = l.departmentId ? await db.select({ id: departments.id, code: departments.code, name: departments.name }).from(departments).where(eq(departments.id, l.departmentId)) : [null];
  const eq_ = ctx.can("masterdata.equipment.view")
    ? await db
        .select({ id: equipment.id, code: equipment.code, name: equipment.name, kind: equipment.equipmentKind, status: equipment.status, blockingRule: equipment.blockingRule })
        .from(equipment)
        .where(eq(equipment.productionLineId, l.id))
        .orderBy(asc(equipment.code))
    : [];
  return { ...l, department: dept ?? null, equipment: eq_ };
}

async function assertDepartment(q: DbOrTx, siteId: string, departmentId: string | null) {
  if (!departmentId) return;
  const [d] = await q.select({ siteId: departments.siteId, isActive: departments.isActive }).from(departments).where(eq(departments.id, departmentId)).limit(1);
  if (!d || d.siteId !== siteId) throw new DomainError("validation", "Choose a department of the same site.", { field: "departmentId" });
  if (!d.isActive) throw new DomainError("validation", "This department is inactive.", { field: "departmentId" });
}

export async function createLine(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.production_line.admin");
  const v = parseInput(LineInput, raw);
  ctx.requireSite(v.siteId);
  return db.transaction(async (tx) => {
    await assertDepartment(tx, v.siteId, v.departmentId);
    const [l] = await tx
      .insert(productionLines)
      .values({ organizationId: ctx.organizationId, ...v, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning()
      .catch((e) => uniqueConflict(e, `Line code ${v.code} already exists at this site.`));
    await audit(tx, ctx, { action: "masterdata.production_line.created", entityType: "production_line", entityId: l.id, entityNumber: l.code, siteId: l.siteId, after: v });
    return l;
  });
}

export async function updateLine(ctx: AuthContext, lineId: string, raw: unknown) {
  ctx.require("masterdata.production_line.admin");
  const v = parseInput(LineInput.omit({ siteId: true }), raw);
  return db.transaction(async (tx) => {
    const before = await loadLine(tx, ctx, lineId, true);
    if (v.code !== before.code && (await isReferenced(tx, "production_lines", before.id)).referenced) {
      throw new DomainError("state", `Line code ${before.code} is in use; it can no longer change.`, { field: "code" });
    }
    await assertDepartment(tx, before.siteId, v.departmentId);
    const [after] = await tx
      .update(productionLines)
      .set({ ...v, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(productionLines.id, before.id))
      .returning()
      .catch((e) => uniqueConflict(e, `Line code ${v.code} already exists at this site.`));
    const d = diff(before, after, ["code", "name", "departmentId", "notes"]);
    if (d.changed.length) await audit(tx, ctx, { action: "masterdata.production_line.updated", entityType: "production_line", entityId: after.id, entityNumber: after.code, siteId: after.siteId, before: d.before, after: d.after });
    if (d.changed.includes("name")) await tx.update(equipment).set({ lineLabel: after.name }).where(eq(equipment.productionLineId, after.id));
    return after;
  });
}

const LineStatusInput = z.object({ lineId: z.string().uuid(), status: z.enum(LINE_STATUSES), reason: reqText("the reason", 500) }).strict();

/** Line status change (state machine LINE_TRANSITIONS), audited with the reason. */
export async function changeLineStatus(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.production_line.admin");
  const v = parseInput(LineStatusInput, raw);
  return db.transaction(async (tx) => {
    const before = await loadLine(tx, ctx, v.lineId, true);
    if (before.status === v.status) return before;
    assertTransition(LINE_TRANSITIONS, before.status as LineStatus, v.status, `Line ${before.code}`);
    const [after] = await tx.update(productionLines).set({ status: v.status, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(productionLines.id, before.id)).returning();
    const action = v.status === "inactive" ? "masterdata.production_line.deactivated" : "masterdata.production_line.status_changed";
    await audit(tx, ctx, { action, entityType: "production_line", entityId: after.id, entityNumber: after.code, siteId: after.siteId, reason: v.reason, before: { status: before.status }, after: { status: after.status } });
    return after;
  });
}

/** Active departments and lines for pickers (scoped to the caller's sites). */
export async function lineFormOptions(ctx: AuthContext, siteId?: string) {
  ctx.require("masterdata.production_line.view");
  const siteIds = siteId && ctx.allowedSiteIds.includes(siteId) ? [siteId] : ctx.allowedSiteIds;
  if (!siteIds.length) return { departments: [], lines: [] };
  const ds = await db
    .select({ id: departments.id, code: departments.code, name: departments.name, siteId: departments.siteId })
    .from(departments)
    .where(and(inArray(departments.siteId, siteIds), eq(departments.isActive, true)))
    .orderBy(asc(departments.code));
  const ls = await db
    .select({ id: productionLines.id, code: productionLines.code, name: productionLines.name, siteId: productionLines.siteId })
    .from(productionLines)
    .where(and(inArray(productionLines.siteId, siteIds), sql`${productionLines.status} <> 'inactive'`))
    .orderBy(asc(productionLines.code));
  return { departments: ds, lines: ls };
}
