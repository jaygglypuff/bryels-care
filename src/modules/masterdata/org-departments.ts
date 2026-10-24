import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { departments, productionLines, sites } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertUuid, bool, diff, isReferenced, reqText, scanCode, uniqueConflict } from "./org-common";
import { parseInput } from "./schemas";

/**
 * Departments per site (US-1-20): Production, Warehouse, QA… A line's department is printed on
 * the BMR header. Site-scoped: `masterdata.department.admin` plus the site in the caller's scope.
 */
const DepartmentInput = z
  .object({ siteId: z.string().uuid("Choose a site."), code: scanCode("Department code", "PROD"), name: reqText("the department name", 120), isActive: bool(true) })
  .strict();

export async function listDepartments(ctx: AuthContext, opts: { siteId?: string; includeInactive?: boolean } = {}) {
  ctx.require("masterdata.department.view");
  const siteIds = opts.siteId && ctx.allowedSiteIds.includes(opts.siteId) ? [opts.siteId] : ctx.allowedSiteIds;
  if (!siteIds.length) return [];
  return db
    .select({ id: departments.id, siteId: departments.siteId, siteCode: sites.code, code: departments.code, name: departments.name, isActive: departments.isActive })
    .from(departments)
    .innerJoin(sites, eq(sites.id, departments.siteId))
    .where(and(eq(departments.organizationId, ctx.organizationId), inArray(departments.siteId, siteIds), opts.includeInactive ? undefined : eq(departments.isActive, true)))
    .orderBy(asc(sites.code), asc(departments.code));
}

export async function createDepartment(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.department.admin");
  const v = parseInput(DepartmentInput, raw);
  ctx.requireSite(v.siteId);
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(departments)
      .values({ organizationId: ctx.organizationId, siteId: v.siteId, code: v.code, name: v.name, isActive: v.isActive, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning()
      .catch((e) => uniqueConflict(e, `Department code ${v.code} already exists at this site.`));
    await audit(tx, ctx, { action: "masterdata.department.created", entityType: "department", entityId: d.id, entityNumber: d.code, siteId: d.siteId, after: { code: d.code, name: d.name } });
    return d;
  });
}

/** Renames, recodes (only while unused) or (de)activates a department; refuses deactivation while an active line uses it. */
export async function updateDepartment(ctx: AuthContext, departmentId: string, raw: unknown) {
  ctx.require("masterdata.department.admin");
  assertUuid(departmentId, "Department");
  const v = parseInput(DepartmentInput.omit({ siteId: true }), raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(departments).where(and(eq(departments.id, departmentId), eq(departments.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Department not found.");
    ctx.requireSite(before.siteId);
    if (v.code !== before.code && (await isReferenced(tx, "departments", before.id)).referenced) {
      throw new DomainError("state", `Department code ${before.code} is in use; it can no longer change.`, { field: "code" });
    }
    if (!v.isActive && before.isActive) {
      const [line] = await tx.select({ code: productionLines.code }).from(productionLines).where(and(eq(productionLines.departmentId, before.id), ne(productionLines.status, "inactive"))).limit(1);
      if (line) throw new DomainError("state", `Line ${line.code} still belongs to this department. Move or deactivate the line first.`, { field: "isActive" });
    }
    const [after] = await tx
      .update(departments)
      .set({ code: v.code, name: v.name, isActive: v.isActive, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(departments.id, before.id))
      .returning()
      .catch((e) => uniqueConflict(e, `Department code ${v.code} already exists at this site.`));
    const d = diff(before, after, ["code", "name", "isActive"]);
    if (d.changed.length) {
      const action = before.isActive && !after.isActive ? "masterdata.department.deactivated" : "masterdata.department.updated";
      await audit(tx, ctx, { action, entityType: "department", entityId: after.id, entityNumber: after.code, siteId: after.siteId, before: d.before, after: d.after });
    }
    return after;
  });
}
