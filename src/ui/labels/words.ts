import type { LabelKind } from "@/modules/documents";
import { LABELS_MENU_PATH } from "@/lib/menu-paths";

/**
 * Grade-5 words for labels (ADR-099): what the label goes on and when its code is scanned, one sentence each
 * on every screen that prints. Kept in one place so receive, put away, packaging, boxing and shelves say the same.
 */
export const LABEL_KIND_WORDS: Record<LabelKind, { one: string; many: string; stick: string; title: string; scan: string }> = {
  sack: { one: "sack", many: "sacks", stick: "Stick one on each sack or drum.", title: "Label for each sack", scan: "Scan the square code at put-away and when you take the sack for a batch." },
  tub: { one: "tub", many: "tubs", stick: "Stick one on each tub or bucket.", title: "Label for each tub", scan: "Scan the square code when you take the tub for the next step." },
  // The label on each piece (a soap bar, a lotion bottle): plain "piece" words, so a lotion never reads "bar"
  // (demo rehearsal 2026-11-07: "How many? (one for each bar)" on the lotion).
  bar: {
    one: "piece",
    many: "pieces",
    stick: "Stick one on each piece.",
    title: "Label for each piece",
    scan: "Scan a piece's square code at boxing or on the Scan screen: it opens this batch, and its lot once the batch is finished.",
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

/** Re-audit B #12: shown on print screens while a label still uses the old (v1) layout. */
export const OLD_LAYOUT_NOTE = `Old label layout — QA can approve the new one in ${LABELS_MENU_PATH}.`;

/** True when a label was drawn with the old layout (renderer v1). */
export function isOldLayout(rendererVersion: number | null | undefined): boolean {
  return rendererVersion === 1;
}

/** Fallback sentence about scanning. */
export const SCAN_SENTENCE = "Scan the square code with the Scan screen to open this record.";
