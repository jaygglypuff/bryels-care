import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { equipment, productionLines } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { optText, optUuid } from "./org-common";
import { parseInput } from "./schemas";

/**
 * Links the W1D equipment register to the organization structure (US-1-20 AC3) without
 * duplicating it: assign a piece of equipment to a production line of its site, and change its
 * blocking rule (what an overdue calibration, maintenance or cleaning does; A-DM-28). Both need
 * `masterdata.equipment.admin` ("create equipment, assign to site/line, define blocking rules").
 */
const AssignInput = z.object({ equipmentId: z.string().uuid(), productionLineId: optUuid }).strict();
const BlockingRuleInput = z.object({ equipmentId: z.string().uuid(), blockingRule: z.enum(["block", "warn", "none"]), reason: optText(500) }).strict();

async function loadEquipment(tx: Tx, ctx: AuthContext, equipmentId: string) {
  const [e] = await tx.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!e) throw new DomainError("not_found", "Equipment not found.");
  ctx.requireSite(e.siteId);
  return e;
}

export async function assignEquipmentToLine(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.equipment.admin");
  const v = parseInput(AssignInput, raw);
  return db.transaction(async (tx) => {
    const e = await loadEquipment(tx, ctx, v.equipmentId);
    let line: { id: string; code: string; name: string } | null = null;
    if (v.productionLineId) {
      const [l] = await tx.select().from(productionLines).where(and(eq(productionLines.id, v.productionLineId), eq(productionLines.organizationId, ctx.organizationId))).limit(1);
      if (!l || l.siteId !== e.siteId) throw new DomainError("validation", "Choose a line at the equipment's site.", { field: "productionLineId" });
      if (l.status === "inactive") throw new DomainError("state", `Line ${l.code} is inactive.`, { field: "productionLineId" });
      line = l;
    }
    if ((e.productionLineId ?? null) === (line?.id ?? null)) return e;
    const [before] = e.productionLineId ? await tx.select({ code: productionLines.code }).from(productionLines).where(eq(productionLines.id, e.productionLineId)) : [null];
    const [after] = await tx.update(equipment).set({ productionLineId: line?.id ?? null, lineLabel: line?.name ?? null }).where(eq(equipment.id, e.id)).returning();
    await audit(tx, ctx, {
      action: "masterdata.equipment.line_assigned",
      entityType: "equipment",
      entityId: e.id,
      entityNumber: e.code,
      siteId: e.siteId,
      before: { productionLineId: e.productionLineId, lineCode: before?.code ?? null },
      after: { productionLineId: after.productionLineId, lineCode: line?.code ?? null },
    });
    return after;
  });
}

/** Writes masterdata.equipment.blocking_rule_changed with before/after (US-1-20 AC3). */
export async function changeEquipmentBlockingRule(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.equipment.admin");
  const v = parseInput(BlockingRuleInput, raw);
  return db.transaction(async (tx) => {
    const e = await loadEquipment(tx, ctx, v.equipmentId);
    if (e.blockingRule === v.blockingRule) return e;
    if (v.blockingRule !== "block" && (!v.reason || v.reason.length < 5)) {
      throw new DomainError("validation", "Give the reason for relaxing the blocking rule (at least 5 characters).", { field: "reason" });
    }
    const [after] = await tx.update(equipment).set({ blockingRule: v.blockingRule }).where(eq(equipment.id, e.id)).returning();
    await audit(tx, ctx, { action: "masterdata.equipment.blocking_rule_changed", entityType: "equipment", entityId: e.id, entityNumber: e.code, siteId: e.siteId, reason: v.reason, before: { blockingRule: e.blockingRule }, after: { blockingRule: after.blockingRule } });
    return after;
  });
}
