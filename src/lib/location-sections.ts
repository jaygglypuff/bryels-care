/**
 * Warehouse sections (S6, ADR-077). A section is the part of the warehouse an operator walks to:
 * raw materials, packaging, finished goods, the QA area, returns, production, or another area
 * (receiving dock, dispatch bay). It is a display and suggestion attribute of a location only:
 * movement and status rules still come from the location class (`kind`) and the lot status.
 *
 * `locations.section` is set in Master data; when it is empty the section is derived from the
 * location class and the warehouse kind (`sectionOf`), so existing data groups sensibly without a
 * backfill. Dependency-free: the schema check constraint imports the list and client forms import the labels.
 */
export const LOCATION_SECTIONS = ["raw_materials", "packaging", "finished_goods", "qa_hold", "returns", "production", "other"] as const;
export type LocationSection = (typeof LOCATION_SECTIONS)[number];

/** Operator-facing names in simple English (no "quarantine"/"disposition" wording). */
export const SECTION_LABELS: Record<LocationSection, string> = {
  raw_materials: "Raw materials",
  packaging: "Packaging",
  finished_goods: "Finished goods",
  qa_hold: "Waiting for QA / on hold",
  returns: "Returns",
  production: "Production",
  other: "Other areas",
};

export const SECTION_HINTS: Record<LocationSection, string> = {
  raw_materials: "Oils, actives and other ingredients",
  packaging: "Bottles, jars, labels, boxes",
  finished_goods: "Products ready to sell",
  qa_hold: "New deliveries waiting for QA, and stock on hold",
  returns: "Goods sent back by customers or going back to suppliers",
  production: "Stock at the production rooms",
  other: "Receiving dock, dispatch bay and other places",
};

const QA_KINDS = ["quarantine", "hold", "rejected", "recall"];
const PRODUCTION_KINDS = ["production", "staging"];
const WAREHOUSE_SECTIONS = ["raw_materials", "packaging", "finished_goods"];

export function isSection(v: unknown): v is LocationSection {
  return typeof v === "string" && (LOCATION_SECTIONS as readonly string[]).includes(v);
}

/** The section of a location: the explicit one, else derived from its class, else from its warehouse kind. */
export function sectionOf(loc: { section?: string | null; kind: string }, warehouseKind?: string | null): LocationSection {
  if (isSection(loc.section)) return loc.section;
  if (QA_KINDS.includes(loc.kind)) return "qa_hold";
  if (PRODUCTION_KINDS.includes(loc.kind)) return "production";
  if (warehouseKind && WAREHOUSE_SECTIONS.includes(warehouseKind)) return warehouseKind as LocationSection;
  return "other";
}

/** The section an item normally belongs in: raw material → Raw materials, packaging → Packaging, product → Finished goods. */
export function sectionForItem(item: { itemKind: "material" | "product"; materialKind?: string | null }): LocationSection {
  if (item.itemKind === "product") return "finished_goods";
  if (item.materialKind === "packaging") return "packaging";
  if (item.materialKind === "intermediate") return "production";
  return "raw_materials";
}

/** Sort order for headings: the owner's walking order. */
export const SECTION_ORDER: Record<LocationSection, number> = Object.fromEntries(LOCATION_SECTIONS.map((s, i) => [s, i])) as Record<LocationSection, number>;
