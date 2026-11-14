"use client";
import Link from "next/link";
import { Boxes, CheckCircle2, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LabelFaceData } from "@/modules/documents";
import { boxPrintLabel, boxSplit, boxSplitText, parsePieces } from "@/modules/production/box-plan";
import { Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { LabelPreview } from "@/ui/labels";
import { planBatchBoxesAction } from "../../flow-actions";

export type BoxLabelsProps = {
  batchId: string;
  unitsPerBox: number;
  defaultPieces: number;
  /** ADR-110 C6: retained samples QA keeps; they are not boxed. */
  samples?: number;
  pieceWord: string;
  face: LabelFaceData | null;
  plan: { pieces: number; boxes: { boxNo: number; boxCount: number; pieces: number; containerNumber: string; status: string; labelStatus: string | null }[]; printed: boolean; boxed: boolean } | null;
  canPrint: boolean;
  why: string | null;
  /** Finding 6: locked until the earlier steps are done; the planned boxes and the label preview show read only. */
  locked?: boolean;
  printHref: string;
};

/**
 * ADR-104 §2 box labels (packaging step and Finish): "How many pieces did you pack?" → "That makes 12 boxes of 24
 * and 1 box of 9" → one green "Print 13 box labels". The sentence is worked out on the phone from the product's
 * pieces per box; the server works it out again (planBatchBoxes) and takes a box number for each label. The
 * preview is the real label of box 1 (same renderer and layout as the print).
 */
export function BoxLabels(p: BoxLabelsProps & { withPieceLabels?: boolean }) {
  const [state, action] = useInPlaceAction(planBatchBoxesAction);
  const [pieces, setPieces] = useState(String(p.plan?.pieces ?? p.defaultPieces));
  const n = parsePieces(pieces);
  const split = n ? boxSplit(n, p.unitsPerBox) : null;
  const href = state?.ok ? state.href : p.plan ? p.printHref : undefined;
  const same = !!p.plan && n === p.plan.pieces;
  const router = useRouter();
  // Round 5 problem 3: straight to the print page (no "Open the box labels" in between), piece labels included.
  useEffect(() => {
    if (state?.ok && state.href) router.push(`${state.href}${state.href.includes("?") ? "&" : "?"}auto=1`);
  }, [state, router]);
  if (p.plan?.boxed) {
    return (
      <section className="grid gap-2 rounded-[8px] border border-line bg-surface p-4" aria-label="Boxes" data-testid="box-labels">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold text-fg">
          <Boxes size={18} aria-hidden /> Boxes
        </h2>
        <p className="flex items-center gap-2 text-[16px]">
          <CheckCircle2 size={18} className="text-[var(--ok-fg)]" aria-hidden /> {p.plan.boxes.length} {p.plan.boxes.length === 1 ? "box is" : "boxes are"} in the hold area ({p.plan.pieces} {p.pieceWord}). Scan a box label to open the box.
        </p>
      </section>
    );
  }
  return (
    <section className="grid gap-3 rounded-[8px] border border-line bg-surface p-4" aria-label="Box labels" data-testid="box-labels">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-fg">
        <Boxes size={18} aria-hidden /> Box labels
      </h2>
      {p.face && <LabelPreview kind="box" data={p.face} sentence="Stick one label on each box. Each box label shows its own box number and pieces." />}
      {p.why ? (
        <div className="grid gap-2">
          <p className="text-[15px] text-[var(--warn-fg)]" data-testid="box-labels-why">{p.why}</p>
          {p.locked && split && (
            <p className="text-[15px] text-fg" data-testid="box-split-planned">
              <b>{boxSplitText(split)}</b> ({n} {p.pieceWord}{p.samples ? `; QA keeps ${p.samples} as samples` : ""}). You print the box labels here when the steps before are done.
            </p>
          )}
        </div>
      ) : (
        <form action={action} className="grid gap-3">
          <input type="hidden" name="batchId" value={p.batchId} />
          {p.withPieceLabels && <input type="hidden" name="withPieceLabels" value="1" />}
          <label className="flex flex-col gap-1 text-[16px] font-medium" htmlFor={`pieces-${p.batchId}`}>
            How many {p.pieceWord} go in boxes?
            <Input id={`pieces-${p.batchId}`} name="pieces" inputMode="numeric" pattern="[0-9,]*" value={pieces} onChange={(e) => setPieces(e.target.value)} className="min-h-[56px] text-[18px]" required />
            {p.samples ? (
              <span className="text-[14px] font-normal text-fg-2" data-testid="box-samples-hint">
                QA keeps {p.samples} {p.pieceWord} as samples. Do not box them: count only the {p.pieceWord} for sale.
              </span>
            ) : null}
            {state?.fieldErrors?.pieces && <span className="text-[14px] text-[var(--bad-fg)]">{state.fieldErrors.pieces}</span>}
          </label>
          <p className="text-[16px] font-semibold text-fg" role="status" data-testid="box-split">
            {split ? `${boxSplitText(split)}.` : "Write a whole number."} <span className="font-normal text-fg-2">({p.unitsPerBox} in a full box)</span>
          </p>
          {p.plan && !same && <p className="text-[14px] text-[var(--warn-fg)]">You printed labels for {p.plan.pieces} {p.pieceWord}. Printing again cancels the old box labels: destroy any you stuck on.</p>}
          {!(same && href) && (
            <SubmitButton variant="cta" size="lg" pendingText="Making the box labels…" disabled={!split || !p.canPrint} className="w-full">
              <Printer size={18} aria-hidden /> {split ? (p.withPieceLabels && n ? `Print ${n} piece labels and ${split.boxes} box ${split.boxes === 1 ? "label" : "labels"}` : boxPrintLabel(split.boxes)) : "Print box labels"}
            </SubmitButton>
          )}
        </form>
      )}
      <FormMessage state={state} />
      {href && (same || state?.ok) && (
        <Link href={href} className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[6px] bg-primary px-5 text-[16px] font-semibold text-white" data-testid="open-box-labels">
          <Printer size={18} aria-hidden /> {p.plan?.printed && !state?.ok ? "See the box labels" : "Open the box labels and print"}
        </Link>
      )}
    </section>
  );
}
