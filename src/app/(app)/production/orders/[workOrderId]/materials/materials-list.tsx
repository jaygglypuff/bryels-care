"use client";
import { AlertOctagon, Check, Circle, MapPin } from "lucide-react";
import Link from "next/link";
import { plainNumber } from "@/modules/production/floor-words";
import { useState } from "react";
import Decimal from "decimal.js";
import { fmtDate } from "@/lib/qty";
import { Button, cx, Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { ScanOrPick } from "@/ui/scan-or-pick";
import { pickAction } from "../flow-actions";

type Line = {
  id: string;
  name: string;
  qty: string;
  uom: string;
  state: "open" | "taken" | "not_needed" | "untaken";
  by: string | null;
  reason: string | null;
  /** Wrapper, label or box (ADR-088 §3): taken now, used at the packaging step, never weighed. */
  packaging?: boolean;
  lots: {
    lotNumber: string;
    place: string;
    section: string;
    expiresOn: string | null;
    problem: string | null;
  }[];
  /** ADR-106 §1–2: what to bring, lot by lot, in use-first order ("take all 1 kg of lot … + bring lot … (50 kg in it) …"). */
  plan?: { sentence: string; steps: { lotNumber: string; text: string; place?: string; take?: string; onHand?: string; all?: boolean }[] };
  /** Round 5 problem 9: "Not enough in this container? Take a second lot" (weighed from two lots at Weigh). */
  moreHref?: string;
};

/** Round 5 B7: the same number everywhere (17.919 kg here and on Weigh), never 17.92 here and 17.919 there. */
const amount = (qty: string, uom: string) => {
  const d = new Decimal(qty || 0);
  if (uom === "g" && d.abs().gte(1000)) return `${plainNumber(d.div(1000).toDecimalPlaces(3))} kg`;
  if (uom === "mL" && d.abs().gte(1000)) return `${plainNumber(d.div(1000).toDecimalPlaces(3))} L`;
  return `${plainNumber(d.toDecimalPlaces(3))} ${uom}`;
};

/**
 * The Materials list rows, grouped by warehouse section (ADR-077), with a Taken toggle per line and
 * one primary button "All taken" (UX review S3, S4: "Taken", never "Got it"). Every tap is a server
 * command (confirmPicked); the page re-renders in place with the new state (ADR-043).
 */
export function MaterialsList({
  batchId,
  lines,
  canTick,
  scanLots,
  typedChecks = true,
  moveStock,
  allDone,
  notDoneWord = "Not yet",
}: {
  batchId: string;
  lines: Line[];
  canTick: boolean;
  scanLots: boolean;
  /** ADR-126: the lot check takes typing (setting `scan.typed_code_counts_as_check`). */
  typedChecks?: boolean;
  moveStock: boolean;
  allDone: boolean;
  /** "Not ticked" once the batch is past this list (re-audit N1): nothing left to do, so never "Not yet". */
  notDoneWord?: string;
}) {
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    const g = l.lots[0]?.section ?? "Not set aside for this batch";
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }
  const open = lines.filter(
    (l) => l.state === "open" || l.state === "untaken",
  ).length;
  return (
    <>
      <div
        className={cx("grid gap-4", groups.size >= 3 ? "lg:grid-cols-2" : "")}
      >
        {[...groups.entries()].map(([section, ls]) => (
          <section
            key={section}
            aria-label={section}
            className="rounded-[20px] border border-line bg-surface p-3 sm:p-4"
          >
            <h2 className="mb-2 px-1 text-[15px] font-semibold uppercase tracking-wide text-muted">
              {section}
            </h2>
            <ul className="divide-y divide-line">
              {ls.map((l) => (
                <PickRow
                  key={l.id}
                  batchId={batchId}
                  line={l}
                  canTick={canTick}
                  scanLots={scanLots}
                  typedChecks={typedChecks}
                  notDoneWord={notDoneWord}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {moveStock && (
        <p className="mt-3 text-[14px] text-muted">
          This site moves the stock to the production area with each tick.
        </p>
      )}
      {canTick && !allDone && open > 0 && (
        <AllTaken batchId={batchId} open={open} />
      )}
    </>
  );
}

function PickRow({
  batchId,
  line,
  canTick,
  scanLots,
  typedChecks,
  notDoneWord,
}: {
  batchId: string;
  line: Line;
  canTick: boolean;
  scanLots: boolean;
  typedChecks: boolean;
  notDoneWord: string;
}) {
  const [state, action] = useInPlaceAction(pickAction);
  const [more, setMore] = useState(false);
  const taken = line.state === "taken" || line.state === "not_needed";
  const lot = line.lots[0];
  const risk = line.lots.find((x) => x.problem);
  const fe = state?.fieldErrors ?? {};
  return (
    <li
      className={cx(
        "py-3",
        risk && !taken
          ? "rounded-[12px] border-2 border-[var(--bad-bd)] bg-[var(--bad-bg)] px-2"
          : "",
      )}
      data-testid="pick-row"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {/* Round 5 problem 9: a scannable list, not a paragraph: name and amount, then per lot the shelf and the lot. */}
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[17px] font-semibold text-fg">
            <span>{line.name}</span>
            <span className="tabular">{amount(line.qty, line.uom)}</span>
          </p>
          {line.packaging ? <p className="text-[14px] text-muted">For packing (not weighed)</p> : null}
          {line.plan && line.plan.steps.length > 0 ? (
            <ul className="mt-1 grid gap-1.5 text-[16px] text-fg" data-testid="pick-plan">
              {line.plan.steps.map((st, i) => (
                <li key={`${st.lotNumber}-${i}`} className="grid">
                  <span className="inline-flex items-center gap-1 font-medium">
                    <MapPin size={16} aria-hidden /> {st.place ?? "Shelf not set"}
                  </span>
                  <span>
                    Lot <span className="font-mono font-semibold">…{st.lotNumber.replace(/[^A-Za-z0-9]/g, "").slice(-4)}</span>
                    {st.onHand ? <span className="text-fg-2"> ({amount(st.onHand, line.uom)} in it)</span> : null}
                    {st.all === false && st.take ? <span className="text-fg-2"> · use {amount(st.take, line.uom)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : lot ? (
            <p className="text-[14px] text-muted">
              Lot{" "}
              <span className="font-mono font-semibold text-fg">
                {lot.lotNumber}
              </span>
              {line.lots.length > 1
                ? ` (+${line.lots.length - 1} more)`
                : ", use first"}{" "}
              · {lot.place}
              {lot.expiresOn ? ` · expires ${fmtDate(lot.expiresOn)}` : ""}
            </p>
          ) : (
            <p className="text-[14px] text-muted">Use the oldest usable lot.</p>
          )}
          {risk && !taken && (
            <p className="mt-1 inline-flex items-center gap-1 text-[14px] font-semibold text-[var(--bad-fg)]">
              <AlertOctagon size={16} aria-hidden /> {risk.problem}. Use another
              lot: ask QA.
            </p>
          )}
          {line.state === "taken" && line.by && (
            <p className="text-[13px] text-muted">Taken by {line.by}</p>
          )}
          {line.state === "not_needed" && (
            <p className="text-[13px] text-muted">
              Not needed{line.reason ? `: ${line.reason}` : ""}. It is still
              weighed.
            </p>
          )}
        </div>
        {canTick && scanLots && !taken ? (
          <button
            type="button"
            onClick={() => setMore(true)}
            className="inline-flex min-h-[52px] min-w-[120px] items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-6 text-[16px] font-medium text-fg"
            disabled={!!risk}
          >
            <Circle size={20} aria-hidden /> Scan
          </button>
        ) : canTick ? (
          <form action={action}>
            <input type="hidden" name="batchId" value={batchId} />
            <input type="hidden" name="batchMaterialId" value={line.id} />
            <input
              type="hidden"
              name="pick"
              value={taken ? "untaken" : "taken"}
            />
            <SubmitButton
              variant="secondary"
              size="lg"
              pendingText="…"
              className="min-w-[120px]"
              aria-pressed={taken}
              disabled={!!risk && !taken}
            >
              {taken ? (
                <>
                  <Check size={20} aria-hidden /> Taken
                </>
              ) : (
                <>
                  <Circle size={20} aria-hidden /> Taken
                </>
              )}
            </SubmitButton>
          </form>
        ) : (
          <span
            className={cx(
              "inline-flex min-h-[52px] items-center gap-1 rounded-full border px-4 text-[15px]",
              taken
                ? "border-[var(--ok-bd)] text-[var(--ok-fg)]"
                : "border-line text-muted",
            )}
          >
            {taken ? (
              <Check size={18} aria-hidden />
            ) : (
              <Circle size={18} aria-hidden />
            )}{" "}
            {taken ? "Taken" : notDoneWord}
          </span>
        )}
      </div>
      {/* Round 5 B7: a row keeps no stale "1 of 7 taken." — the tick shows it; only a refusal stays here. */}
      {state && !state.ok && <FormMessage state={state} />}
      {canTick && !taken && (
        <div className="mt-1">
          <button
            type="button"
            className="min-h-[44px] text-[14px] text-primary-text underline"
            onClick={() => setMore(!more)}
            aria-expanded={more}
          >
            More details
          </button>
          {more && (
            <MoreDetails
              batchId={batchId}
              line={line}
              scanLots={scanLots}
              typedChecks={typedChecks}
              error={fe.lotCode ?? fe[`lot-${line.id}`]}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** Per line: scan the label (when the site asks for it) and "Not needed" with a reason. */
function MoreDetails({
  batchId,
  line,
  scanLots,
  typedChecks,
  error,
}: {
  batchId: string;
  line: Line;
  scanLots: boolean;
  typedChecks: boolean;
  error?: string;
}) {
  const [state, action] = useInPlaceAction(pickAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <div className="mt-2 grid gap-3 rounded-[12px] bg-surface-2 p-3">
      {!line.packaging && line.moreHref && (
        <div className="grid gap-1" data-testid="second-lot">
          <p className="text-[15px] font-semibold">Container almost empty?</p>
          <p className="text-[14px] text-fg-2">
            Take this container and the next lot to use{line.lots[1] ? ` (lot …${line.lots[1].lotNumber.replace(/[^A-Za-z0-9]/g, "").slice(-4)}, ${line.lots[1].place})` : ""}. Tap Taken, then weigh from both lots.
          </p>
          <Link href={line.moreHref} className="inline-flex min-h-[44px] items-center text-[15px] text-primary-text underline">
            Use a second lot for {line.name}
          </Link>
        </div>
      )}
      {scanLots && (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="batchMaterialId" value={line.id} />
          <input type="hidden" name="pick" value="taken" />
          <div className="min-w-[220px] flex-1">
            {/* ADR-098: the site asks to read each label: scan it, or type the lot number printed on it (owner 2026-11-08, saved as typed). A tap is not a check (A-SCAN-11). */}
            <ScanOrPick
              kind="lot"
              name="lotCode"
              viaName="lotVia"
              submit="code"
              label={typedChecks ? "Scan the lot label, or type its number" : "Scan the lot label"}
              hint={typedChecks ? "Camera, handheld scanner, or the lot number printed on the label." : "Camera or handheld scanner."}
              allowTyping={typedChecks}
              notListed="That is not the lot to take. Check the label and type it again."
              candidatesLabel="Lot to take"
              candidates={line.lots.map((l) => ({ value: l.lotNumber, title: line.name, detail: `lot ${l.lotNumber} · ${l.place}`, code: l.lotNumber, codes: [l.lotNumber] }))}
              allowTap={false}
              onlyCandidates
              search={false}
              required
            />
          </div>
          <SubmitButton size="lg">Taken</SubmitButton>
          {(error || fe[`lot-${line.id}`]) && (
            <p className="w-full text-[13px] text-[var(--bad-fg)]">
              {error ?? fe[`lot-${line.id}`]}
            </p>
          )}
        </form>
      )}
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="batchMaterialId" value={line.id} />
        <input type="hidden" name="pick" value="not_needed" />
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[14px] font-medium">
          Not needed because
          <Input
            name="reason"
            defaultValue="Already in the room"
            className="min-h-[52px] text-[16px]"
          />
        </label>
        <SubmitButton variant="secondary" size="lg">
          Not needed
        </SubmitButton>
        <p className="w-full text-[13px] text-muted">
          It is still weighed on the Weigh screen.
        </p>
      </form>
      <FormMessage state={state} />
    </div>
  );
}

function AllTaken({ batchId, open }: { batchId: string; open: number }) {
  const [state, action] = useInPlaceAction(pickAction);
  // ADR-083: one tap must not mark every material taken by accident; ask on the page first.
  const [sure, setSure] = useState(false);
  return (
    <div className="z-10 mt-4 rounded-[20px] border border-line bg-surface p-3 shadow-[var(--shadow-pop)]">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="all" value="1" />
        {sure ? (
          <>
            <p className="min-w-0 flex-1 text-[15px] font-medium text-fg">
              Mark all {open} {open === 1 ? "material" : "materials"} as taken?
            </p>
            <Button type="button" variant="secondary" size="lg" onClick={() => setSure(false)}>
              Cancel
            </Button>
            <SubmitButton variant="cta" size="lg" pendingText="Saving…">
              Yes, all taken
            </SubmitButton>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-[15px] text-muted">{open} still to take.</p>
            <Button type="button" variant="cta" size="lg" className="min-w-[200px]" onClick={() => setSure(true)}>
              All taken
            </Button>
          </>
        )}
      </form>
      <FormMessage state={state} />
    </div>
  );
}
