import Decimal from "decimal.js";

/**
 * "2 boxes · 96 pcs", "48 pcs", "Nothing on it yet" for a delivery row (UX audit B #10): no "box(es)", no
 * "0 box(es) · 0 pcs" for loose pieces, and an empty delivery says so. Pure; unit-tested.
 */
export function deliveryContents(boxes: number, units: string | number | null | undefined): string {
  const u = new Decimal(units ?? 0);
  const pcs = `${u.toDecimalPlaces(0).toNumber().toLocaleString("en-PH")} pcs`;
  if (u.lte(0) && boxes <= 0) return "Nothing on it yet";
  if (boxes <= 0) return pcs;
  return `${boxes === 1 ? "1 box" : `${boxes} boxes`} · ${pcs}`;
}
