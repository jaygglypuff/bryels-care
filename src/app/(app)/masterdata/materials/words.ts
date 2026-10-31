/** Plain words for material kinds and counting units (ADR-088 glossary; stored values stay the same). */
export const KIND_WORDS: Record<string, string> = {
  raw_material: "Ingredient",
  packaging: "Packaging",
  consumable: "Supplies",
  intermediate: "Made here, used again",
};

export const KIND_ORDER = ["raw_material", "packaging", "consumable", "intermediate"] as const;

/** "g" → "counted in grams". */
export function countWords(baseUom: string): string {
  return baseUom === "g" ? "counted in grams" : baseUom === "mL" ? "counted in milliliters" : baseUom === "pcs" ? "counted in pieces" : `counted in ${baseUom}`;
}
