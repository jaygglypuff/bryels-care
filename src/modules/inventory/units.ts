import Decimal from "decimal.js";
import { DomainError } from "@/lib/errors";
import { toBaseQty } from "@/lib/units";

/**
 * Server side of the warehouse unit picker (usability test 2026-10-30): the typed amount and its unit
 * (kg/g, L/mL, pcs; "20 kg" typed into the box also works) are converted to the lot's base unit here,
 * with decimal.js. Unknown units and units of another kind are refused with a plain message. When no
 * unit is given the amount is read in the base unit (the API before the picker).
 */
export function qtyInputToBase(qty: string | number | null | undefined, uom: string | null | undefined, baseUom: string, opts: { field?: string; where?: string; allowZero?: boolean } = {}): Decimal {
  const r = toBaseQty(qty === null || qty === undefined ? "" : String(qty), uom, baseUom);
  const prefix = opts.where ? `${opts.where}: ` : "";
  if (!r.ok) throw new DomainError("validation", `${prefix}${r.message}`, { field: opts.field ?? "qty" });
  if (!opts.allowZero && r.qtyBase.lte(0)) throw new DomainError("validation", `${prefix}Enter an amount greater than zero.`, { field: opts.field ?? "qty" });
  if (baseUom === "pcs" && !r.qtyBase.isInteger()) throw new DomainError("validation", `${prefix}This item is counted in pieces; enter a whole number.`, { field: opts.field ?? "qty" });
  return r.qtyBase;
}
