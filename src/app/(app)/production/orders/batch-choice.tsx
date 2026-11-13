"use client";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { batchChoiceOptions, batchPlanText, checkBatchSizes, proposeBatches } from "@/modules/production/batch-plan";
import { cx, Input } from "@/ui/core";

/**
 * ADR-104 §4 "One batch or several" on the New order screen. From "How many pieces?" the screen proposes the
 * batches from the recipe's batch size and the largest batch ("2 batches of 1,000 bars") and offers:
 *   - Split into N batches (default);
 *   - Make it one batch (only up to the largest batch; otherwise disabled with the reason and the split offered);
 *   - Choose sizes (each ≤ the largest, the sum = the pieces).
 * The server (createProductionOrder → planBatches) checks the same rules again; this only collects the choice.
 */
export function BatchChoice({ pieces, refBatchG, yieldPct, pieceG, largestG, largestFrom, word, error }: { pieces: string; refBatchG: string | null; yieldPct: string | null; pieceG: string | null; largestG: string | null; largestFrom: string | null; word: string; error?: string }) {
  const n = /^\d{1,7}$/.test(pieces.trim()) ? Number(pieces.trim()) : 0;
  const p = n > 0 && refBatchG ? proposeBatches({ pieces: n, refBatchG, yieldPct: yieldPct ?? "100", pieceG, largestG, largestFrom, word }) : null;
  const [mode, setMode] = useState<"split" | "one" | "custom">("split");
  const [sizes, setSizes] = useState<string[]>(["", ""]);
  if (!p) {
    return <input type="hidden" name="batchMode" value="split" />;
  }
  const effective = mode === "one" && (!p.one.allowed || p.split.count === 1) ? "split" : mode;
  const check = effective === "custom" ? checkBatchSizes(sizes, n, p.maxPieces, word) : null;
  const opt = (value: "split" | "one" | "custom", title: string, detail: string, disabled = false) => (
    <label
      className={cx(
        "flex min-h-[56px] cursor-pointer items-start gap-3 rounded-[14px] border px-3.5 py-3 text-[15px]",
        effective === value ? "border-primary bg-[var(--primary-bg,rgba(0,0,0,0.03))]" : "border-line",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name="batchModeChoice" value={value} checked={effective === value} disabled={disabled} onChange={() => setMode(value)} className="mt-1 h-5 w-5" />
      <span className="grid gap-0.5">
        <span className="font-semibold text-fg">{title}</span>
        <span className="text-fg-2">{detail}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="grid gap-2" data-testid="batch-choice">
      <legend className="mb-1 text-[15px] font-medium">How to make it</legend>
      <input type="hidden" name="batchMode" value={effective} />
      <p className="text-[15px] text-fg-2" data-testid="batch-proposal">
        One batch of the recipe makes about {p.refPieces.toLocaleString("en-PH")} {word}. The largest batch is {p.maxPieces.toLocaleString("en-PH")} {word} ({p.largestFrom}).
      </p>
      {/* ADR-133 item 8: one choice when splitting gives one batch (never the same choice twice). */}
      {batchChoiceOptions(p, word).map((o) => opt(o.value, o.title, o.detail, o.disabled))}
      {effective === "custom" && (
        <div className="grid gap-2 rounded-[14px] border border-line p-3">
          {sizes.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-[15px]" htmlFor={`bsize-${i}`}>
                Batch {i + 1}
              </label>
              <Input id={`bsize-${i}`} name="batchSizes" inputMode="numeric" value={v} placeholder={String(p.split.sizes[i] ?? "")} onChange={(e) => setSizes(sizes.map((x, j) => (j === i ? e.target.value.replace(/[^0-9,]/g, "") : x)))} className="min-h-[48px] min-w-0 flex-1" />
              <span className="text-[14px] text-fg-2">{word}</span>
              {sizes.length > 1 && (
                <button type="button" aria-label={`Remove batch ${i + 1}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line" onClick={() => setSizes(sizes.filter((_, j) => j !== i))}>
                  <Minus size={16} aria-hidden />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="inline-flex min-h-[44px] items-center gap-2 text-[15px] font-semibold text-primary-text" onClick={() => setSizes([...sizes, ""])}>
            <Plus size={16} aria-hidden /> Add a batch
          </button>
          <p className={cx("text-[14px]", check?.ok ? "text-[var(--ok-fg)]" : "text-[var(--warn-fg)]")} role="status" data-testid="batch-sizes-check">
            {check?.ok ? `${batchPlanText(check.sizes, word)} ✓` : check?.message}
          </p>
        </div>
      )}
      {error && <p className="text-[14px] text-[var(--bad-fg)]">{error}</p>}
    </fieldset>
  );
}
