"use client";
import Link from "next/link";
import { Camera, CheckCircle2, Package, Printer, Tag } from "lucide-react";
import { useState } from "react";
import type { StepCardView } from "@/modules/production";
import { fmtDate } from "@/lib/qty";
import { normalizeScanInput } from "@/lib/scan/payload";
import { Button, cx, Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { Scanner } from "@/ui/scanner";
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
 *   (name, lot, shelf, quantity) and a "Scan with camera" button. Nobody types a code.
 * - Always: which label to use (a small preview of this batch's product label) and the print button.
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
      <LabelPrint batchId={batchId} labels={packaging.labels} />
    </div>
  );
}

/** Older recipes without packaging lines: tap the lot you took (or scan it with the camera), say how many. */
function ChooseLot({ batchId, stepNo, choices, defaultCount }: { batchId: string; stepNo: number; choices: Choice[]; defaultCount: number }) {
  const [state, action] = useInPlaceAction(packagingLotAction);
  const [picked, setPicked] = useState<Choice | null>(null);
  const [camera, setCamera] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const fe = state?.fieldErrors ?? {};
  const onScan = (raw: string) => {
    const code = normalizeScanInput(raw).replace(/^BC:LOT:/, "");
    const hit = choices.find((c) => c.lotNumber.toUpperCase() === code.toUpperCase());
    if (hit) {
      setPicked(hit);
      setCamera(false);
      setScanMsg(null);
    } else setScanMsg(`This label says ${code}. It is not a released wrapper or label lot at this site. Take one from the cards below.`);
  };
  const qtyDefault = picked ? String(Math.min(defaultCount, Math.floor(Number(picked.qty)) || defaultCount)) : String(defaultCount);
  return (
    <section className="grid gap-3 rounded-[16px] border border-[var(--warn-bd)] bg-surface p-4" aria-label="Which wrapper or label did you take?" data-testid="packaging-choose">
      <div>
        <h2 className="text-[18px] font-semibold text-fg">Which wrapper or label did you take?</h2>
        <p className="mt-1 text-[15px] text-fg-2">Tap the one in your hand. Check the lot number printed on its box or roll.</p>
      </div>
      {choices.length === 0 ? (
        <p className="text-[16px] text-[var(--warn-fg)]" data-testid="packaging-none">
          No wrappers or labels are ready to use at this site (none released by QA with stock). Ask the warehouse or QA.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" role="list">
          {choices.map((c) => {
            const on = picked?.lotId === c.lotId && picked.locationId === c.locationId;
            return (
              <li key={`${c.lotId}-${c.locationId}`}>
                <button
                  type="button"
                  onClick={() => setPicked(c)}
                  aria-pressed={on}
                  data-testid="packaging-choice"
                  className={cx("flex min-h-[72px] w-full flex-col items-start gap-0.5 rounded-[14px] border-2 px-4 py-3 text-left", on ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2")}
                >
                  <span className="text-[17px] font-semibold text-fg">{c.materialName}</span>
                  <span className="text-[15px] text-fg-2">
                    Lot <span className="font-mono font-semibold text-fg">{c.lotNumber}</span> · shelf {c.shelf}
                  </span>
                  <span className="text-[14px] text-muted">
                    {n(c.qty)} {uomWord(c.uom)} there{c.expiresOn ? ` · use before ${fmtDate(c.expiresOn)}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid gap-2">
        {!camera ? (
          <Button type="button" variant="secondary" size="lg" onClick={() => setCamera(true)} data-testid="packaging-camera">
            <Camera size={18} aria-hidden /> Scan with camera
          </Button>
        ) : (
          <div className="rounded-[14px] bg-surface-2 p-3">
            <Scanner onScan={onScan} autoFocus={false} label="Point the camera at the lot label on the box or roll" placeholder="Lot label" />
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setCamera(false)}>
              Close the camera
            </Button>
          </div>
        )}
        {scanMsg && <p className="text-[15px] text-[var(--bad-fg)]">{scanMsg}</p>}
      </div>
      {picked && (
        <form action={action} className="grid gap-2 rounded-[14px] bg-surface-2 p-3" key={`${picked.lotId}-${picked.locationId}`}>
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="stepNo" value={stepNo} />
          <input type="hidden" name="lotRef" value={picked.lotId} />
          <input type="hidden" name="locationRef" value={picked.locationId} />
          <p className="text-[16px] text-fg">
            {picked.materialName} from lot <span className="font-mono font-semibold">{picked.lotNumber}</span> (shelf {picked.shelf})
          </p>
          <label className="flex flex-col gap-1 text-[15px] font-medium">
            How many did you take?
            <Input name="qty" inputMode="numeric" defaultValue={qtyDefault} className="min-h-[56px] text-[18px]" required />
            {fe.qty && <span className="text-[14px] text-[var(--bad-fg)]">{fe.qty}</span>}
            {fe.lot && <span className="text-[14px] text-[var(--bad-fg)]">{fe.lot}</span>}
            {fe.location && <span className="text-[14px] text-[var(--bad-fg)]">{fe.location}</span>}
          </label>
          <SubmitButton variant="cta" size="lg" pendingText="Saving…">
            I took these
          </SubmitButton>
        </form>
      )}
      <FormMessage state={state} />
    </section>
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
