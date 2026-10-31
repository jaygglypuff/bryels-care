import type { LabelKind } from "@/modules/documents";

/**
 * Grade-5 words for labels (ADR-099): what the label goes on and when its code is scanned, one sentence each
 * on every screen that prints. Kept in one place so receive, put away, packaging, boxing and shelves say the same.
 */
export const LABEL_KIND_WORDS: Record<LabelKind, { one: string; many: string; stick: string; title: string; scan: string }> = {
  sack: { one: "sack", many: "sacks", stick: "Stick one on each sack or drum.", title: "Label for each sack", scan: "Scan the square code at put-away and when you take the sack for a batch." },
  tub: { one: "tub", many: "tubs", stick: "Stick one on each tub or bucket.", title: "Label for each tub", scan: "Scan the square code when you take the tub for the next step." },
  bar: {
    one: "bar",
    many: "bars",
    stick: "Stick one on each bar.",
    title: "Label for each bar",
    scan: "Scan a bar's square code at boxing or on the Scan screen: it opens this batch, and its lot once the batch is finished.",
  },
  product_box: { one: "box", many: "boxes", stick: "Stick one on each box of this lot.", title: "Lot label", scan: "Scan the square code when you pick or box this lot." },
  box: { one: "box", many: "boxes", stick: "Stick it on the side of the box.", title: "Box label", scan: "Scan the square code when you move, pick or ship the box." },
  shelf: { one: "shelf", many: "shelves", stick: "Stick it on the front edge of the shelf.", title: "Shelf label", scan: "Scan the code at put-away to say which shelf the stock goes on." },
};

export function labelCountWords(n: number) {
  return `${n} ${n === 1 ? "label" : "labels"}`;
}

/** A printer name in plain words: technical notes in brackets ("(203 dpi, demo)") are left out. */
export function plainPrinter(name: string | null | undefined): string {
  return (name ?? "").replace(/\s*\([^)]*\)/g, "").trim() || "the label printer";
}

/** Fallback sentence about scanning. */
export const SCAN_SENTENCE = "Scan the square code with the Scan screen to open this record.";
