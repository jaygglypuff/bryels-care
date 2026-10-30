"use client";
import { AlertOctagon, Check, Circle } from "lucide-react";
import { useState } from "react";
import { fmtDate, fmtMass, fmtQty } from "@/lib/qty";
import { Button, cx, Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { pickAction } from "../flow-actions";

type Line = {
  id: string;
  name: string;
  qty: string;
  uom: string;
  state: "open" | "taken" | "not_needed" | "untaken";
  by: string | null;
  reason: string | null;
  lots: {
    lotNumber: string;
    place: string;
    section: string;
    expiresOn: string | null;
    problem: string | null;
  }[];
};

const amount = (qty: string, uom: string) =>
  uom === "g" ? fmtMass(qty) : fmtQty(qty, uom, 0);

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
  moveStock,
  allDone,
}: {
  batchId: string;
  lines: Line[];
  canTick: boolean;
  scanLots: boolean;
  moveStock: boolean;
  allDone: boolean;
}) {
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    const g = l.lots[0]?.section ?? "Not set aside";
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
}: {
  batchId: string;
  line: Line;
  canTick: boolean;
  scanLots: boolean;
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
          <p className="text-[17px] font-semibold text-fg">{line.name}</p>
          <p className="text-[16px] tabular text-fg">
            {amount(line.qty, line.uom)}
          </p>
          {lot ? (
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
            className="inline-flex min-h-[52px] min-w-[120px] items-center justify-center gap-2 rounded-full border border-transparent bg-primary px-6 text-[16px] font-medium text-white"
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
              variant={taken ? "secondary" : "primary"}
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
            {taken ? "Taken" : "Not yet"}
          </span>
        )}
      </div>
      <FormMessage state={state} />
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
  error,
}: {
  batchId: string;
  line: Line;
  scanLots: boolean;
  error?: string;
}) {
  const [state, action] = useInPlaceAction(pickAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <div className="mt-2 grid gap-3 rounded-[12px] bg-surface-2 p-3">
      {scanLots && (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="batchMaterialId" value={line.id} />
          <input type="hidden" name="pick" value="taken" />
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[14px] font-medium">
            Scan the lot label
            <Input
              id={`lot-${line.id}`}
              name="lotCode"
              autoComplete="off"
              placeholder="BC:LOT:…"
              className="min-h-[52px] font-mono text-[16px]"
            />
          </label>
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
