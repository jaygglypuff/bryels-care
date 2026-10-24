import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { alias } from "drizzle-orm/pg-core";
import { REASON_CATEGORIES, materials, reasonCodes, uomConversions, uoms, type ReasonCategory } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { createReasonCode, proposeConversion } from "@/modules/masterdata";
import type { ExistingMatch, ImportKindHandler } from "./types";

/**
 * Reference lists (W3C additions to docs/data-migration-plan.md §9.2): unit conversions are proposed
 * through the UOM service (US-1-21) and stay `pending_approval` until a second administrator approves
 * them on the Units of measure screen; reason codes go through the reason code service (US-1-24).
 */
type ConversionValues = { fromUom: string; toUom: string; factor: string; materialCode: string | null; reason: string | null };

const fromU = alias(uoms, "imp_from_u");
const toU = alias(uoms, "imp_to_u");

export const uomConversionsKind: ImportKindHandler<ConversionValues> = {
  kind: "uom_conversions",
  label: "Unit conversions",
  description: "Pack units and material densities; each one waits for a second administrator's approval.",
  creates: "uom_conversion",
  entityPermissions: ["masterdata.uom_conversion.admin"],
  availability: { available: true },
  columns: [
    { key: "from_uom", label: "From unit", required: true, hint: "Unit code, e.g. drum.", aliases: ["from"] },
    { key: "to_uom", label: "To unit", required: true, hint: "Unit code, e.g. kg.", aliases: ["to"] },
    { key: "factor", label: "Factor", required: true, hint: "1 from-unit = factor × to-unit (up to 12 decimals)." },
    { key: "material_code", label: "Material code", hint: "Required when the units have different dimensions (density, R-16)." },
    { key: "reason", label: "Reason", hint: "Why the conversion is needed (shown to the approver)." },
  ],
  exampleRows: [{ from_uom: "kg", to_uom: "g", factor: "1000", material_code: "", reason: "Sample reference conversion (fictional)" }],
  normalize(r) {
    const fromUom = r.text("from_uom", { required: true, max: 16 });
    const toUom = r.text("to_uom", { required: true, max: 16 });
    const factor = r.decimal("factor", { required: true, positive: true, dp: 12 });
    const v: ConversionValues = { fromUom: fromUom ?? "", toUom: toUom ?? "", factor: factor ?? "", materialCode: r.code("material_code"), reason: r.text("reason", { max: 500 }) };
    if (!fromUom || !toUom || !factor) return null;
    if (fromUom === toUom) {
      r.error("to_uom", "Choose two different units.");
      return null;
    }
    return { values: v, tier1Key: `conv:${fromUom}>${toUom}:${v.materialCode ?? ""}:${new Decimal(factor).toFixed()}` };
  },
  async findExisting(tx, ctx, _job, rows) {
    const out = new Map<number, ExistingMatch>();
    const existing = await tx
      .select({ id: uomConversions.id, from: fromU.code, to: toU.code, factor: uomConversions.factor, materialCode: materials.code, status: uomConversions.status })
      .from(uomConversions)
      .innerJoin(fromU, eq(fromU.id, uomConversions.fromUomId))
      .innerJoin(toU, eq(toU.id, uomConversions.toUomId))
      .leftJoin(materials, eq(materials.id, uomConversions.materialId))
      .where(and(eq(uomConversions.organizationId, ctx.organizationId), inArray(uomConversions.status, ["approved", "pending_approval"])));
    for (const { rowNo, values } of rows) {
      const same = existing.find((e) => e.from === values.fromUom && e.to === values.toUom && (e.materialCode ?? null) === values.materialCode && new Decimal(e.factor).eq(values.factor));
      if (same) out.set(rowNo, { tier: 1, entityType: "uom_conversion", entityId: same.id, label: `${same.from}→${same.to}`, message: `The conversion ${same.from} → ${same.to} with factor ${values.factor} already exists (${same.status.replace("_", " ")}); the row is skipped.` });
    }
    return out;
  },
  async create(k, v) {
    const { tx, ctx } = k;
    const units = await tx.select({ id: uoms.id, code: uoms.code }).from(uoms).where(and(eq(uoms.organizationId, ctx.organizationId), inArray(uoms.code, [v.fromUom, v.toUom])));
    const from = units.find((u) => u.code === v.fromUom);
    const to = units.find((u) => u.code === v.toUom);
    if (!from) throw new DomainError("validation", `Unit ${v.fromUom} is not in the unit list.`, { field: "from_uom" });
    if (!to) throw new DomainError("validation", `Unit ${v.toUom} is not in the unit list.`, { field: "to_uom" });
    let materialId: string | null = null;
    if (v.materialCode) {
      const [m] = await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.code, v.materialCode))).limit(1);
      if (!m) throw new DomainError("validation", `Material ${v.materialCode} not found.`, { field: "material_code" });
      materialId = m.id;
    }
    const row = await proposeConversion(ctx, { fromUomId: from.id, toUomId: to.id, factor: new Decimal(v.factor).toFixed(), materialId, reason: v.reason ?? `Imported by ${k.job.importNumber}` }, { tx });
    return { entityType: "uom_conversion", entityId: row.id, label: `${v.fromUom}→${v.toUom}`, warnings: ["Waits for approval by a second administrator (Units of measure)."] };
  },
};

type ReasonValues = { code: string; name: string; description: string | null; appliesTo: ReasonCategory[]; requiresNote: boolean; requiresApproval: boolean; sortOrder: number | null };

export const reasonCodesKind: ImportKindHandler<ReasonValues> = {
  kind: "reason_codes",
  label: "Reason codes",
  description: "Company reason codes for adjustments, holds, receipts, reprints and other categories.",
  creates: "reason_code",
  entityPermissions: ["masterdata.reason_code.admin"],
  availability: { available: true },
  columns: [
    { key: "code", label: "Code", required: true, hint: "lower-case letters, digits and underscore, e.g. spillage." },
    { key: "name", label: "Label", required: true, hint: "What people see.", aliases: ["label"] },
    { key: "description", label: "Description", hint: "Optional." },
    { key: "applies_to", label: "Categories", required: true, hint: `One or more of ${REASON_CATEGORIES.join(", ")}, separated by | or ;.`, aliases: ["categories"] },
    { key: "requires_note", label: "Needs a note", hint: "yes or no (default no)." },
    { key: "requires_approval", label: "Needs approval", hint: "yes or no (default no)." },
    { key: "sort_order", label: "Sort order", hint: "0–9999 (default 100)." },
  ],
  exampleRows: [{ code: "demo_rodent_damage", name: "Sample: rodent damage (fictional)", description: "", applies_to: "adjustment|hold", requires_note: "yes", requires_approval: "no", sort_order: "120" }],
  normalize(r) {
    const code = r.text("code", { required: true, max: 40 })?.toLowerCase() ?? null;
    if (code && !/^[a-z][a-z0-9_]{0,39}$/.test(code)) r.error("code", `Code "${code}": lower-case letters, digits and underscore, starting with a letter.`);
    const name = r.text("name", { required: true, max: 120 });
    const cats = r
      .raw("applies_to")
      .split(/[|;,]/)
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const bad = cats.filter((c) => !(REASON_CATEGORIES as readonly string[]).includes(c));
    if (!cats.length) r.error("applies_to", "Categories are required.");
    if (bad.length) r.error("applies_to", `Unknown categories: ${bad.join(", ")}.`);
    const v: ReasonValues = {
      code: code ?? "",
      name: name ?? "",
      description: r.text("description", { max: 500 }),
      appliesTo: [...new Set(cats)] as ReasonCategory[],
      requiresNote: r.bool("requires_note", false) ?? false,
      requiresApproval: r.bool("requires_approval", false) ?? false,
      sortOrder: r.int("sort_order", { min: 0, max: 9999 }),
    };
    if (!code || !name || !cats.length || bad.length) return null;
    return { values: v, tier1Key: `code:${code}` };
  },
  async findExisting(tx, ctx, _job, rows) {
    const existing = await tx.select({ id: reasonCodes.id, code: reasonCodes.code }).from(reasonCodes).where(eq(reasonCodes.organizationId, ctx.organizationId));
    const out = new Map<number, ExistingMatch>();
    for (const { rowNo, values } of rows) {
      const e = existing.find((x) => x.code === values.code);
      if (e) out.set(rowNo, { tier: 1, entityType: "reason_code", entityId: e.id, label: e.code, message: `Reason code ${e.code} already exists; the row is skipped.` });
    }
    return out;
  },
  async create(k, v) {
    const r = await createReasonCode(k.ctx, { ...v, sortOrder: v.sortOrder }, { tx: k.tx });
    return { entityType: "reason_code", entityId: r.id, label: r.code };
  },
};

