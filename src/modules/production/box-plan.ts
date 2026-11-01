/**
 * ADR-104 §2 box labels — pure arithmetic shared by the packaging step (live sentence) and the server
 * (planBatchBoxes): "How many pieces did you pack?" → full boxes of `perBox` and one part box for the rest.
 * No database, no server-only imports.
 */

/** Most boxes one batch may label at once (one label job per box). */
export const MAX_BOXES = 200;

export type BoxSplit = { pieces: number; perBox: number; full: number; part: number; boxes: number; sizes: number[] };

/** 309 pieces, 24 per box → 12 full boxes, 1 part box of 21 → 13 boxes. Null when the numbers are not usable. */
export function boxSplit(pieces: number, perBox: number): BoxSplit | null {
  if (!Number.isInteger(pieces) || pieces < 1 || !Number.isInteger(perBox) || perBox < 1) return null;
  const full = Math.floor(pieces / perBox);
  const part = pieces - full * perBox;
  const boxes = full + (part > 0 ? 1 : 0);
  return { pieces, perBox, full, part, boxes, sizes: [...Array.from({ length: full }, () => perBox), ...(part > 0 ? [part] : [])] };
}

const fmt = (n: number) => n.toLocaleString("en-PH");
const boxWord = (n: number) => (n === 1 ? "box" : "boxes");

/** "That makes 12 boxes of 24 and 1 box of 9" · "That makes 13 boxes of 24" · "That makes 1 box of 9". */
export function boxSplitText(s: BoxSplit): string {
  const parts = [s.full > 0 ? `${fmt(s.full)} ${boxWord(s.full)} of ${fmt(s.perBox)}` : null, s.part > 0 ? `1 box of ${fmt(s.part)}` : null].filter(Boolean);
  return `That makes ${parts.join(" and ")}`;
}

/** "Print 13 box labels" / "Print 1 box label". */
export function boxPrintLabel(boxes: number): string {
  return `Print ${fmt(boxes)} box ${boxes === 1 ? "label" : "labels"}`;
}

/** Whole pieces from the form ("1,234" allowed); null when not a whole number from 1 to 999,999. */
export function parsePieces(v: unknown): number | null {
  const t = String(v ?? "").trim().replace(/,/g, "");
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}
