"use client";
import Link from "next/link";
import { Package, Printer, Tag } from "lucide-react";
import type { StepCardView } from "@/modules/production";
import { fmtDate } from "@/lib/qty";
import { Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { packagingLotAction, printBatchLabelsAction } from "../../flow-actions";

type Packaging = NonNullable<StepCardView["packaging"]>;

const n = (v: string) => Number(v).toLocaleString("en-PH", { maximumFractionDigits: 3 });
const uomWord = (u: string) => (u === "pcs" ? "pcs" : u);

/**
 * Packaging step, ADR-088 §3: the wrappers / labels the operator took at "Get materials" (lot, shelf,
 * how many) so nothing is scanned; "Step done" records them. Plus the button that prints this batch's
 * product labels through the label jobs. Fallback when nothing was on the list: type or scan the lot used.
 */
export function PackagingBox({ batchId, stepNo, packaging, canPerform, done }: { batchId: string; stepNo: number; packaging: Packaging; canPerform: boolean; done: boolean }) {
  return (
    <div className="grid gap-3">
      {packaging.lines.length > 0 && (
        <section className="rounded-[16px] border border-line bg-surface p-4" aria-label="Wrappers and labels for this batch" data-testid="packaging-taken">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold text-fg">
            <Package size={18} aria-hidden /> You took these at Get materials
          </h2>
          <ul className="mt-2 grid gap-2">
            {packaging.lines.map((l) => {
              const rows = l.issued.length ? l.issued : l.plan;
              return (
                <li key={l.batchMaterialId} className="rounded-[12px] bg-surface-2 p-3 text-[16px]">
                  <p className="font-semibold text-fg">{l.materialName}</p>
                  {rows.length ? (
                    rows.map((r, i) => (
                      <p key={i} className="text-fg-2">
                        Lot <span className="font-mono font-semibold text-fg">{r.lotNumber}</span> ({l.issued.length ? "recorded" : l.picked === "taken" ? "taken" : "set aside"}) · shelf {r.locationCode} · {n(r.qty)} {uomWord(l.uom)}
                      </p>
                    ))
                  ) : (
                    <p className="text-[var(--warn-fg)]">Nothing is set aside for this any more. Ask the planner to set it aside again.</p>
                  )}
                </li>
              );
            })}
          </ul>
          {!done && <p className="mt-2 text-[14px] text-muted">No scanning: Step done records these lots for this batch.</p>}
        </section>
      )}
      {packaging.needsScan && canPerform && <ScanLot batchId={batchId} stepNo={stepNo} />}
      <LabelPrint batchId={batchId} labels={packaging.labels} />
    </div>
  );
}

function ScanLot({ batchId, stepNo }: { batchId: string; stepNo: number }) {
  const [state, action] = useInPlaceAction(packagingLotAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-2 rounded-[16px] border border-[var(--warn-bd)] bg-surface p-4" data-testid="packaging-scan">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="stepNo" value={stepNo} />
      <p className="text-[16px] font-semibold text-fg">No wrappers were on the materials list for this batch.</p>
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        Which wrapper or label lot did you use? (scan or type it)
        <Input name="lotRef" autoComplete="off" className="min-h-[52px] font-mono" required />
        {fe.lot && <span className="text-[14px] text-[var(--bad-fg)]">{fe.lot}</span>}
      </label>
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        How many did you take?
        <Input name="qty" inputMode="numeric" className="min-h-[52px] text-[17px]" required />
        {fe.qty && <span className="text-[14px] text-[var(--bad-fg)]">{fe.qty}</span>}
      </label>
      <SubmitButton variant="primary" size="lg" pendingText="Saving…">Save the lot</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function LabelPrint({ batchId, labels }: { batchId: string; labels: Pick<Packaging["labels"], "defaultCount" | "lotNumber" | "expiresOn" | "why"> }) {
  const [state, action] = useInPlaceAction(printBatchLabelsAction);
  const jobId = state?.ok ? state.jobId : undefined;
  return (
    <section className="rounded-[16px] border border-line bg-surface p-4" aria-label="Product labels" data-testid="batch-labels">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-fg">
        <Tag size={18} aria-hidden /> Labels for this batch
      </h2>
      <p className="mt-1 text-[15px] text-fg-2">Stick one label on each bar or box. The label shows the product, lot number, made date and expiry.</p>
      {labels.lotNumber && (
        <p className="mt-1 text-[15px] text-fg-2">
          Lot <span className="font-mono font-semibold text-fg">{labels.lotNumber}</span>
          {labels.expiresOn ? ` · expiry ${fmtDate(labels.expiresOn)}` : ""}
        </p>
      )}
      {labels.why ? (
        <p className="mt-2 text-[15px] text-[var(--warn-fg)]">{labels.why}</p>
      ) : (
        <form action={action} className="mt-3 grid gap-2">
          <input type="hidden" name="batchId" value={batchId} />
          {labels.lotNumber && <input type="hidden" name="copies" value={labels.defaultCount} />}
          {!labels.lotNumber && (
          <details className="text-[14px]">
            <summary className="min-h-[44px] cursor-pointer py-2 text-fg-2">Change how many labels ({labels.defaultCount})</summary>
            <label className="flex flex-col gap-1 text-[15px] font-medium">
              How many labels?
              <Input name="copies" inputMode="numeric" defaultValue={labels.defaultCount} className="min-h-[52px] text-[17px]" />
            </label>
          </details>
          )}
          <SubmitButton variant="secondary" size="lg" pendingText="Making the labels…" className="w-full">
            <Printer size={18} aria-hidden /> {labels.lotNumber ? "Open this batch's labels" : `Print labels for this batch (${labels.defaultCount} labels)`}
          </SubmitButton>
        </form>
      )}
      <FormMessage state={state} />
      {jobId && (
        <Link href={`/print/labels/${jobId}`} className="mt-2 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-white" data-testid="open-labels">
          <Printer size={16} aria-hidden /> Open the labels and print
        </Link>
      )}
    </section>
  );
}
