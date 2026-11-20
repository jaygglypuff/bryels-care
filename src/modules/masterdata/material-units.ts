import "server-only";
import { aliasedTable, and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { bomLines, materialUnits, materials, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { idempotent } from "./idempotency";
import { assertUuid } from "./org-common";
import { parseInput } from "./schemas";

/**
 * ADR-137: the named units of a material ("1 sachet = 25 g", "1 drum = 25,000 g") and its density ("1 mL = 0.92 g"), so
 * a recipe line can be counted or measured by volume while stock stays in the material's stock unit.
 *
 * Rules:
 * - read: `masterdata.material.view`; add, change, stop using: `masterdata.material.edit` (the same people who keep the
 *   material). Every change is audited (`masterdata.material_unit.*`).
 * - a version is never rewritten (service + trigger `tg_material_units_immutable`): "Change the size" retires the
 *   version and adds the next one; recipe lines and batch records keep the number they were made with.
 * - names: 1–30 letters, not a stock unit word (g, kg, mL, L, pcs); one active unit per name per material.
 * - density: kind `volume`, name "mL"; for a mL material it is 1; a material counted in pieces has none.
 * Values are company data typed by the recipe writer (pack sizes from the supplier's label; densities from the supplier's
 * data sheet), never invented by the system (A-ADDM-02).
 */

const RESERVED = new Set(["g", "kg", "mg", "ml", "l", "pcs", "piece", "pieces"]);
const qtyText = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Type the amount as a number (at most 6 decimals).")
  .refine((v) => new Decimal(v).gt(0), "The amount must be more than 0.");
const reason = z.string().trim().min(5, "Say why (at least 5 letters).").max(300, "Use at most 300 characters.");

const AddInput = z
  .object({
    materialId: z.string().uuid("Choose the material."),
    kind: z.enum(["pack", "volume"], { message: "Choose: a pack you count, or mL." }),
    name: z.string().trim().max(30, "Use at most 30 letters.").default(""),
    qtyPerUnit: qtyText,
    note: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (v ?? "").trim() || null)
      .refine((v) => v === null || v.length <= 200, "Use at most 200 characters."),
    idempotencyKey: z.string().max(100).nullish(),
  })
  .strict();

const ChangeInput = z.object({ unitId: z.string().uuid(), qtyPerUnit: qtyText, reason, idempotencyKey: z.string().max(100).nullish() }).strict();
const RetireInput = z.object({ unitId: z.string().uuid(), reason, idempotencyKey: z.string().max(100).nullish() }).strict();

export type MaterialUnitRow = typeof materialUnits.$inferSelect;

const creator = aliasedTable(users, "unit_creator");

async function materialOf(q: DbOrTx, ctx: AuthContext, materialId: string) {
  const [m] = await q.select().from(materials).where(and(eq(materials.id, materialId), eq(materials.organizationId, ctx.organizationId))).limit(1);
  if (!m) throw new DomainError("not_found", "Material not found.", { field: "materialId" });
  return m;
}

/** The units of one material, newest version first per unit, with who added them (material page, wizard). */
export async function listMaterialUnits(ctx: AuthContext, materialId: string, opts: { includeRetired?: boolean } = {}) {
  ctx.require("masterdata.material.view");
  assertUuid(materialId, "Material");
  await materialOf(db, ctx, materialId);
  const rows = await db
    .select({ u: materialUnits, by: creator.displayName })
    .from(materialUnits)
    .innerJoin(creator, eq(creator.id, materialUnits.createdBy))
    .where(and(eq(materialUnits.materialId, materialId), eq(materialUnits.organizationId, ctx.organizationId), opts.includeRetired ? undefined : eq(materialUnits.status, "active")))
    .orderBy(asc(materialUnits.kind), asc(sql`lower(${materialUnits.name})`), desc(materialUnits.versionNo));
  const used = rows.length ? await db.select({ id: bomLines.materialUnitId, n: sql<number>`count(*)::int` }).from(bomLines).where(inArray(bomLines.materialUnitId, rows.map((r) => r.u.id))).groupBy(bomLines.materialUnitId) : [];
  return rows.map((r) => ({ ...r.u, createdByName: r.by, recipeLines: used.find((x) => x.id === r.u.id)?.n ?? 0 }));
}

/** Active units of many materials for pickers (no permission beyond the caller's form permission). */
export async function materialUnitOptions(q: DbOrTx, organizationId: string, materialIds: string[]) {
  if (!materialIds.length) return [];
  return q
    .select({ id: materialUnits.id, materialId: materialUnits.materialId, kind: materialUnits.kind, name: materialUnits.name, qtyPerUnit: materialUnits.qtyPerUnit, baseUom: materialUnits.baseUom, versionNo: materialUnits.versionNo })
    .from(materialUnits)
    .where(and(eq(materialUnits.organizationId, organizationId), inArray(materialUnits.materialId, materialIds), eq(materialUnits.status, "active")))
    .orderBy(asc(materialUnits.kind), asc(materialUnits.name));
}

/** A unit version by id inside the organization (any status: recipe lines keep retired versions). */
export async function materialUnitById(q: DbOrTx, organizationId: string, id: string) {
  const [u] = await q.select().from(materialUnits).where(and(eq(materialUnits.id, id), eq(materialUnits.organizationId, organizationId))).limit(1);
  return u ?? null;
}

function checkUnitFor(m: { name: string; baseUom: string; status: string }, kind: "pack" | "volume", name: string, qty: string) {
  if (m.status === "discontinued") throw new DomainError("state", `${m.name} is no longer used. Units cannot be added.`);
  if (kind === "volume") {
    if (m.baseUom === "pcs") throw new DomainError("validation", `${m.name} is counted in pieces; it has no mL.`, { fieldErrors: { kind: "Pieces have no mL." } });
    if (m.baseUom === "mL" && !new Decimal(qty).eq(1)) throw new DomainError("validation", `${m.name} is kept in mL, so 1 mL is 1 mL.`, { fieldErrors: { qtyPerUnit: "For a mL material this is 1." } });
    if (new Decimal(qty).gt(25)) throw new DomainError("validation", "That is too heavy for 1 mL. Type grams in 1 mL (most liquids are 0.7 to 2).", { fieldErrors: { qtyPerUnit: "Grams in 1 mL, for example 0.92." } });
    return "mL";
  }
  const n = name.trim();
  if (!/^[A-Za-z][A-Za-z ]{0,29}$/.test(n)) throw new DomainError("validation", "Name it with letters, for example sachet, bottle or drum.", { fieldErrors: { name: "Letters only, like sachet." } });
  if (RESERVED.has(n.toLowerCase())) throw new DomainError("validation", `"${n}" is already a stock unit. Use a pack name like sachet, bottle or drum.`, { fieldErrors: { name: "Use a pack name." } });
  return n.toLowerCase();
}

/** "Add a pack size" / "Add mL" on the material page (and inline in the wizard). */
export async function addMaterialUnit(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.material.edit");
  const v = parseInput(AddInput, raw);
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, v.idempotencyKey, "masterdata.material_unit.add", async () => {
      const [m] = await tx.select().from(materials).where(and(eq(materials.id, v.materialId), eq(materials.organizationId, ctx.organizationId))).for("update").limit(1);
      if (!m) throw new DomainError("not_found", "Material not found.", { field: "materialId" });
      const name = checkUnitFor(m, v.kind, v.name, v.qtyPerUnit);
      const [dupe] = await tx.select({ id: materialUnits.id }).from(materialUnits).where(and(eq(materialUnits.materialId, m.id), eq(materialUnits.status, "active"), sql`lower(${materialUnits.name}) = ${name.toLowerCase()}`)).limit(1);
      if (dupe) throw new DomainError("conflict", v.kind === "volume" ? `${m.name} already has its mL. Use "Change" to give a new number.` : `${m.name} already has a unit called "${name}". Use "Change" to give a new size.`, { fieldErrors: { name: "Already there." } });
      const [row] = await tx
        .insert(materialUnits)
        .values({ organizationId: ctx.organizationId, materialId: m.id, unitKey: uuidv7(), versionNo: 1, kind: v.kind, name, qtyPerUnit: new Decimal(v.qtyPerUnit).toString(), baseUom: m.baseUom, note: v.note, createdBy: ctx.userId })
        .returning();
      await audit(tx, ctx, {
        action: "masterdata.material_unit.added",
        entityType: "material_unit",
        entityId: row.id,
        entityNumber: m.code,
        siteId: null,
        after: { material: m.code, materialName: m.name, kind: row.kind, name: row.name, qtyPerUnit: row.qtyPerUnit, baseUom: row.baseUom, versionNo: 1 },
      });
      return { unitId: row.id, name: row.name, qtyPerUnit: row.qtyPerUnit, baseUom: row.baseUom };
    });
    return result;
  });
}

async function lockUnit(tx: DbOrTx, ctx: AuthContext, unitId: string) {
  const [u] = await tx.select().from(materialUnits).where(and(eq(materialUnits.id, unitId), eq(materialUnits.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!u) throw new DomainError("not_found", "Unit not found.");
  if (u.status !== "active") throw new DomainError("state", `"${u.name}" is no longer used. Add a new unit instead.`);
  return u;
}

/**
 * "Change the size": the version is retired and version n+1 is added with the new number (the old number stays on every
 * recipe line, batch and record that used it). New recipe lines get the new number; an approved recipe keeps its own.
 */
export async function changeMaterialUnit(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.material.edit");
  const v = parseInput(ChangeInput, raw);
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, v.idempotencyKey, "masterdata.material_unit.change", async () => {
      const u = await lockUnit(tx, ctx, v.unitId);
      const m = await materialOf(tx, ctx, u.materialId);
      checkUnitFor(m, u.kind as "pack" | "volume", u.name, v.qtyPerUnit);
      if (new Decimal(u.qtyPerUnit).eq(v.qtyPerUnit)) throw new DomainError("validation", "That is the same number. Nothing to change.", { fieldErrors: { qtyPerUnit: "Same as now." } });
      const now = new Date();
      await tx.update(materialUnits).set({ status: "retired", retiredBy: ctx.userId, retiredAt: now, retiredReason: v.reason }).where(eq(materialUnits.id, u.id));
      const [row] = await tx
        .insert(materialUnits)
        .values({ organizationId: ctx.organizationId, materialId: m.id, unitKey: u.unitKey, versionNo: u.versionNo + 1, kind: u.kind, name: u.name, qtyPerUnit: new Decimal(v.qtyPerUnit).toString(), baseUom: m.baseUom, note: u.note, supersedesId: u.id, createdBy: ctx.userId })
        .returning();
      await audit(tx, ctx, {
        action: "masterdata.material_unit.changed",
        entityType: "material_unit",
        entityId: row.id,
        entityNumber: m.code,
        siteId: null,
        reason: v.reason,
        before: { qtyPerUnit: u.qtyPerUnit, versionNo: u.versionNo, unitId: u.id },
        after: { material: m.code, name: row.name, qtyPerUnit: row.qtyPerUnit, baseUom: row.baseUom, versionNo: row.versionNo },
      });
      return { unitId: row.id, versionNo: row.versionNo };
    });
    return result;
  });
}

/** "Stop using": the unit is no longer offered for new recipe lines; lines that use it keep it. */
export async function retireMaterialUnit(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.material.edit");
  const v = parseInput(RetireInput, raw);
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, v.idempotencyKey, "masterdata.material_unit.retire", async () => {
      const u = await lockUnit(tx, ctx, v.unitId);
      const m = await materialOf(tx, ctx, u.materialId);
      await tx.update(materialUnits).set({ status: "retired", retiredBy: ctx.userId, retiredAt: new Date(), retiredReason: v.reason }).where(eq(materialUnits.id, u.id));
      await audit(tx, ctx, {
        action: "masterdata.material_unit.retired",
        entityType: "material_unit",
        entityId: u.id,
        entityNumber: m.code,
        siteId: null,
        reason: v.reason,
        before: { status: "active" },
        after: { status: "retired", name: u.name, qtyPerUnit: u.qtyPerUnit },
      });
      return { unitId: u.id };
    });
    return result;
  });
}
