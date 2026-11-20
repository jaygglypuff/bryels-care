import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import type { DbOrTx } from "@/db/client";
import { materialUnits } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { type MethodSpec, ADD_METHOD_WORDS, WHOLE_UNIT_METHODS, unitsToStock } from "./add-methods";
import type { BomLineInput } from "./schemas";

/**
 * ADR-137: checks the "How is it added?" fields of formula lines and works out what is stored. The client never decides
 * the numbers that matter: the unit size comes from the material unit version (`material_units`), the stock amount of a
 * line counted or measured in units is units × size, and an allowed difference in units is also stored in the stock unit
 * (`tolerance_abs_g`) so every older reader of the line keeps working. A line that is weighed stays exactly as before.
 *
 * Draft saves accept a unit version that was replaced since (a copied recipe keeps its number until it is chosen again);
 * sending for approval refuses it (`assertUnitsCurrent`).
 */

type Parsed = {
  materialId: string;
  quantityG: string;
  tolerancePct: string | null;
  toleranceAbsG: string | null;
  scaling: "proportional" | "fixed" | "proportional_round";
  addMethod: "weigh" | "count" | "volume" | "whole_container" | "as_needed" | "custom";
  methodQty: string | null;
  materialUnitId: string | null;
  methodUnit: string | null;
  methodUnitQty: string | null;
  toleranceUnits: string | null;
  maxQtyG: string | null;
  rounding: "up" | "down" | "nearest" | null;
  methodSpec: MethodSpec | null;
  operatorNote: string | null;
};

export type StoredMethod = Pick<
  Parsed,
  "quantityG" | "tolerancePct" | "toleranceAbsG" | "scaling" | "addMethod" | "methodQty" | "materialUnitId" | "methodUnit" | "methodUnitQty" | "toleranceUnits" | "maxQtyG" | "rounding" | "methodSpec" | "operatorNote"
>;

const bad = (i: number, field: string, message: string): never => {
  throw new DomainError("validation", `Line ${i + 1}: ${message}`, { fieldErrors: { [`lines.${i}.${field}`]: message } });
};
const isWhole = (v: string) => new Decimal(v).isInteger();

export async function normaliseMethodLines(q: DbOrTx, organizationId: string, lines: (BomLineInput & Parsed)[], materialsById: Map<string, { name: string; baseUom: string; materialKind: string }>): Promise<StoredMethod[]> {
  const unitIds = [...new Set(lines.map((l) => l.materialUnitId).filter((x): x is string => !!x))];
  const units = unitIds.length ? await q.select().from(materialUnits).where(and(eq(materialUnits.organizationId, organizationId), inArray(materialUnits.id, unitIds))) : [];
  return lines.map((l, i) => {
    const m = materialsById.get(l.materialId)!;
    const spec = l.methodSpec ?? {};
    const base: StoredMethod = {
      quantityG: l.quantityG,
      tolerancePct: l.tolerancePct,
      toleranceAbsG: l.toleranceAbsG,
      scaling: l.scaling,
      addMethod: l.addMethod,
      methodQty: null,
      materialUnitId: null,
      methodUnit: null,
      methodUnitQty: null,
      toleranceUnits: null,
      maxQtyG: null,
      rounding: null,
      methodSpec: null,
      operatorNote: l.operatorNote,
    };
    if (l.scaling === "proportional_round" && !l.rounding) bad(i, "rounding", "Say how to round: up, down or to the nearest.");
    if (l.scaling !== "proportional_round" && l.rounding) bad(i, "rounding", "Rounding is only for lines that round to whole units.");
    if (l.addMethod === "weigh") {
      if (l.scaling === "proportional_round") bad(i, "scaling", "A weighed amount is not rounded to whole units.");
      if (l.toleranceUnits !== null && l.toleranceAbsG === null) bad(i, "toleranceUnits", "Give the allowed difference in % or g.");
      return { ...base, toleranceUnits: null };
    }
    if (m.materialKind === "packaging") bad(i, "addMethod", "Packaging is counted at packing, not added here.");
    const unit = l.materialUnitId ? units.find((u) => u.id === l.materialUnitId) : undefined;
    if (l.materialUnitId && (!unit || unit.materialId !== l.materialId)) bad(i, "materialUnitId", `Choose a unit of ${m.name}.`);
    const tolInUnits = (perUnit: string) => {
      // Exactly one of: % or units (units also stored in the stock unit).
      if (l.toleranceUnits !== null) return { tolerancePct: null, toleranceUnits: new Decimal(l.toleranceUnits).toString(), toleranceAbsG: unitsToStock(l.toleranceUnits, perUnit).toString() };
      if (l.tolerancePct !== null) return { tolerancePct: l.tolerancePct, toleranceUnits: null, toleranceAbsG: null };
      return bad(i, "toleranceUnits", "Give the allowed difference: 0 means exactly.");
    };
    const needUnit = (kind: "pack" | "volume", word: string) => {
      if (!unit) return bad(i, "materialUnitId", `Choose ${word} of ${m.name}. Add it on the material page if it is not there.`);
      if (unit.kind !== kind) return bad(i, "materialUnitId", kind === "volume" ? `Choose the mL of ${m.name}.` : `Choose a pack of ${m.name}, like a sachet.`);
      return unit;
    };
    const needQty = (label: string) => (l.methodQty === null ? bad(i, "methodQty", `Type ${label}.`) : l.methodQty);
    switch (l.addMethod) {
      case "count":
      case "whole_container": {
        const u = needUnit("pack", l.addMethod === "count" ? "what you count (a pack)" : "the container");
        const qty = needQty(l.addMethod === "count" ? "how many" : "how many containers");
        if (!isWhole(qty)) bad(i, "methodQty", "Whole units only (1, 2, 3 …).");
        if (l.scaling === "proportional") bad(i, "scaling", "Whole units cannot grow in parts. Choose \"same for every batch\" or \"grow with the batch and round\".");
        const tol = l.addMethod === "whole_container" ? { tolerancePct: null, toleranceUnits: "0", toleranceAbsG: "0" } : tolInUnits(u.qtyPerUnit);
        if (tol.toleranceUnits !== null && !isWhole(tol.toleranceUnits)) bad(i, "toleranceUnits", "Whole units only.");
        return { ...base, ...tol, quantityG: unitsToStock(qty, u.qtyPerUnit).toString(), methodQty: new Decimal(qty).toString(), materialUnitId: u.id, methodUnit: u.name, methodUnitQty: u.qtyPerUnit, rounding: l.rounding, methodSpec: null };
      }
      case "volume": {
        const u = needUnit("volume", "the mL (how many grams in 1 mL)");
        const qty = needQty("how many mL");
        return { ...base, ...tolInUnits(u.qtyPerUnit), quantityG: unitsToStock(qty, u.qtyPerUnit).toString(), methodQty: new Decimal(qty).toString(), materialUnitId: u.id, methodUnit: "mL", methodUnitQty: u.qtyPerUnit, rounding: l.rounding, methodSpec: null };
      }
      case "as_needed": {
        const by = spec.recordBy ?? "weigh";
        if (!spec.reading?.name) bad(i, "methodSpec.reading", "Name the reading that says \"enough\", for example pH.");
        if (spec.reading && spec.reading.min !== null && spec.reading.max !== null && new Decimal(spec.reading.min).gt(spec.reading.max)) bad(i, "methodSpec.reading", "The lowest reading is above the highest.");
        if (l.maxQtyG === null) bad(i, "maxQtyG", "Type the most you may add.");
        if (new Decimal(l.maxQtyG!).lt(l.quantityG)) bad(i, "maxQtyG", "The most you may add is less than your guess.");
        if (l.scaling === "proportional_round") bad(i, "scaling", "An as-needed amount is not rounded.");
        let unitFields: Partial<StoredMethod> = {};
        if (by === "count" || by === "volume") {
          const u = needUnit(by === "count" ? "pack" : "volume", by === "count" ? "what you count" : "the mL");
          unitFields = { materialUnitId: u.id, methodUnit: by === "volume" ? "mL" : u.name, methodUnitQty: u.qtyPerUnit };
        }
        return {
          ...base,
          ...unitFields,
          // The older readers of the line see the band up to the maximum.
          tolerancePct: null,
          toleranceAbsG: new Decimal(l.maxQtyG!).minus(l.quantityG).toString(),
          toleranceUnits: null,
          maxQtyG: new Decimal(l.maxQtyG!).toString(),
          rounding: null,
          methodSpec: { recordBy: by, reading: spec.reading },
        };
      }
      case "custom": {
        const name = spec.customName?.trim();
        if (!name) bad(i, "methodSpec.customName", "Give your way a name, for example \"Scoop with spoon #3\".");
        const unitWord = l.methodUnit?.trim();
        if (!unitWord) bad(i, "methodUnit", "Name the unit, for example scoop.");
        if (l.methodUnitQty !== null) {
          const qty = needQty(`how many ${unitWord}s`);
          return { ...base, ...tolInUnits(l.methodUnitQty), quantityG: unitsToStock(qty, l.methodUnitQty).toString(), methodQty: new Decimal(qty).toString(), materialUnitId: null, methodUnit: unitWord!, methodUnitQty: new Decimal(l.methodUnitQty).toString(), rounding: l.rounding, methodSpec: { customName: name } };
        }
        // Not measured: the operator writes what was used, in the stock unit; quantity_g is the writer's estimate.
        if (l.scaling === "proportional_round") bad(i, "scaling", "Only a measured unit can be rounded.");
        if (l.tolerancePct === null && l.toleranceAbsG === null) bad(i, "tolerancePct", `Give the allowed difference in % or ${m.baseUom}.`);
        return { ...base, toleranceUnits: null, methodUnit: unitWord!, methodSpec: { customName: name } };
      }
      default:
        return bad(i, "addMethod", `Unknown way: ${String(l.addMethod)}.`);
    }
  });
}

/** Sending for approval: every unit a line uses must still be the current size (not replaced or stopped). */
export async function assertUnitsCurrent(q: DbOrTx, lines: { lineNo: number; materialUnitId: string | null }[]) {
  const ids = [...new Set(lines.map((l) => l.materialUnitId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const rows = await q.select().from(materialUnits).where(inArray(materialUnits.id, ids));
  for (const l of lines) {
    const u = rows.find((r) => r.id === l.materialUnitId);
    if (u && u.status !== "active") {
      throw new DomainError("validation", `Line ${l.lineNo}: the size of "${u.name}" changed after this line was made. Open the line and choose "${u.name}" again.`, { rule: "ADR-137", fieldErrors: { [`lines.${l.lineNo - 1}.materialUnitId`]: "Choose it again." } });
    }
  }
}

export const methodLabel = (m: string) => (m in ADD_METHOD_WORDS ? ADD_METHOD_WORDS[m as keyof typeof ADD_METHOD_WORDS].label : m);
export { WHOLE_UNIT_METHODS };
