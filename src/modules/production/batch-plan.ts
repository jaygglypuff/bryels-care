import Decimal from "decimal.js";

/**
 * ADR-104 §4 "One batch or several" — pure arithmetic shared by the New order screen (live proposal) and the
 * server (createProductionOrder validates again). No database, no server-only imports.
 *
 *   pieces of a batch   = floor(batch grams × expected % ÷ 100 ÷ grams per piece)          (ADR-094 piecesFromBatch)
 *   grams for N pieces  = ceil(N × grams per piece × 100 ÷ expected %)  (whole grams)     (ADR-094 piecesToBatchG)
 *   largest batch       = the smallest known capacity of the mixing equipment on the routing, else the
 *                         recipe's batch size (A-FD-05: conservative until QA records a capacity)
 *   split (default)     = N = ceil(pieces ÷ min(recipe batch pieces, largest pieces)) batches, sizes as even
 *                         as possible (they differ by at most one piece, bigger first)
 *   one batch           = allowed only when all pieces fit in the largest batch
 *   choose sizes        = every size a whole number above 0, each ≤ the largest, sum = the pieces ordered
 */

export type Num = Decimal.Value;

/** Most batches one production order may plan (work order schema allows 200). */
export const MAX_BATCHES = 200;

/** Whole grams for N pieces (rounded up), as the recipe wizard (ADR-094). */
export function gramsForPieces(pieces: Num, pieceG: Num, yieldPct: Num): Decimal {
  const y = new Decimal(yieldPct);
  if (y.lte(0)) return new Decimal(0);
  return new Decimal(pieces).mul(pieceG).mul(100).div(y).toDecimalPlaces(0, Decimal.ROUND_UP);
}

/** Whole pieces a batch of `grams` makes (rounded down); 0 when the piece weight is unknown. */
export function piecesForGrams(grams: Num, yieldPct: Num, pieceG: Num | null | undefined): number {
  if (pieceG === null || pieceG === undefined || pieceG === "") return 0;
  const m = new Decimal(pieceG);
  if (m.lte(0)) return 0;
  return new Decimal(grams || 0).mul(yieldPct || 0).div(100).div(m).floor().toNumber();
}

/** The most pieces whose batch (grams for N pieces) still fits in `largestG`. */
export function maxPiecesFor(largestG: Num, pieceG: Num, yieldPct: Num): number {
  let n = piecesForGrams(largestG, yieldPct, pieceG);
  while (n > 0 && gramsForPieces(n, pieceG, yieldPct).gt(largestG)) n -= 1;
  return n;
}

/** `total` pieces in `n` batches as even as possible (bigger first): 1,500 in 2 → [750, 750]; 2,001 in 2 → [1,001, 1,000]. */
export function evenSplit(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

const fmt = (n: number) => n.toLocaleString("en-PH");

/** "2 batches of 1,000 bars" · "1 batch of 1,500 bars and 1 batch of 500 bars" (equal sizes grouped). */
export function batchPlanText(sizes: number[], word = "pieces"): string {
  const groups: { size: number; n: number }[] = [];
  for (const s of sizes) {
    const g = groups.find((x) => x.size === s);
    if (g) g.n += 1;
    else groups.push({ size: s, n: 1 });
  }
  const parts = groups.map((g) => `${g.n} ${g.n === 1 ? "batch" : "batches"} of ${fmt(g.size)} ${word}`);
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export type BatchPlanFacts = {
  /** Pieces one recipe batch makes. */
  refPieces: number;
  /** Pieces the largest batch can make. */
  maxPieces: number;
  /** Largest batch in grams and where it came from (equipment name or "the recipe's batch size"). */
  largestG: string;
  largestFrom: string;
};

export type BatchProposal = BatchPlanFacts & {
  pieces: number;
  split: { count: number; sizes: number[] };
  one: { allowed: boolean; reason: string | null };
};

/**
 * The plan the screen proposes. `largestG` null = no capacity known: the recipe's batch size is the largest.
 * Returns null when the pieces cannot be planned (no piece weight / expected %, or a batch makes no piece).
 */
export function proposeBatches(input: { pieces: number; refBatchG: Num; yieldPct: Num; pieceG: Num | null | undefined; largestG: Num | null; largestFrom?: string | null; word?: string }): BatchProposal | null {
  const { pieces } = input;
  if (!Number.isInteger(pieces) || pieces < 1 || !input.pieceG || new Decimal(input.pieceG).lte(0) || new Decimal(input.yieldPct || 0).lte(0)) return null;
  const refPieces = piecesForGrams(input.refBatchG, input.yieldPct, input.pieceG);
  const largestG = input.largestG !== null && input.largestG !== undefined && input.largestG !== "" ? new Decimal(input.largestG) : new Decimal(input.refBatchG);
  const largestFrom = input.largestG !== null && input.largestG !== undefined && input.largestG !== "" ? (input.largestFrom ?? "the mixer") : "the recipe's batch size";
  const maxPieces = maxPiecesFor(largestG, input.pieceG, input.yieldPct);
  const perBatch = Math.min(refPieces, maxPieces);
  if (perBatch < 1) return null;
  const count = Math.ceil(pieces / perBatch);
  const word = input.word ?? "pieces";
  const allowed = pieces <= maxPieces;
  return {
    pieces,
    refPieces,
    maxPieces,
    largestG: largestG.toString(),
    largestFrom,
    split: { count, sizes: evenSplit(pieces, count) },
    one: {
      allowed,
      reason: allowed ? null : `One batch of ${fmt(pieces)} ${word} is more than the largest batch (${fmt(maxPieces)} ${word}, from ${largestFrom}). Split it into ${count} batches.`,
    },
  };
}

export type SizesCheck = { ok: true; sizes: number[] } | { ok: false; message: string; index: number | null };

/** "Choose sizes": each a whole number above 0, each ≤ the largest, the sum = the pieces ordered, at most 200 batches. */
export function checkBatchSizes(raw: (string | number)[], total: number, maxPieces: number, word = "pieces"): SizesCheck {
  const list = raw.map((v) => String(v ?? "").trim().replace(/,/g, ""));
  while (list.length > 0 && list[list.length - 1] === "") list.pop(); // empty rows at the end are ignored
  if (list.length === 0) return { ok: false, message: "Write the size of each batch.", index: null };
  if (list.length > MAX_BATCHES) return { ok: false, message: `At most ${MAX_BATCHES} batches in one order.`, index: null };
  const sizes: number[] = [];
  for (const [i, v] of list.entries()) {
    if (!/^\d{1,7}$/.test(v) || Number(v) < 1) return { ok: false, message: `Batch ${i + 1}: write a whole number of ${word} above 0.`, index: i };
    const n = Number(v);
    if (n > maxPieces) return { ok: false, message: `Batch ${i + 1} (${fmt(n)} ${word}) is more than the largest batch (${fmt(maxPieces)} ${word}).`, index: i };
    sizes.push(n);
  }
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum !== total) return { ok: false, message: `The batches add up to ${fmt(sum)} ${word}, but the order is for ${fmt(total)}. ${sum < total ? `Add ${fmt(total - sum)} more.` : `Take ${fmt(sum - total)} away.`}`, index: null };
  return { ok: true, sizes };
}
