import { D } from "@/lib/qty";

/** Plain words and friendly units for stock (grade-5, ADR-088 / ADR-090). Pure: safe on server, client and in unit tests. */

/**
 * Quantity in friendly warehouse units (ADR-090): grams as kg and mL as L from 1,000, no trailing zeros
 * ("12.5 kg", "3 kg", "250 g", "48 pcs"), thousands grouped. Same rule as the server's `fmtStock`, but
 * safe for client components. Zero grams reads "0 kg" (the owner thinks of oils in kg, not grams).
 */
export function fmtLotQty(v: string | number | null | undefined, uom: string): string {
  let d = D(v ?? 0);
  let u = uom;
  const metric = uom === "g" || uom === "mL" || uom === "ml";
  if (d.isZero() && metric) return uom === "g" ? "0 kg" : "0 L";
  if (metric && d.abs().gte(1000)) {
    d = d.div(1000);
    u = uom === "g" ? "kg" : "L";
  }
  const dp = d.isInteger() ? 0 : Math.min(d.decimalPlaces(), uom === "pcs" ? 0 : 2);
  const [int, rawFrac] = d.toFixed(dp).split(".");
  const frac = rawFrac?.replace(/0+$/, ""); // "3.00 kg" reads as "3 kg"
  const sign = int.startsWith("-") ? "-" : "";
  const grouped = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${frac ? `${grouped}.${frac}` : grouped} ${u}`;
}

/** Plain words for a lot's quality status (grade-5, ADR-088): the same words as the stock list chips. */
export const LOT_STATUS_WORDS: Record<string, string> = {
  released: "Ready to use",
  quarantine: "Waiting for QA check",
  on_hold: "Stopped by QA",
  expired: "Expired – do not use",
  rejected: "Rejected – do not use",
  recalled: "Recalled – do not use",
};

/** What kind of place a shelf is, in plain words (no "quarantine", no "staging"). */
export const LOCATION_KIND_WORDS: Record<string, string> = {
  storage: "Shelf",
  quarantine: "Waiting for QA check",
  hold: "Stopped by QA",
  rejected: "Rejected goods",
  receiving: "Receiving area",
  production: "Making room",
  shipping: "Sending-out area",
};

/** Stock change types in plain words (grade-5, ADR-088). The codes stay on the server. */
export const MOVEMENT_LABEL: Record<string, string> = {
  receipt: "Received",
  issue: "Sent to another site",
  transfer: "Moved",
  consumption: "Used in making",
  output: "Made here",
  adjustment: "Stock fixed",
  shipment: "Sent to customer",
  return: "Customer sent back",
  reversal: "Undo (kept on record)",
};

/** Box and sack states in plain words. */
export const BOX_STATUS_WORDS: Record<string, string> = { open: "Open", sealed: "Closed", in_transit: "On the way", empty: "Empty", void: "Cancelled", shipped: "Sent out" };

/** "From A-01 to FG-01" in words: shelf names when known, never an arrow between codes. */
export function placeWords(from: string | null | undefined, to: string | null | undefined): string {
  if (from && to) return `from ${from} to ${to}`;
  if (to) return `into ${to}`;
  if (from) return `out of ${from}`;
  return "";
}
