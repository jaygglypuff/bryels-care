import "server-only";
import { aliasedTable, and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { UOM_DIMENSIONS, materials, uomConversions, uoms, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertUuid, bool, diff, optText, optUuid, reqText, uniqueConflict } from "./org-common";
import { parseInput } from "./schemas";
import { type ConversionStep, type Quantity, enteredEqualsBase, toBasePair } from "./uom-math";

/**
 * Units of measure and versioned conversions (US-1-21, ADR-010). Every role can read the lists
 * (`masterdata.uom.view`, `masterdata.uom_conversion.view`); `admin` edits. A conversion change is
 * proposed by one admin and approved by a second (separation of duties); only approved versions are
 * used by the ledger. g → mL without a material is refused (UOM_DIMENSION_MISMATCH, service + trigger).
 */

/* ------------------------------------------------------------------ units */

const UomCreateInput = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,15}$/, "Unit code: letters, digits or underscore, starting with a letter (max 16), e.g. kg, drum25."),
    name: reqText("the unit name", 60),
    dimension: z.enum(UOM_DIMENSIONS, { message: "Choose what the unit measures." }),
    isBase: bool(false),
  })
  .strict();
const UomUpdateInput = z.object({ name: reqText("the unit name", 60), isActive: bool(true) }).strict();

export type UomRow = typeof uoms.$inferSelect;

export async function listUoms(ctx: AuthContext, opts: { includeInactive?: boolean } = {}) {
  ctx.require("masterdata.uom.view");
  return db
    .select()
    .from(uoms)
    .where(and(eq(uoms.organizationId, ctx.organizationId), opts.includeInactive ? undefined : eq(uoms.isActive, true)))
    .orderBy(asc(uoms.dimension), desc(uoms.isBase), asc(uoms.code));
}

/** Active units for pickers (no permission needed beyond the caller's form permission). */
export async function uomOptions(q: DbOrTx, organizationId: string, opts: { baseOnly?: boolean; dimension?: string } = {}) {
  return q
    .select({ id: uoms.id, code: uoms.code, name: uoms.name, dimension: uoms.dimension, isBase: uoms.isBase })
    .from(uoms)
    .where(and(eq(uoms.organizationId, organizationId), eq(uoms.isActive, true), opts.baseOnly ? eq(uoms.isBase, true) : undefined, opts.dimension ? eq(uoms.dimension, opts.dimension) : undefined))
    .orderBy(asc(uoms.dimension), desc(uoms.isBase), asc(uoms.code));
}

export async function createUom(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.uom.admin");
  const v = parseInput(UomCreateInput, raw);
  return db.transaction(async (tx) => {
    if (v.isBase) {
      const [base] = await tx.select({ code: uoms.code }).from(uoms).where(and(eq(uoms.organizationId, ctx.organizationId), eq(uoms.dimension, v.dimension), eq(uoms.isBase, true))).limit(1);
      if (base) throw new DomainError("conflict", `${v.dimension} already has its base unit (${base.code}). A dimension has exactly one base unit.`, { field: "isBase" });
    }
    const [dupe] = await tx
      .select({ code: uoms.code })
      .from(uoms)
      .where(and(eq(uoms.organizationId, ctx.organizationId), sql`lower(${uoms.code}) = lower(${v.code})`))
      .limit(1);
    if (dupe) throw new DomainError("conflict", `Unit ${dupe.code} already exists.`, { field: "code" });
    const [u] = await tx
      .insert(uoms)
      .values({ organizationId: ctx.organizationId, ...v, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning()
      .catch((e) => uniqueConflict(e, `Unit ${v.code} already exists.`));
    await audit(tx, ctx, { action: "masterdata.uom.created", entityType: "uom", entityId: u.id, entityNumber: u.code, siteId: null, after: v });
    return u;
  });
}

/** Renames or (de)activates a unit; the code and dimension never change (trigger tg_uoms_code_immutable). */
export async function updateUom(ctx: AuthContext, uomId: string, raw: unknown) {
  ctx.require("masterdata.uom.admin");
  assertUuid(uomId, "Unit");
  const v = parseInput(UomUpdateInput, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(uoms).where(and(eq(uoms.id, uomId), eq(uoms.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Unit not found.");
    if (!v.isActive && before.isBase) throw new DomainError("state", `${before.code} is the base unit for ${before.dimension}; a base unit cannot be deactivated.`, { field: "isActive" });
    const [after] = await tx.update(uoms).set({ ...v, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(uoms.id, uomId)).returning();
    const d = diff(before, after, ["name", "isActive"]);
    if (d.changed.length) await audit(tx, ctx, { action: "masterdata.uom.updated", entityType: "uom", entityId: after.id, entityNumber: after.code, siteId: null, before: d.before, after: d.after });
    return after;
  });
}

/* ------------------------------------------------------------------ conversions */

const ConversionInput = z
  .object({
    fromUomId: z.string().uuid("Choose the unit to convert from."),
    toUomId: z.string().uuid("Choose the unit to convert to."),
    factor: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,12})?$/, "Enter the factor as a positive number (at most 12 decimals)."),
    materialId: optUuid,
    reason: optText(500),
    idempotencyKey: optText(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Decimal(v.factor).lte(0)) c.addIssue({ code: "custom", path: ["factor"], message: "The factor must be greater than zero." });
    if (v.fromUomId === v.toUomId) c.addIssue({ code: "custom", path: ["toUomId"], message: "Choose two different units." });
  });

const DecideInput = z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), note: optText(500) }).strict();

export const UOM_CONVERSION_TRANSITIONS = {
  pending_approval: ["approved", "rejected"],
  approved: ["retired"],
  rejected: [],
  retired: [],
} as const;

const fromU = aliasedTable(uoms, "from_u");
const toU = aliasedTable(uoms, "to_u");
const submitter = aliasedTable(users, "submitter");
const approver = aliasedTable(users, "approver");

export async function listConversions(ctx: AuthContext, opts: { status?: string } = {}) {
  ctx.require("masterdata.uom_conversion.view");
  return db
    .select({
      id: uomConversions.id,
      fromCode: fromU.code,
      fromDimension: fromU.dimension,
      toCode: toU.code,
      toDimension: toU.dimension,
      factor: uomConversions.factor,
      materialId: uomConversions.materialId,
      materialCode: materials.code,
      materialName: materials.name,
      revisionNo: uomConversions.revisionNo,
      status: uomConversions.status,
      isSystem: uomConversions.isSystem,
      changeReason: uomConversions.changeReason,
      submittedById: uomConversions.submittedBy,
      submittedBy: submitter.displayName,
      submittedAt: uomConversions.submittedAt,
      approvedBy: approver.displayName,
      approvedAt: uomConversions.approvedAt,
      decisionNote: uomConversions.decisionNote,
      effectiveFrom: uomConversions.effectiveFrom,
      effectiveTo: uomConversions.effectiveTo,
    })
    .from(uomConversions)
    .innerJoin(fromU, eq(fromU.id, uomConversions.fromUomId))
    .innerJoin(toU, eq(toU.id, uomConversions.toUomId))
    .leftJoin(materials, eq(materials.id, uomConversions.materialId))
    .leftJoin(submitter, eq(submitter.id, uomConversions.submittedBy))
    .leftJoin(approver, eq(approver.id, uomConversions.approvedBy))
    .where(and(eq(uomConversions.organizationId, ctx.organizationId), opts.status ? eq(uomConversions.status, opts.status) : undefined))
    .orderBy(asc(fromU.code), asc(toU.code), asc(materials.code), desc(uomConversions.revisionNo));
}

const sameMaterial = (materialId: string | null) => (materialId ? eq(uomConversions.materialId, materialId) : isNull(uomConversions.materialId));

/**
 * Proposes a new conversion version (status pending_approval). A second admin approves it; the
 * approved version then replaces the previous one for the same units (and material).
 */
export async function proposeConversion(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.uom_conversion.admin");
  const v = parseInput(ConversionInput, raw);
  return db.transaction(async (tx) => {
    const units = await tx.select().from(uoms).where(and(eq(uoms.organizationId, ctx.organizationId), inArray(uoms.id, [v.fromUomId, v.toUomId])));
    const from = units.find((u) => u.id === v.fromUomId);
    const to = units.find((u) => u.id === v.toUomId);
    if (!from || !to) throw new DomainError("not_found", "Unit not found.");
    if (!from.isActive || !to.isActive) throw new DomainError("state", "Both units must be active.");
    if (from.dimension !== to.dimension && !v.materialId) {
      throw new DomainError("validation", `UOM_DIMENSION_MISMATCH: ${from.code} (${from.dimension}) cannot be converted to ${to.code} (${to.dimension}) without a material. Choose the material whose density makes this conversion valid.`, {
        field: "materialId",
        reason: "UOM_DIMENSION_MISMATCH",
      });
    }
    if (v.materialId) {
      const [m] = await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.id, v.materialId), eq(materials.organizationId, ctx.organizationId))).limit(1);
      if (!m) throw new DomainError("not_found", "Material not found.", { field: "materialId" });
    }
    const [inverse] = await tx
      .select({ id: uomConversions.id })
      .from(uomConversions)
      .where(and(eq(uomConversions.organizationId, ctx.organizationId), eq(uomConversions.fromUomId, v.toUomId), eq(uomConversions.toUomId, v.fromUomId), sameMaterial(v.materialId), inArray(uomConversions.status, ["approved", "pending_approval"])))
      .limit(1);
    if (inverse) throw new DomainError("conflict", `A conversion from ${to.code} to ${from.code} already exists; it is used in both directions. Change that conversion instead.`, { field: "fromUomId" });
    const versions = await tx
      .select({ id: uomConversions.id, status: uomConversions.status, revisionNo: uomConversions.revisionNo, factor: uomConversions.factor })
      .from(uomConversions)
      .where(and(eq(uomConversions.organizationId, ctx.organizationId), eq(uomConversions.fromUomId, v.fromUomId), eq(uomConversions.toUomId, v.toUomId), sameMaterial(v.materialId)))
      .orderBy(desc(uomConversions.revisionNo))
      .for("update");
    if (versions.some((x) => x.status === "pending_approval")) throw new DomainError("conflict", `A change of ${from.code} → ${to.code} is already waiting for approval.`, { field: "factor" });
    const current = versions.find((x) => x.status === "approved");
    if (current && new Decimal(current.factor).eq(v.factor)) throw new DomainError("validation", "The factor is the same as the approved version.", { field: "factor" });
    const [row] = await tx
      .insert(uomConversions)
      .values({
        organizationId: ctx.organizationId,
        fromUomId: v.fromUomId,
        toUomId: v.toUomId,
        factor: v.factor,
        materialId: v.materialId,
        revisionNo: (versions[0]?.revisionNo ?? 0) + 1,
        status: "pending_approval",
        supersedesId: current?.id ?? null,
        changeReason: v.reason,
        submittedBy: ctx.userId,
      })
      .returning()
      .catch((e) => uniqueConflict(e, `A change of ${from.code} → ${to.code} is already waiting for approval.`, "factor"));
    await audit(tx, ctx, {
      action: "masterdata.uom_conversion.submitted",
      entityType: "uom_conversion",
      entityId: row.id,
      entityNumber: `${from.code}->${to.code}`,
      siteId: null,
      reason: v.reason,
      before: current ? { factor: current.factor } : null,
      after: { factor: row.factor, materialId: row.materialId, revisionNo: row.revisionNo },
    });
    return row;
  });
}

/** Second-user decision on a proposed conversion version (approver ≠ submitter, also a DB check). */
export async function decideConversion(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.uom_conversion.admin");
  const v = parseInput(DecideInput, raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(uomConversions).where(and(eq(uomConversions.id, v.id), eq(uomConversions.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!row) throw new DomainError("not_found", "Conversion not found.");
    if (!(UOM_CONVERSION_TRANSITIONS[row.status as keyof typeof UOM_CONVERSION_TRANSITIONS] as readonly string[]).includes(v.decision)) {
      throw new DomainError("state", `This conversion is ${row.status.replace("_", " ")}; it cannot be ${v.decision}.`);
    }
    if (row.submittedBy === ctx.userId) throw new DomainError("separation_of_duties", "You proposed this conversion; a second administrator must decide it.");
    if (v.decision === "rejected" && !v.note) throw new DomainError("validation", "Give the reason for rejecting.", { field: "note" });
    const [units] = await tx
      .select({ from: fromU.code, to: toU.code })
      .from(uomConversions)
      .innerJoin(fromU, eq(fromU.id, uomConversions.fromUomId))
      .innerJoin(toU, eq(toU.id, uomConversions.toUomId))
      .where(eq(uomConversions.id, row.id));
    const label = `${units.from}->${units.to}`;
    const now = new Date();
    let previous: { id: string; factor: string } | null = null;
    if (v.decision === "approved") {
      const [cur] = await tx
        .select({ id: uomConversions.id, factor: uomConversions.factor })
        .from(uomConversions)
        .where(and(eq(uomConversions.organizationId, ctx.organizationId), eq(uomConversions.fromUomId, row.fromUomId), eq(uomConversions.toUomId, row.toUomId), sameMaterial(row.materialId), eq(uomConversions.status, "approved")))
        .for("update")
        .limit(1);
      if (cur) {
        previous = cur;
        await tx.update(uomConversions).set({ status: "retired", effectiveTo: now }).where(eq(uomConversions.id, cur.id));
      }
    }
    const [after] = await tx
      .update(uomConversions)
      .set(v.decision === "approved" ? { status: "approved", approvedBy: ctx.userId, approvedAt: now, effectiveFrom: now, decisionNote: v.note } : { status: "rejected", decisionNote: v.note })
      .where(eq(uomConversions.id, row.id))
      .returning();
    await audit(tx, ctx, {
      action: v.decision === "approved" ? "masterdata.uom_conversion.approved" : "masterdata.uom_conversion.rejected",
      entityType: "uom_conversion",
      entityId: row.id,
      entityNumber: label,
      siteId: null,
      reason: v.note,
      before: { factor: previous?.factor ?? null, status: row.status },
      after: { factor: after.factor, status: after.status, revisionNo: after.revisionNo, materialId: after.materialId },
    });
    return after;
  });
}

/* ------------------------------------------------------------------ conversion lookup (ledger, receiving, dispensing) */

/**
 * Finds the approved conversion step between two unit codes. A material-specific version wins over
 * the generic one; a row is usable forward (from → to) or in reverse. Null when none exists.
 */
export async function findConversionStep(q: DbOrTx, organizationId: string, fromCode: string, toCode: string, materialId?: string | null): Promise<ConversionStep | null> {
  if (fromCode === toCode) return { factor: "1", direction: "forward" };
  const rows = await q
    .select({ fromCode: fromU.code, toCode: toU.code, factor: uomConversions.factor, materialId: uomConversions.materialId })
    .from(uomConversions)
    .innerJoin(fromU, eq(fromU.id, uomConversions.fromUomId))
    .innerJoin(toU, eq(toU.id, uomConversions.toUomId))
    .where(
      and(
        eq(uomConversions.organizationId, organizationId),
        eq(uomConversions.status, "approved"),
        or(and(eq(fromU.code, fromCode), eq(toU.code, toCode)), and(eq(fromU.code, toCode), eq(toU.code, fromCode))),
        materialId ? or(isNull(uomConversions.materialId), eq(uomConversions.materialId, materialId)) : isNull(uomConversions.materialId),
      ),
    );
  const ranked = rows.sort((a, b) => Number(!!b.materialId) - Number(!!a.materialId) || Number(b.fromCode === fromCode) - Number(a.fromCode === fromCode));
  const r = ranked[0];
  if (!r) return null;
  return { factor: r.factor, direction: r.fromCode === fromCode ? "forward" : "reverse" };
}

/**
 * Ledger check (ADR-010, V-UOM): the quantity the user typed must equal the base quantity under an
 * approved conversion. Returns the entered pair to store on the movement. Replaces the fixed
 * METRIC_FACTORS of the MVP ledger; the same metric factors are installed as approved reference rows.
 */
export async function checkEnteredQuantity(q: DbOrTx, organizationId: string, qtyBase: Decimal, baseUom: string, entered: { qty: Decimal.Value; uom: string } | undefined, materialId?: string | null): Promise<{ qty: Decimal; uom: string }> {
  if (!entered) return { qty: qtyBase, uom: baseUom };
  const eq_ = new Decimal(entered.qty);
  if (!eq_.isFinite() || eq_.lte(0)) throw new DomainError("validation", "Entered quantity must be greater than zero.");
  const step = await findConversionStep(q, organizationId, entered.uom, baseUom, materialId);
  if (!step) throw new DomainError("validation", `Quantities of this lot are entered in ${baseUom}; ${entered.uom} has no approved conversion.`);
  if (!enteredEqualsBase(eq_, qtyBase, step)) {
    throw new DomainError("validation", `Entered ${eq_.toString()} ${entered.uom} does not equal ${qtyBase.toString()} ${baseUom}.`);
  }
  return { qty: eq_, uom: entered.uom };
}

/**
 * The helper every quantity-bearing row uses (US-1-21 AC2): returns both the entered and the base
 * quantity (exact, decimal.js), or a 422 when the unit cannot be converted exactly.
 */
export async function toBaseQuantity(q: DbOrTx, organizationId: string, entered: Quantity, baseUom: string, materialId?: string | null): Promise<{ entered: Quantity; base: Quantity }> {
  const step = await findConversionStep(q, organizationId, entered.uom, baseUom, materialId);
  const pair = toBasePair(entered, baseUom, step);
  if (!pair) {
    throw new DomainError("validation", step ? `${entered.qty} ${entered.uom} cannot be expressed exactly in ${baseUom}; enter the quantity in ${baseUom}.` : `${entered.uom} cannot be converted to ${baseUom}: no approved conversion.`, { field: "uom" });
  }
  return pair;
}

/** Units a quantity of this base unit may be entered in (approved conversions, incl. the material's own). */
export async function enterableUnits(q: DbOrTx, organizationId: string, baseUom: string, materialId?: string | null): Promise<string[]> {
  const rows = await q
    .select({ fromCode: fromU.code, toCode: toU.code })
    .from(uomConversions)
    .innerJoin(fromU, eq(fromU.id, uomConversions.fromUomId))
    .innerJoin(toU, eq(toU.id, uomConversions.toUomId))
    .where(
      and(
        eq(uomConversions.organizationId, organizationId),
        eq(uomConversions.status, "approved"),
        or(eq(fromU.code, baseUom), eq(toU.code, baseUom)),
        materialId ? or(isNull(uomConversions.materialId), eq(uomConversions.materialId, materialId)) : isNull(uomConversions.materialId),
      ),
    );
  return [baseUom, ...new Set(rows.map((r) => (r.fromCode === baseUom ? r.toCode : r.fromCode)))];
}
