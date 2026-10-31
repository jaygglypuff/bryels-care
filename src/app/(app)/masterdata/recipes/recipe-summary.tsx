import Decimal from "decimal.js";
import {
  type RecipeDraft,
  STEP_KIND_WORDS,
  blockByKey,
  draftPieces,
  gramsTotalText,
  isPiecesText,
  kgToGrams,
  lineGrams,
  packagingQty,
  packagingText,
  pieceWord,
  percentFromGrams,
  percentTotalText,
  recipeTotals,
  stepPreviewLine,
} from "@/modules/masterdata/recipe-blocks";
import { cx } from "@/ui/core";
import { BlockIcon } from "./block-icon";

const num = (v: string, dp = 4) => (v ? Number(v).toLocaleString("en-PH", { maximumFractionDigits: dp }) : "—");

/** "About 123 bars": batch × expected amount ÷ size of one piece (rounded down); null when unknown. */
export function piecesPerBatch(batchKg: string, expectedPct: string, unitNetMassG: string | null | undefined, family: string | null | undefined): string | null {
  try {
    if (!unitNetMassG || !batchKg || !expectedPct) return null;
    const mass = new Decimal(unitNetMassG);
    if (mass.lte(0)) return null;
    const n = new Decimal(kgToGrams(batchKg)).mul(expectedPct).div(100).div(mass).floor();
    if (!n.isFinite() || n.lt(0)) return null;
    const word = (family ?? "").toLowerCase().includes("soap") ? "bars" : "pieces";
    return `about ${n.toNumber().toLocaleString("en-PH")} ${word} of ${num(unitNetMassG, 3)} g`;
  } catch {
    return null;
  }
}

/**
 * By pieces (ADR-088 §4), both lines: "One batch makes 70 bars of 135 g (about 9.9 kg of soap)" and how
 * it is stored ("Saved as 9.948 kg of mix: …"). Null until pieces, weight and kilograms are known.
 */
export function batchPiecesSentence(pieces: string, pieceG: string | null | undefined, batchKg: string, family: string | null | undefined): { main: string; how: string } | null {
  if (!isPiecesText(pieces) || !pieceG || !batchKg || Number(batchKg) <= 0) return null;
  const soap = (family ?? "").toLowerCase().includes("soap");
  const n = Number(pieces).toLocaleString("en-PH");
  const about = Number(batchKg).toLocaleString("en-PH", { maximumFractionDigits: 1 });
  return {
    main: `One batch makes ${n} ${pieceWord(family, pieces)} of ${num(pieceG, 3)} g (about ${about} kg of ${soap ? "soap" : "mix"})`,
    how: `The recipe is saved as ${num(batchKg, 3)} kg of mix: ${n} × ${num(pieceG, 3)} g, plus a little extra for what is lost (the expected amount made).`,
  };
}

/**
 * The plain summary card of a recipe ("Check and save", and the recipe page): product, batch size,
 * ingredients with grams AND percent, packaging per piece, steps in order with waits and readings.
 */
export function RecipeSummary({
  productName,
  product,
  draft,
  materialName,
  ingredientsLabel,
  stepsLabel,
}: {
  productName: string;
  product: { unitNetMassG: string | null; family: string | null; pieceG?: string | null } | null;
  draft: RecipeDraft;
  materialName: (id: string) => string;
  ingredientsLabel: string;
  stepsLabel: string;
}) {
  const batchG = draft.batchKg ? kgToGrams(draft.batchKg) : "0";
  const t = recipeTotals(batchG, draft.lines);
  const pieceG = product?.pieceG ?? (product?.unitNetMassG && Number(product.unitNetMassG) > 0 ? product.unitNetMassG : null);
  const byPieces = draft.batchBy === "pcs" ? batchPiecesSentence(draft.pieces ?? "", pieceG, draft.batchKg, product?.family) : null;
  const pieces = byPieces ? null : piecesPerBatch(draft.batchKg, draft.expectedPct, pieceG, product?.family);
  const packaging = draft.packaging ?? [];
  const n = draftPieces(draft, pieceG);
  return (
    <div className="flex flex-col gap-5" data-testid="recipe-summary">
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Product</h3>
        <p className="text-[17px] font-semibold">{productName || "—"}</p>
      </section>
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">One batch</h3>
        {byPieces ? (
          <>
            <p className="text-[15px] font-semibold">{byPieces.main}</p>
            <p className="text-[13px] text-muted">
              {num(draft.batchKg, 3)} kg of mix{draft.expectedPct ? ` · expected amount made ${num(draft.expectedPct, 2)}%` : ""}
            </p>
          </>
        ) : (
          <p className="text-[15px]">
            <span className="font-semibold tabular">{num(draft.batchKg, 3)} kg</span> of mix
            {draft.expectedPct ? ` · expected amount made ${num(draft.expectedPct, 2)}%` : ""}
            {pieces ? ` · ${pieces}` : ""}
          </p>
        )}
      </section>
      {packaging.length > 0 && (
        <section data-testid="recipe-packaging">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Packaging</h3>
          <ul className="mt-1 flex flex-col divide-y divide-line rounded-[14px] border border-line">
            {packaging.map((p, i) => {
              const qty = n !== "0" ? packagingQty(n, p) : null;
              return (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-[14px]">
                  <span className="font-medium">{packagingText(p.perPiece, materialName(p.materialId), product?.family)}</span>
                  {qty && Number(qty) > 0 && <span className="text-muted tabular">{num(qty, 6)} for one batch</span>}
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[12px] text-muted">Set aside with the ingredients and taken at “Get materials”. Not weighed and not part of the ingredient total.</p>
        </section>
      )}
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Ingredients · {ingredientsLabel}</h3>
        {draft.lines.length === 0 ? (
          <p className="text-[14px] text-muted">No ingredients yet.</p>
        ) : (
          <ol className="mt-1 flex flex-col divide-y divide-line rounded-[14px] border border-line">
            {draft.lines.map((l, i) => {
              const g = lineGrams(batchG, l);
              return (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-[14px]">
                  <span className="min-w-0">
                    <span className="mr-2 text-muted tabular">{i + 1}.</span>
                    <span className="font-medium">{materialName(l.materialId)}</span>
                    {l.needsCheck && <span className="ml-2 rounded-full bg-[var(--appr-bg)] px-2 text-[var(--appr-fg)] py-0.5 text-[11px] font-semibold">second person checks</span>}
                  </span>
                  <span className="tabular">
                    <span className="font-semibold">{num(g, 6)} g</span>
                    <span className="text-muted"> · {num(percentFromGrams(batchG, g))}%</span>
                    <span className="text-muted"> · allowed ±{num(l.diff, 6)}{l.diffKind === "pct" ? "%" : " g"}</span>
                  </span>
                </li>
              );
            })}
            <li className={cx("px-3 py-2 text-[13px] font-medium", t.exact ? "text-[var(--ok-fg)]" : "text-[var(--warn-fg)]")}>
              {draft.view === "pct" ? percentTotalText(t) : gramsTotalText(t)}
            </li>
          </ol>
        )}
      </section>
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Steps · {stepsLabel}</h3>
        {draft.steps.length === 0 ? (
          <p className="text-[14px] text-muted">No steps yet.</p>
        ) : (
          <ol className="mt-1 flex flex-col gap-2">
            {draft.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3 rounded-[14px] border border-line px-3 py-2">
                <BlockIcon block={s.block} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{stepPreviewLine(s, i, draft.steps.length)}</p>
                  <p className="text-[12px] text-muted">
                    {blockByKey(s.block).label} · saved as “{STEP_KIND_WORDS[s.stepKind] ?? s.stepKind}”
                    {s.checklist.length ? ` · ${s.checklist.length} thing${s.checklist.length === 1 ? "" : "s"} to tick` : ""}
                  </p>
                  {s.instruction.trim() && <p className="mt-0.5 whitespace-pre-line text-[13px] text-fg-2">{s.instruction.trim()}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
