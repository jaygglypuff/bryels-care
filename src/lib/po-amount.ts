import Decimal from "decimal.js";
import { toBaseQty, unitChoices } from "./units";

type Terms = { baseUom: string; packQty: string | null; packUom: string | null; moqQty: string | null; moqUom: string | null };

/** The supplier's minimum order in base units, or null when none is set or it cannot be converted. */
export function minimumOrderBase(m: Terms): Decimal | null {
  if (!m.moqQty || Number(m.moqQty) <= 0) return null;
  const q = toBaseQty(String(Number(m.moqQty)), m.moqUom ?? m.baseUom, m.baseUom);
  return q.ok ? q.qtyBase : null;
}

/**
 * The amount a new purchase order line starts with (UX audit B #13): the larger of the supplier's minimum order
 * and one standard pack, written in `unit` (the line's starting unit). "Order at least 50 kg" never starts at 18 kg.
 * Empty when neither is known. Pure, decimal.js; unit-tested in tests/unit/po-amount.test.ts.
 */
export function startingOrderQty(m: Terms, unit: string): string {
  if (!unit || !unitChoices(m.baseUom).includes(unit)) return "";
  const pack = m.packQty && m.packUom ? toBaseQty(String(Number(m.packQty)), m.packUom, m.baseUom) : null;
  const packBase = pack && pack.ok ? pack.qtyBase : null;
  const moq = minimumOrderBase(m);
  const best = moq && packBase ? Decimal.max(moq, packBase) : (moq ?? packBase);
  if (!best) return "";
  const one = toBaseQty("1", unit, m.baseUom);
  if (!one.ok) return "";
  return best.div(one.qtyBase).toDecimalPlaces(3, Decimal.ROUND_UP).toString();
}

/** True when the line's amount is below the supplier's minimum order (the last step warns; the server does not refuse). */
export function belowMinimum(m: Terms, qty: string, unit: string): boolean {
  const moq = minimumOrderBase(m);
  if (!moq) return false;
  const q = toBaseQty(qty, unit, m.baseUom);
  return q.ok && q.qtyBase.lt(moq);
}
