import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { type PaperEntryView, batchStateWord, paperEntryView } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { Card, EmptyState, LinkButton } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { RecordHeader } from "@/ui/record";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { StepFromPaperForm, WeighLineForm } from "../paper-forms";

registerAppHooks();

export const metadata: Metadata = { title: "Enter from the paper record" };
export const dynamic = "force-dynamic";

const HOLD_KINDS = ["hold", "curing"];

function pageChip(p: PaperEntryView["pages"][number]) {
  if (p.status === "reviewed") return <Chip tone="ok">Checked against the scan</Chip>;
  if (p.status === "attached") return <Chip tone="appr">Scan attached, waiting for its check</Chip>;
  if (p.status === "returned") return <Chip tone="warn">Sent back: correct and attach again</Chip>;
  if (p.stepStatus === "completed") return p.stepFromPaper ? <Chip tone="ok">Typed in ✓</Chip> : <Chip tone="ok">Done in the system</Chip>;
  if (p.stepStatus === "awaiting_check") return <Chip tone="appr">Waiting for the checker</Chip>;
  return <Chip tone="neu">To type</Chip>;
}

/**
 * ADR-134 "Enter from the paper record": the pages of the batch's paper record in the order of the paper. For each
 * page: its weighing lines (weighing step) or its checklist and readings, then who did it, who checked it and the time
 * written on the paper. Afterwards the pages are scanned and attached, and another person checks them (closure page).
 */
export default async function FromPaperPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production batches" permission="production.batch.view" />;
  let v: PaperEntryView;
  try {
    v = await paperEntryView(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) {
      return (
        <EmptyState title="Batch not found" action={<LinkButton href="/production" variant="secondary">Back to batch records</LinkButton>}>
          It belongs to a site you are not assigned to, or it was removed.
        </EmptyState>
      );
    }
    throw e;
  }
  const scales = v.equipment.filter((e) => e.kind === "scale").map((e) => ({ value: e.code, label: `${e.code} · ${e.name}` }));
  const machines = v.equipment.map((e) => ({ value: e.code, label: `${e.code} · ${e.name}` }));
  return (
    <div className="flex flex-col gap-5">
      <div>
        <RecordHeader back={{ href: `/production/${v.batch.id}`, label: "Batch record" }} typeLabel="Enter from the paper record" reference={v.batch.number} title={v.batch.productName} status={v.batch.status} statusLabel={batchStateWord(v.batch.status)} meta={[v.batch.siteCode]} />
        <PageIntro>Type each line as it is written on the paper, in the same order. Use the time written on the paper, not the time now. Every line is marked &quot;from paper&quot;.</PageIntro>
      </div>
      {!v.canEnter && <Banner tone="info" title="You can read this page">Typing lines in needs a production role at this site.</Banner>}
      {!v.outageAllowed && (
        <Banner tone="warn" title="Weighing must be done in the system here">
          At this site, weighing and the move to the hold area cannot be typed in from paper. Other steps can.
        </Banner>
      )}
      {v.pages.length === 0 ? (
        <Card>
          <EmptyState title="No paper record for this batch" action={<LinkButton href={`/production/${v.batch.id}`} variant="secondary">Back to the batch</LinkButton>}>
            Open the batch and tap Get the paper record ready while the internet works.
          </EmptyState>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="paper-pages">
          {v.pages.map((p) => {
            const open = p.status === "issued" || p.status === "returned";
            const todo = open && p.stepStatus !== "completed" && p.stepStatus !== "awaiting_check";
            return (
              <li key={p.paperRecordId}>
                <details className="rounded-[8px] border border-line bg-surface px-4 py-1" open={todo && v.canEnter ? true : undefined} data-testid={`paper-page-${p.stepNo}`}>
                  <summary className="flex min-h-[56px] cursor-pointer list-none flex-wrap items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
                    <span className="font-mono text-[13px] text-muted">{p.reference}</span>
                    <span className="min-w-0 flex-1 break-words text-[15px] font-medium">
                      Step {p.stepNo}: {p.stepName}
                    </span>
                    {pageChip(p)}
                  </summary>
                  <div className="flex flex-col gap-4 pb-4">
                    <p className="text-[13px] text-muted">
                      {p.documentNumber ?? "—"} · printed {fmtDateTime(p.issuedAt)}
                      {p.entries ? ` · ${p.entries} ${p.entries === 1 ? "line" : "lines"} typed from this page` : ""}
                    </p>
                    {!open ? (
                      <p className="text-[14px] text-fg-2">Nothing more can be typed from this page.</p>
                    ) : !v.canEnter ? null : p.stepKind === "transfer" ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-[14px]">The finish counts and the move to the hold area are typed on the Finish screen: it counts the pieces and moves the stock.</p>
                        <LinkButton href={`/production/${v.batch.id}/finish`} variant="secondary" size="lg">
                          Open Finish
                        </LinkButton>
                      </div>
                    ) : (
                      <>
                        {p.weighings.map((w) =>
                          w.done ? (
                            <p key={w.batchMaterialId} className="text-[14px]">
                              {w.materialName}: <b>weighed</b>
                              {w.fromPaper ? " (from paper)" : ""}
                              {w.status === "exception" && <Chip tone="warn">QA decides</Chip>}
                            </p>
                          ) : (
                            <section key={w.batchMaterialId} aria-label={w.materialName} className="rounded-[8px] border border-line p-3">
                              <h3 className="mb-2 text-[15px] font-semibold">
                                {w.lineNo}. {w.materialName} <span className="font-mono text-[12px] font-normal text-muted">{w.materialCode}</span>
                              </h3>
                              <WeighLineForm batchId={v.batch.id} paperRecordId={p.paperRecordId} line={w} people={v.people.doers} checkers={v.people.checkers} scales={scales} outageReasons={v.outageReasons} />
                            </section>
                          ),
                        )}
                        {todo && (
                          <section aria-label={`Step ${p.stepNo} done`} className="rounded-[8px] border border-line p-3">
                            <h3 className="mb-2 text-[15px] font-semibold">{p.weighings.length ? "When every line is typed: the weighing step is done" : "The step as written on the paper"}</h3>
                            <StepFromPaperForm
                              batchId={v.batch.id}
                              step={{ stepNo: p.stepNo, paperRecordId: p.paperRecordId, outage: p.neverPaperOnly, requiresEquipment: p.requiresEquipment && !p.weighings.length, isHold: HOLD_KINDS.includes(p.stepKind ?? ""), checklist: p.checklist, parameters: p.parameters }}
                              people={v.people.doers}
                              checkers={v.people.checkers}
                              equipment={machines}
                              outageReasons={v.outageReasons}
                            />
                          </section>
                        )}
                      </>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}
      {v.pages.length > 0 && (
        <Card>
          <p className="text-[14px]">
            Next: scan or photograph every written page and attach it. Another person, who typed none of it, checks it against the scan. The batch cannot pass QA before that.
          </p>
          {ctx.can("production.batch.approve") || ctx.can("production.batch.admin") || ctx.can("quality.disposition.approve") ? (
            <div className="mt-2">
              <LinkButton href={`/production/${v.batch.id}/closure`} variant="secondary" size="lg">
                Attach the scanned pages
              </LinkButton>
            </div>
          ) : (
            <p className="mt-1 text-[14px] text-muted">Give the written pages to your supervisor or QA: they attach the scans.</p>
          )}
        </Card>
      )}
    </div>
  );
}
