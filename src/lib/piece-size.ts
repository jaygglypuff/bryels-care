import Decimal from "decimal.js";

/**
 * The size of one piece in the words people use (live check 2026-11-06, finding 7): a liquid sold by volume shows
 * its volume ("250 mL a bottle"), a soap its mass per bar ("135 g a bar"), anything else its mass per piece. The
 * volume comes from the product's sellable item (SKU net content in mL or L); the product's net mass stays the
 * number that turns a batch's mass into pieces. Pure.
 */
export type PieceSizeInput = { family?: string | null; unitNetMassG: Decimal.Value | null | undefined; netContentQty?: Decimal.Value | null; netContentUom?: string | null };

const VOLUME_UNITS = new Set(["ml", "l"]);

function trimNumber(v: Decimal.Value): string {
  return new Decimal(v).toDecimalPlaces(2).toNumber().toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

export function pieceSizeWords(p: PieceSizeInput): string {
  const uom = (p.netContentUom ?? "").trim();
  if (p.netContentQty !== null && p.netContentQty !== undefined && p.netContentQty !== "" && VOLUME_UNITS.has(uom.toLowerCase())) {
    return `${trimNumber(p.netContentQty)} ${uom === "l" ? "L" : uom} a bottle`;
  }
  const noun = (p.family ?? "").toLowerCase().includes("soap") ? "bar" : "piece";
  return `${trimNumber(p.unitNetMassG ?? 0)} g a ${noun}`;
}
