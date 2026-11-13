import type { FinishView } from "@/modules/production";
import { finishCheckFacts, pieceWord } from "@/modules/production";
import { Card, EmptyState } from "@/ui/core";
import { Banner } from "@/ui/status";
import { WhoCanHelp } from "@/ui/who-can-help";
import { FinishForm, ReturnWrappers, TakeBack } from "./forms";

/**
 * The Finish form inside a step card (round 5 problem 2 and B19): the last step "Move to the QA waiting area" IS
 * Finish, so it shows in the same step template ("Step 7 of 7", round back button, one green button). The box and
 * piece labels are not repeated here: they belong to the packing step. Every rule is in finishBatch.
 */
export function FinishPanel({ v }: { v: FinishView }) {
  const word = pieceWord(v.product.family, 2);
  const finished = v.batch.status === "awaiting_qc" || v.batch.status === "quarantined";
  return (
    <div className="grid gap-4" data-testid="finish-panel">
      {finished ? (
        <Banner tone="ok" title="This batch is finished">
          It is in the QA waiting area. QA checks it next.
        </Banner>
      ) : v.blockers.length > 0 ? (
        <Banner tone="warn" title="Not ready to finish">
          <ul className="list-disc pl-5">
            {v.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Banner>
      ) : !v.can.finish ? (
        <Card>
          <EmptyState title="Someone from production finishes this batch">
            <WhoCanHelp permission="production.batch.post" siteId={v.batch.siteId} hideEmails />
          </EmptyState>
        </Card>
      ) : !v.hold ? (
        <Banner tone="bad" title="No QA waiting area">
          This site has no QA waiting area for finished batches. Ask an administrator to add one (section Waiting for QA / on hold).
        </Banner>
      ) : v.finishCheck?.status === "waiting" ? (
        // ADR-133: the counts wait for the second person's "Looks right" on their own phone.
        <section className="grid gap-3 rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-4 sm:p-5" data-testid="finish-check-waiting">
          <p className="text-[18px] font-semibold" role="status">
            {v.finishCheck.words}
          </p>
          <ul className="grid gap-1 rounded-[14px] bg-surface-2 p-3 text-[16px]">
            {finishCheckFacts(v.finishCheck.summary).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="text-[15px] text-fg-2">When they say &quot;Looks right&quot;, the batch goes to the QA waiting area by itself. You can go on with other work.</p>
          {v.finishCheck.mine && <TakeBack batchId={v.batch.id} />}
        </section>
      ) : (
        <section className="rounded-[20px] border border-line bg-surface p-4 sm:p-5">
          <noscript>Finishing needs a connection and JavaScript.</noscript>
          {v.finishCheck?.status === "returned" && (
            <div className="mb-4" data-testid="finish-check-returned">
              <Banner tone="warn" title="Not right">
                {v.finishCheck.words}
              </Banner>
            </div>
          )}
          <FinishForm
            batchId={v.batch.id}
            batchNumber={v.batch.number}
            orderId={v.order?.id ?? null}
            pieceWord={word}
            expected={v.expectedUnits}
            unitNetMassG={v.product.unitNetMassG}
            theoreticalYieldG={v.batch.theoreticalYieldG}
            limits={v.limits}
            log={v.log}
            existingScrap={v.existing.scrap}
            defectTypes={v.defectTypes}
            samples={v.samples.units}
            boxedPieces={v.boxes.plan && !v.boxes.plan.boxed ? v.boxes.plan.pieces : null}
            packaging={v.packaging}
            rejectApproval={v.rejectApproval}
            hold={v.hold}
            holdOptions={v.holdOptions}
            needsChecker={v.needsChecker}
            checkers={v.checkers}
            sameDevice={v.sameDevice}
          />
        </section>
      )}
      {finished && v.leftOver.some((x) => x.toLocationId) && <ReturnWrappers batchId={v.batch.id} items={v.leftOver} canReturn={v.can.finish} />}
    </div>
  );
}
