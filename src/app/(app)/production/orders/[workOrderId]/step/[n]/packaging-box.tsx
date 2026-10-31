"use client";
import Link from "next/link";
import { CheckCircle2, Package, Printer, Tag } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { StepCardView } from "@/modules/production";
import { fmtDate } from "@/lib/qty";
import { Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";
import { packagingLotAction, printBatchLabelsAction } from "../../flow-actions";

type Packaging = NonNullable<StepCardView["packaging"]>;
type Choice = Packaging["choices"][number];

const n = (v: string) => Number(v).toLocaleString("en-PH", { maximumFractionDigits: 3 });
const uomWord = (u: string) => (u === "pcs" ? "pcs" : u);

/**
 * Packaging step (ADR-088 §3, ADR-092; one path for production work 2026-10-31).
 * - The batch has packaging lines: "You took these at Get materials" (lot, shelf, how many), nothing to
 *   scan; "Step done" records them and the step asks how many were used and spoiled.
 * - The batch has none (older recipes): the released packaging lots at the site as big tap-to-choose cards
 *   (name, lot, shelf, quantity) to tap, with Scan (camera or handheld) and Find by name (ScanOrPick). Nobody types a code.
 * - Always: which label to use (a small preview of this batch's product label) and the print button.
 */
export function PackagingBox({ batchId, stepNo, packaging, canPerform, done, labelsPanel }: { batchId: string; stepNo: number; packaging: Packaging; canPerform: boolean; done: boolean; labelsPanel?: ReactNode }) {
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
                        {l.materialName} from lot <span className="font-mono font-semibold text-fg">{r.lotNumber}</span>, {l.issued.length ? "recorded" : l.picked === "taken" ? "taken" : "set aside"} · shelf {r.locationCode} · {n(r.qty)} {uomWord(l.uom)}
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
      {packaging.choose && packaging.recorded > 0 && (
        <p className="flex items-center gap-2 rounded-[16px] border border-line bg-surface p-4 text-[16px] text-fg" data-testid="packaging-recorded">
          <CheckCircle2 size={20} className="text-[var(--ok-fg)]" aria-hidden /> The wrapper or label lot you used is recorded for this batch.
        </p>
      )}
      {packaging.needsScan && canPerform && <ChooseLot batchId={batchId} stepNo={stepNo} choices={packaging.choices} defaultCount={packaging.labels.defaultCount} />}
      {/* ADR-099: the label panel (preview, how many, Print N labels) once printing is allowed; before that the reason. */}
      {labelsPanel ?? <LabelPrint batchId={batchId} labels={packaging.labels} />}
    </div>
  );
}

/**
 * Older recipes without packaging lines: which wrapper or label lot did you take? The released packaging
 * lots at the site are big tap targets (ScanOrPick, ADR-098): tap it, scan its label (camera or handheld),
 * or find it by name; then the shelf when the lot is on several. Nobody types a code. The server
 * (issuePackaging) checks lot, material, site, hold and stock again.
 */
function ChooseLot({ batchId, stepNo, choices, defaultCount }: { batchId: string; stepNo: number; choices: Choice[]; defaultCount: number }) {
  const [state, action] = useInPlaceAction(packagingLotAction);
  const [lot, setLot] = useState<PickCandidate | null>(null);
  const fe = state?.fieldErrors ?? {};
  const byLot = new Map<string, PickCandidate>();
  for (const c of choices) {
    const place: PickCandidate = { value: c.locationId, title: `Shelf ${c.shelf}`, detail: `${n(c.qty)} ${uomWord(c.uom)} there`, code: c.shelf, codes: [c.shelf] };
    const had = byLot.get(c.lotId);
    if (had) {
      had.places!.push(place);
      continue;
    }
    byLot.set(c.lotId, {
      value: c.lotId,
      title: c.materialName,
      detail: `lot ${c.lotNumber} · shelf ${c.shelf} · ${n(c.qty)} ${uomWord(c.uom)}${c.expiresOn ? ` · use before ${fmtDate(c.expiresOn)}` : ""}`,
      code: c.lotNumber,
      codes: [c.lotNumber],
      uom: c.uom,
      places: [place],
    });
  }
  const candidates = [...byLot.values()];
  const firstQty = lot ? Math.floor(Number(choices.find((c) => c.lotId === lot.value)?.qty ?? defaultCount)) : defaultCount;
  return (
    <form action={action} className="grid gap-3 rounded-[16px] border border-[var(--warn-bd)] bg-surface p-4" aria-label="Which wrapper or label did you take?" data-testid="packaging-choose">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="stepNo" value={stepNo} />
      {candidates.length === 0 ? (
        <p className="text-[16px] text-[var(--warn-fg)]" data-testid="packaging-none">
          No wrappers or labels are ready to use at this site (none released by QA with stock). Ask the warehouse or QA.
        </p>
      ) : (
        <>
          <ScanOrPick
            kind="lot"
            name="lotRef"
            label="Which wrapper or label did you take?"
            hint="Tap the one in your hand (check the lot number on its box or roll), or scan its label."
            candidatesLabel="Ready to use at this site"
            candidates={candidates}
            required
            onChange={(_v, c) => setLot(c)}
            error={fe.lot ?? null}
          />
          {lot && (
            <ScanOrPick
              key={lot.value}
              kind="location"
              name="locationRef"
              label="From which shelf?"
              candidates={lot.places ?? []}
              hideWhenSingle
              required
              search={false}
              onlyCandidates
              error={fe.location ?? null}
            />
          )}
          {lot && (
            <label className="flex flex-col gap-1 text-[15px] font-medium" key={`q-${lot.value}`}>
              How many did you take?
              <Input name="qty" inputMode="numeric" defaultValue={String(Math.min(defaultCount, firstQty || defaultCount))} className="min-h-[56px] text-[18px]" required />
              {fe.qty && <span className="text-[14px] text-[var(--bad-fg)]">{fe.qty}</span>}
            </label>
          )}
          <SubmitButton variant="cta" size="lg" pendingText="Saving…" disabled={!lot}>
            I took these
          </SubmitButton>
        </>
      )}
      <FormMessage state={state} />
    </form>
  );
}

/**
 * Which label to use: a small preview of this batch's product label (product, lot, made date, expiry,
 * label design). The real print view is the label job's print page (another team rebuilds label print
 * and preview under /print and /labels; we only link to it).
 */
function LabelPreview({ labels }: { labels: Partial<Packaging["labels"]> & Pick<Packaging["labels"], "lotNumber" | "expiresOn"> }) {
  return (
    <figure className="mt-3 grid gap-1" data-testid="label-preview">
      <div className="max-w-[300px] rounded-[10px] border-2 border-dashed border-line-strong bg-white p-3 text-[13px] leading-tight text-[#1c1b18]" aria-label="Label preview">
        <p className="text-[15px] font-bold">{labels.productName || "This product"}</p>
        <p>
          Lot: <span className="font-mono font-semibold">{labels.lotNumber ?? "given at the first print"}</span>
        </p>
        <p>Expiry: {labels.expiresOn ? fmtDate(labels.expiresOn) : "set at the first print"}</p>
        <div className="mt-2 h-6 w-40 bg-[repeating-linear-gradient(90deg,#1c1b18_0_2px,transparent_2px_4px,#1c1b18_4px_5px,transparent_5px_8px)]" aria-hidden />
      </div>
      <figcaption className="text-[13px] text-muted">
        {labels.template ? `Label design: ${labels.template.name}. ` : ""}What the label on each piece looks like (preview).
      </figcaption>
    </figure>
  );
}

export function LabelPrint({ batchId, labels }: { batchId: string; labels: Pick<Packaging["labels"], "defaultCount" | "lotNumber" | "expiresOn" | "why"> & Partial<Pick<Packaging["labels"], "template" | "productName">> }) {
  const [state, action] = useInPlaceAction(printBatchLabelsAction);
  const jobId = state?.ok ? state.jobId : undefined;
  return (
    <section className="rounded-[16px] border border-line bg-surface p-4" aria-label="Product labels" data-testid="batch-labels">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-fg">
        <Tag size={18} aria-hidden /> Labels for this batch
      </h2>
      <p className="mt-1 text-[15px] text-fg-2">Stick one label on each bar or box. Use only the labels printed for this batch: they show the product, lot number, made date and expiry.</p>
      <LabelPreview labels={labels} />
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
