import "server-only";
import Decimal from "decimal.js";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { inventoryBalances, inventoryLots, materials, uoms } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { assertTransition, assertUuid, bool, diff, isReferenced, optInt, optText, optionalCode, reqText, scanCode, uniqueConflict } from "./org-common";
import { assignMasterCode } from "@/lib/numbering";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, creatorOf, hardDeleteDraft } from "@/lib/draft-delete";
import { parseInput } from "./schemas";
import { assertLookupValue, lookupOptions } from "./lookups";
import { findConversionStep } from "./uom";
import { toBasePair } from "./uom-math";
import { runInTx, type InTx } from "@/lib/tx";

/**
 * Materials, basic fields (US-1-23, A-PRD-27, A-DM-04). Organization-wide master data: every role
 * with `masterdata.material.view` sees the whole list. The list is an explicit field allow-list
 * (DTO); cost fields do not exist yet and will be added only behind `finance.cost.view` (Phase 2
 * masking, docs/permissions-matrix.md §6). Allergen and hazard notes are free text whose content
 * QA validates; the system never interprets them.
 */
export const MATERIAL_CLASSES = ["raw_material", "packaging", "intermediate", "consumable"] as const;
export type MaterialClass = (typeof MATERIAL_CLASSES)[number];
export const MATERIAL_CLASS_LABELS: Record<MaterialClass, string> = { raw_material: "Raw material", packaging: "Packaging", intermediate: "Intermediate", consumable: "Consumable" };
export const MATERIAL_STATUSES = ["draft", "active", "blocked", "discontinued"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];
/** Material lifecycle; discontinued is final (a replacement is a new material code). */
export const MATERIAL_TRANSITIONS: Record<MaterialStatus, readonly MaterialStatus[]> = {
  draft: ["active", "discontinued"],
  active: ["blocked", "discontinued"],
  blocked: ["active", "discontinued"],
  discontinued: [],
};

const MaterialInput = z
  .object({
    code: scanCode("Material code", "MAT-0070"),
    name: reqText("the material name", 200),
    inciName: optText(300),
    commonName: optText(200),
    materialKind: z.enum(MATERIAL_CLASSES, { message: "Choose the material class." }),
    baseUom: z.string().trim().min(1, "Choose the base unit."),
    shelfLifeDays: optInt("Shelf life", 1, 3650),
    retestDays: optInt("Retest interval", 1, 3650),
    storageConditions: optText(300),
    allergenNotes: optText(1000),
    hazardNotes: optText(1000),
    requiresCoa: bool(true),
    requiresIncomingInspection: bool(true),
    allocationRule: z.enum(["fefo", "fifo"]).default("fefo"),
    // ADR-076. On edit, a field left out keeps its value; "" clears it.
    category: z.union([z.string(), z.null()]).optional(),
    brand: z.union([z.string(), z.null()]).optional(),
    standardPackQty: z.union([z.string(), z.number(), z.null()]).optional(),
    standardPackUom: z.union([z.string(), z.null()]).optional(),
  })
  .strict();
export type MaterialInput = z.input<typeof MaterialInput>;
/** Create: the code may be left blank; the next MAT-nnnn is assigned (ADR-075). */
const CreateInput = MaterialInput.extend({ code: optionalCode(scanCode("Material code", "MAT-0070")), status: z.enum(["draft", "active"]).default("active") }).strict();

/** Fields every list and export may show (DTO allow-list; no cost fields). */
const LIST_FIELDS = {
  id: materials.id,
  code: materials.code,
  name: materials.name,
  inciName: materials.inciName,
  commonName: materials.commonName,
  materialKind: materials.materialKind,
  baseUom: materials.baseUom,
  shelfLifeDays: materials.shelfLifeDays,
  retestDays: materials.retestDays,
  storageConditions: materials.storageConditions,
  allergenNotes: materials.allergenNotes,
  hazardNotes: materials.hazardNotes,
  requiresCoa: materials.requiresCoa,
  requiresIncomingInspection: materials.requiresIncomingInspection,
  allocationRule: materials.allocationRule,
  status: materials.status,
  category: materials.category,
  brand: materials.brand,
  standardPackQty: materials.standardPackQty,
  standardPackUom: materials.standardPackUom,
};

/** Warnings that do not block saving (US-1-23 AC2): INCI missing on an ingredient. Never for packaging or consumables. */
export function materialWarnings(m: { materialKind: string; inciName: string | null }): string[] {
  return (m.materialKind === "raw_material" || m.materialKind === "intermediate") && !m.inciName ? ["INCI name is missing. Ingredients should carry the INCI name declared by the supplier (verified by QA)."] : [];
}

export type MaterialFilter = { q?: string; materialKind?: string; status?: string; category?: string };

export async function listMaterials(ctx: AuthContext, f: MaterialFilter = {}, limit = 2000) {
  ctx.require("masterdata.material.view");
  const q = f.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;
  const rows = await db
    .select({
      ...LIST_FIELDS,
      onHand: sql<string>`coalesce((select sum(b.qty_base) from ${inventoryBalances} b join ${inventoryLots} l on l.id = b.lot_id where l.material_id = "materials"."id" and b.site_id = ${ctx.currentSiteId}), 0)::text`,
    })
    .from(materials)
    .where(
      and(
        eq(materials.organizationId, ctx.organizationId),
        f.materialKind && (MATERIAL_CLASSES as readonly string[]).includes(f.materialKind) ? eq(materials.materialKind, f.materialKind) : undefined,
        f.status && (MATERIAL_STATUSES as readonly string[]).includes(f.status) ? eq(materials.status, f.status) : undefined,
        f.category && f.category.length <= 40 ? eq(materials.category, f.category) : undefined,
        like ? or(ilike(materials.code, like), ilike(materials.name, like), ilike(materials.inciName, like), ilike(materials.commonName, like), ilike(materials.brand, like)) : undefined,
      ),
    )
    .orderBy(asc(materials.code))
    .limit(limit);
  return rows.map((r) => ({ ...r, warnings: materialWarnings(r) }));
}

export async function getMaterial(ctx: AuthContext, materialId: string) {
  ctx.require("masterdata.material.view");
  assertUuid(materialId, "Material");
  const [m] = await db.select(LIST_FIELDS).from(materials).where(and(eq(materials.id, materialId), eq(materials.organizationId, ctx.organizationId))).limit(1);
  if (!m) throw new DomainError("not_found", "Material not found.");
  const inUse = (await isReferenced(db, "materials", m.id)).referenced;
  return { ...m, inUse, warnings: materialWarnings(m) };
}

async function assertBaseUom(q: DbOrTx, organizationId: string, code: string) {
  const [u] = await q.select().from(uoms).where(and(eq(uoms.organizationId, organizationId), eq(uoms.code, code))).limit(1);
  if (!u || !u.isActive) throw new DomainError("validation", `Unit ${code} is not an active unit.`, { field: "baseUom" });
  if (!u.isBase) throw new DomainError("validation", `${code} is not a base unit. Stock is kept in the base unit of its dimension (g, mL or pcs); other units are converted.`, { field: "baseUom" });
}

type ExtraInput = Pick<z.output<typeof MaterialInput>, "category" | "brand" | "standardPackQty" | "standardPackUom">;
type Extra = { category: string | null; brand: string | null; standardPackQty: string | null; standardPackUom: string | null };

/**
 * ADR-076 fields: category from the editable list `material_category`; brand free text (max 80); the
 * standard pack is a quantity > 0 (max 6 decimals) in a unit that converts to the base unit (approved
 * conversion, incl. the material's own pack units). `before` = the stored values on edit (undefined keeps them).
 */
async function extraFields(q: DbOrTx, organizationId: string, v: ExtraInput, baseUom: string, materialId: string | null, before?: Extra): Promise<Extra> {
  const category = v.category === undefined && before ? before.category : await assertLookupValue(q, organizationId, "material_category", v.category ?? null, { field: "category", keep: before?.category });
  const brand = v.brand === undefined ? (before?.brand ?? null) : (v.brand ?? "").trim() || null;
  if (brand && brand.length > 80) throw new DomainError("validation", "Brand: use at most 80 characters.", { field: "brand" });
  if (v.standardPackQty === undefined && v.standardPackUom === undefined && before) {
    return { category, brand, standardPackQty: before.standardPackQty, standardPackUom: before.standardPackUom };
  }
  const rawQty = String(v.standardPackQty ?? "").trim();
  if (!rawQty) return { category, brand, standardPackQty: null, standardPackUom: null };
  let qty: Decimal;
  try {
    qty = new Decimal(rawQty);
  } catch {
    throw new DomainError("validation", "Standard pack: enter a number like 18 or 25.", { field: "standardPackQty" });
  }
  if (!qty.isFinite() || qty.lte(0)) throw new DomainError("validation", "Standard pack must be greater than zero.", { field: "standardPackQty" });
  if (qty.decimalPlaces() > 6 || qty.gt("999999999999")) throw new DomainError("validation", "Standard pack: use at most 6 decimal places.", { field: "standardPackQty" });
  const uom = String(v.standardPackUom ?? "").trim() || baseUom;
  const step = uom === baseUom ? null : await findConversionStep(q, organizationId, uom, baseUom, materialId);
  if (!toBasePair({ qty: qty.toString(), uom }, baseUom, step)) throw new DomainError("validation", `${uom} cannot be converted to the base unit ${baseUom}. Choose a unit with an approved conversion.`, { field: "standardPackUom" });
  return { category, brand, standardPackQty: qty.toString(), standardPackUom: uom };
}

/** `opts.tx`: run inside a caller's transaction (savepoint), e.g. an import chunk (W3C, src/lib/tx.ts). */
export async function createMaterial(ctx: AuthContext, raw: unknown, opts?: InTx) {
  ctx.require("masterdata.material.create");
  const v = parseInput(CreateInput, raw);
  return runInTx(opts, async (tx) => {
    await assertBaseUom(tx, ctx.organizationId, v.baseUom);
    const code = v.code ?? (await assignMasterCode(tx, ctx.organizationId, "MAT", (c) => materialCodeTaken(tx, ctx.organizationId, c)));
    const extra = await extraFields(tx, ctx.organizationId, v, v.baseUom, null);
    const [m] = await tx
      .insert(materials)
      .values({ organizationId: ctx.organizationId, ...v, ...extra, code })
      .returning()
      .catch((e) => uniqueConflict(e, `Material code ${code} is already in use.`));
    await audit(tx, ctx, { action: "masterdata.material.created", entityType: "material", entityId: m.id, entityNumber: m.code, siteId: null, after: { ...v, ...extra, code, codeAssigned: !v.code } });
    return { ...m, warnings: materialWarnings(m) };
  });
}

async function materialCodeTaken(q: DbOrTx, organizationId: string, code: string) {
  const r = await q.select({ id: materials.id }).from(materials).where(and(eq(materials.organizationId, organizationId), eq(materials.code, code))).limit(1);
  return r.length > 0;
}

/**
 * Deletes a material that is still a draft and used nowhere (ADR-075): by its creator or a holder
 * of masterdata.material.edit. Audit masterdata.material.deleted with the row in `before`.
 */
export async function deleteMaterial(ctx: AuthContext, materialId: string) {
  assertUuid(materialId, "Material");
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(materials).where(and(eq(materials.id, materialId), eq(materials.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!m) throw new DomainError("not_found", "Material not found.");
    assertMayDeleteDraft(ctx, { create: "masterdata.material.create", manage: ["masterdata.material.edit"] }, await creatorOf(tx, ctx.organizationId, "material", m.id), null);
    // A material starts active by default; draft or active and used nowhere counts as "never used" (A-DEL-01).
    assertNeverSubmittedDraft(`Material ${m.code}`, m.status === "draft" || m.status === "active");
    await hardDeleteDraft(tx, ctx, {
      table: "materials",
      id: m.id,
      what: `Material ${m.code}`,
      children: [{ table: "material_aliases", column: "material_id" }],
      audit: { action: "masterdata.material.deleted", entityType: "material", entityNumber: m.code, siteId: null, before: m },
    });
    return { deleted: m.code };
  });
}

const FIELDS = ["code", "name", "inciName", "commonName", "materialKind", "baseUom", "shelfLifeDays", "retestDays", "storageConditions", "allergenNotes", "hazardNotes", "requiresCoa", "requiresIncomingInspection", "allocationRule", "category", "brand", "standardPackQty", "standardPackUom"] as const;

/**
 * Edits a material. Code and base unit are fixed once lots, formulas or receipts reference the
 * material (quantities already stored in the old unit would otherwise change meaning).
 */
export async function updateMaterial(ctx: AuthContext, materialId: string, raw: unknown) {
  ctx.require("masterdata.material.edit");
  assertUuid(materialId, "Material");
  const v = parseInput(MaterialInput, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(materials).where(and(eq(materials.id, materialId), eq(materials.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Material not found.");
    if (before.status === "discontinued") throw new DomainError("state", "A discontinued material can no longer be edited.");
    if (v.code !== before.code || v.baseUom !== before.baseUom) {
      const ref = await isReferenced(tx, "materials", before.id);
      if (ref.referenced) throw new DomainError("state", `Material ${before.code} is in use (${ref.by.slice(0, 3).join(", ")}); its code and base unit can no longer change.`, { field: v.code !== before.code ? "code" : "baseUom" });
    }
    if (v.baseUom !== before.baseUom) await assertBaseUom(tx, ctx.organizationId, v.baseUom);
    const extra = await extraFields(tx, ctx.organizationId, v, v.baseUom, before.id, before);
    const [after] = await tx
      .update(materials)
      .set({ ...v, ...extra })
      .where(eq(materials.id, before.id))
      .returning()
      .catch((e) => uniqueConflict(e, `Material code ${v.code} is already in use.`));
    const d = diff(before, after, FIELDS);
    if (d.changed.length) await audit(tx, ctx, { action: "masterdata.material.updated", entityType: "material", entityId: after.id, entityNumber: after.code, siteId: null, before: d.before, after: d.after });
    return { ...after, warnings: materialWarnings(after) };
  });
}

const StatusInput = z.object({ id: z.string().uuid(), status: z.enum(MATERIAL_STATUSES), reason: optText(500) }).strict();

/** Material lifecycle (MATERIAL_TRANSITIONS); blocking or discontinuing needs a reason. */
export async function changeMaterialStatus(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.material.edit");
  const v = parseInput(StatusInput, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(materials).where(and(eq(materials.id, v.id), eq(materials.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Material not found.");
    if (before.status === v.status) return before;
    assertTransition(MATERIAL_TRANSITIONS, before.status as MaterialStatus, v.status, `Material ${before.code}`);
    if ((v.status === "blocked" || v.status === "discontinued") && (!v.reason || v.reason.length < 5)) throw new DomainError("validation", "Give the reason (at least 5 characters).", { field: "reason" });
    const [after] = await tx.update(materials).set({ status: v.status }).where(eq(materials.id, before.id)).returning();
    await audit(tx, ctx, { action: "masterdata.material.updated", entityType: "material", entityId: after.id, entityNumber: after.code, siteId: null, reason: v.reason, before: { status: before.status }, after: { status: after.status } });
    return after;
  });
}

type MaterialRow = Awaited<ReturnType<typeof listMaterials>>[number];

/** Material list export (masterdata.material.export): organization-wide rows, formula-neutralised, audited. */
export const materialsExport: ExportDefinition<MaterialFilter & Record<string, unknown>, MaterialRow> = {
  code: "masterdata.materials",
  title: "Materials",
  permission: "masterdata.material.export",
  sensitivity: "S",
  siteScope: () => [],
  fileName: () => "materials",
  fetch: (ctx, f, limit) => listMaterials(ctx, f, limit),
  columns: [
    { header: "Code", value: (r) => r.code },
    { header: "Name", value: (r) => r.name },
    { header: "INCI name", value: (r) => r.inciName },
    { header: "Common name", value: (r) => r.commonName },
    { header: "Class", value: (r) => r.materialKind },
    { header: "Base unit", value: (r) => r.baseUom },
    { header: "Shelf life (days)", value: (r) => r.shelfLifeDays, numeric: true },
    { header: "Retest (days)", value: (r) => r.retestDays, numeric: true },
    { header: "Storage conditions", value: (r) => r.storageConditions },
    { header: "Allergen notes (QA validated)", value: (r) => r.allergenNotes },
    { header: "Hazard notes (QA validated)", value: (r) => r.hazardNotes },
    { header: "Requires CoA", value: (r) => (r.requiresCoa ? "yes" : "no") },
    { header: "Requires incoming inspection", value: (r) => (r.requiresIncomingInspection ? "yes" : "no") },
    { header: "Allocation", value: (r) => r.allocationRule },
    { header: "Category", value: (r) => r.category },
    { header: "Brand", value: (r) => r.brand },
    { header: "Standard pack", value: (r) => r.standardPackQty },
    { header: "Standard pack unit", value: (r) => r.standardPackUom },
    { header: "Status", value: (r) => r.status },
  ],
};

/** Choices for the material form (ADR-076): categories (editable list) and every active unit for the standard pack. */
export async function materialFormOptions(ctx: AuthContext, opts: { keepCategory?: string | null } = {}) {
  const [categories, units] = await Promise.all([
    lookupOptions(db, ctx.organizationId, "material_category", { keep: opts.keepCategory }),
    db.select({ code: uoms.code, name: uoms.name }).from(uoms).where(and(eq(uoms.organizationId, ctx.organizationId), eq(uoms.isActive, true))).orderBy(asc(uoms.dimension), asc(uoms.code)),
  ]);
  return { categories, packUnits: units };
}
