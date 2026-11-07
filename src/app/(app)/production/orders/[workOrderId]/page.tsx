import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { batchQaNext, productionOrderNext } from "@/modules/production";
import { NextApprover } from "@/ui/next-approver";
import type { NextActors } from "@/lib/next-actors-words";
import { assigneeChoices, auditSentence, batchPlanWords, batchRecordHref, continueHref, defectTypes, getProductionOrder, NO_ORDER_SEGMENT, orderStateWord, plainReason, workOrderFormOptions, type DailyLogRow, type ProductionOrderView } from "@/modules/production";
import { Card, CardTitle, EmptyState, LinkButton, cx } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { Banner, Chip } from "@/ui/status";
import { Help } from "@/ui/help/help";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Forbidden } from "../../../forbidden";
import { AssignForm, ApproveButton, CancelOrderForm, DailyLogForm, PlanBatchButton, SetAsideAgainButton } from "../forms";
import { WorkOrderForm } from "../../work-orders/wo-form";
import { ActionButton, DefectTables, NeededBy, OrderStatusChip, OrderWarning } from "../parts";
import { Hourglass } from "lucide-react";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "Production order" };
export const dynamic = "force-dynamic";

const TABS = [
  ["today", "Today"],
  ["log", "Daily log"],
  ["materials", "Materials"],
  ["output", "Batches"],
] as const;
type Tab = (typeof TABS)[number][0];

const qty = (v: string, uom: string) => (uom === "g" ? fmtMass(v) : fmtQty(v, uom, 1));
const pcs = (v: string) => fmtQty(v, "", D(v).isInteger() ? 0 : 1);

/** "378 bars expected · 4 batches", or once something is made "123 bars made so far · 1 of 4 batches finished". */
function headerPieces(v: ProductionOrderView): string {
  const total = v.statusView.batchesTotal || v.detail.workOrder.batchCount;
  const finished = v.batches.filter((b) => !["planned", "materials_staged", "in_process", "rework_approved", "draft"].includes(b.status) && !(b.status === "rejected" && !b.startedAt)).length;
  if (v.pieces.word !== "made") return `${v.pieces.text} expected`;
  const pieces = v.pieces.text.split(" · ")[0];
  return total > 1 ? `${pieces} made so far · ${finished} of ${total} batches finished` : `${pieces} made`;
}

/** The body line under the strip, in the same words: finished and decided by QA. */
function batchesWords(v: ProductionOrderView): string {
  const total = v.statusView.batchesTotal;
  const finished = v.batches.filter((b) => !["planned", "materials_staged", "in_process", "rework_approved", "draft"].includes(b.status) && !(b.status === "rejected" && !b.startedAt)).length;
  return `${finished} of ${total} finished · ${v.statusView.batchesDone} of ${total} decided by QA`;
}

/**
 * The order's one next step, in the header's "What to do next" box (ADR-123; was its own "Next step" card, shown twice
 * for phone and desktop). Same controls, same conditions: the plan button, the order's next action (a link, Approve,
 * or a wait with who can help), the not-ready warning (ADR-116) and who approves the order (docs/NEXT_APPROVER.md).
 */
function nextSlots(v: ProductionOrderView, planKey: string, approvalNext: NextActors | null): { next: React.ReactNode; primary?: React.ReactNode; waitingFor?: React.ReactNode } {
  const a = v.nextAction;
  // UX review: an approved order without a batch says why nothing can be done, and whom to ask.
  if (v.noBatchPlanned)
    return {
      next: `This order is approved but no batch is planned yet. ${v.canPlanBatch ? "You can plan it." : v.planner ? `Ask ${v.planner.name} to plan it.` : "Ask your supervisor to plan it."}`,
      // Re-audit N2 (ADR-105): planned here, never on the old order view. The batch uses the versions fixed at approval.
      primary: v.canPlanBatch ? <PlanBatchButton workOrderId={v.detail.workOrder.id} idempotencyKey={planKey} /> : undefined,
      waitingFor: v.canPlanBatch ? undefined : <WhoCanHelp permission="production.batch.create" siteId={v.detail.workOrder.siteId} hideEmails lead="Who can plan it: " />,
    };
  const wait =
    a.kind === "wait" || approvalNext ? (
      <>
        {a.kind === "wait" && <span className="block font-medium text-fg">{a.title}</span>}
        {a.kind === "wait" && a.who && <WhoCanHelp permission={a.who.permission} siteId={a.who.siteId} hideEmails />}
        {approvalNext && <NextApprover next={approvalNext} inline className="block" />}
      </>
    ) : undefined;
  if (v.notReady)
    // ADR-116: approval would refuse; say why and who acts, instead of a button that fails.
    return {
      next: (
        <span role="status" className="block text-[var(--warn-fg)]" data-testid="order-not-ready">
          {v.notReady}
        </span>
      ),
      waitingFor: approvalNext ? <NextApprover next={approvalNext} inline /> : undefined,
    };
  return {
    next: a.hint || (a.kind === "wait" ? a.title : "Nothing to press yet."),
    primary: a.kind === "approve" || a.kind === "link" ? <ActionButton a={a} size="md" approve={<ApproveButton workOrderId={v.detail.workOrder.id} />} /> : undefined,
    waitingFor: wait ?? (a.kind === "wait" ? "Nothing to press yet." : undefined),
  };
}

/** Multi-batch orders: one row per batch with its own status and button (UX review S2). */
function BatchRows({ v }: { v: ProductionOrderView }) {
  if (v.batchActions.length === 0) return null;
  return (
    <Card>
      <CardTitle>Batches</CardTitle>
      <ul className="space-y-2">
        {v.batchActions.map((b) => (
          <li key={b.batchId} className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-line p-3.5">
            <div className="min-w-0">
              <p className="font-mono text-[13px] font-semibold">{b.batchNumber}</p>
              <p className="text-[14px] text-fg-2">
                {b.label}
                {b.subtitle ? ` · ${b.subtitle}` : ""}
              </p>
            </div>
            <div className="min-w-[160px]">
              {b.action.kind === "none" ? <p className="text-[13px] text-muted">{b.action.hint}</p> : <ActionButton a={b.action} size="md" secondary />}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LogEntry({ e, v, types, canCorrect }: { e: DailyLogRow; v: ProductionOrderView; types: string[]; canCorrect: boolean }) {
  const replaced = !!e.replacedById;
  return (
    <li className={cx("rounded-[16px] border border-line p-3.5", replaced && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-medium">
          {fmtDate(e.logDate)}
          {e.shift ? ` · ${e.shift}` : ""}
          {e.batchNumber ? ` · ${e.batchNumber}` : ""}
        </p>
        <div className="flex flex-wrap gap-1">
          {e.correctsId && <Chip tone="info">Correction</Chip>}
          {replaced && <Chip tone="neu">Replaced – not counted</Chip>}
        </div>
      </div>
      {e.notes && <p className="mt-1 whitespace-pre-line text-[14px]">{e.notes}</p>}
      <p className="mt-1 text-[14px]">
        Good: <span className="font-semibold tabular">{pcs(e.goodQty)}</span>
        {e.defects.length > 0 && (
          <>
            {" "}· Rejects: <span className="font-semibold tabular">{pcs(e.defectTotal)}</span> ({e.defects.map((d) => `${d.defectType} ${pcs(d.quantity)}`).join(", ")})
          </>
        )}
      </p>
      {e.correctionReason && <p className="mt-1 text-[13px] text-fg-2">Why corrected: {e.correctionReason}</p>}
      <p className="mt-1 text-[12px] text-muted">
        {e.author} · {fmtDateTime(e.createdAt)}
      </p>
      {canCorrect && !replaced && (
        <details className="mt-2">
          <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium text-primary-text">Correct this entry</summary>
          <div className="mt-2">
            <DailyLogForm
              workOrderId={v.detail.workOrder.id}
              defectTypes={types}
              batches={v.batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber }))}
              today={v.today}
              initial={{ logId: e.id, logDate: e.logDate, shift: e.shift, notes: e.notes, goodQty: e.goodQty, batchId: e.batchId, defects: e.defects }}
            />
          </div>
        </details>
      )}
    </li>
  );
}

export default async function ProductionOrderPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ tab?: string; finished?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.view")) return <Forbidden what="production orders" permission="production.work_order.view" />;
  const { workOrderId } = await params;
  // Flow screens of a batch without an order live under /production/orders/without-order/…; it has no hub.
  if (workOrderId === NO_ORDER_SEGMENT) redirect("/production/orders");
  const sp = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "today";
  let v: ProductionOrderView;
  let approvalNext: NextActors | null = null;
  let finishedQaNext: NextActors | null = null;
  try {
    v = await getProductionOrder(ctx, workOrderId);
    approvalNext = await productionOrderNext(ctx, workOrderId);
    const fin = sp.finished ? v.batches.find((b) => b.batchNumber === sp.finished) : null;
    // Back from Finish: who decides the batch on Check quality (QA only; docs/NEXT_APPROVER.md).
    finishedQaNext = fin ? await batchQaNext(ctx, fin.id) : null;
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const d = v.detail;
  const wo = d.workOrder;
  const types = v.canAddLog ? await defectTypes(ctx, wo.siteId) : [];
  const people = v.canAssign ? await assigneeChoices(ctx, wo.id) : [];
  const todays = v.logs?.filter((l) => l.logDate === v.today && !l.replacedById) ?? [];
  const missing = d.materials.filter((m) => D(m.short).gt(0));
  const batchOptions = v.batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber }));
  // One key per page view: a double click on "Plan the batch" replays the same command, a new view is a new command.
  const planKey = crypto.randomUUID();
  const editOpts = d.actions.canEdit ? await workOrderFormOptions(ctx) : null;
  // "Plan another batch": fewer live batches than ordered (one was stopped before it started) while others exist.
  const canPlanAnother = d.actions.canCreateBatch && !v.noBatchPlanned && v.batches.length < wo.batchCount;
  const history = [
    ...d.audits.map((a) => ({ at: a.occurredAt, who: a.actor ?? a.actorLabel ?? "System", text: auditSentence(a), reason: plainReason(a.reason) })),
    ...d.transitions.map((t) => ({ at: t.occurredAt, who: t.actor ?? "System", text: `${t.fromState ? `${orderStateWord(t.fromState)} → ` : ""}${orderStateWord(t.toState)}`, reason: null as string | null })),
  ].sort((a, z) => new Date(z.at).getTime() - new Date(a.at).getTime());

  return (
    <div>
      <RecordHeader
        back={{ href: "/production/orders", label: "Production orders" }}
        typeLabel="Production order"
        reference={wo.workOrderNumber}
        title={d.product.name}
        chip={
          <>
            <OrderStatusChip status={v.status} label={v.statusLabel} subtitle={v.statusView.subtitle} warn={v.statusView.warn} />
            <OrderWarning text={v.statusView.warning} />
          </>
        }
        meta={[
          // ADR-110 C19: one story for the header and the body — pieces made so far and batches finished, not "4 batches made".
          <span key="pieces" className="font-medium text-fg" data-testid="order-pieces">
            {headerPieces(v)}
          </span>,
          v.neededBy ? <NeededBy key="needed" date={v.neededBy} late={v.late} /> : null,
          v.assignee ? (v.assignee.id === ctx.userId ? "Assigned to you" : `Assigned to ${v.assignee.name}`) : "Anyone can take it",
          d.salesOrder ? (
            <span key="so">
              For{" "}
              {ctx.can("sales.sales_order.view") ? (
                <Link href={`/sales/${d.salesOrder.id}`} className="underline">
                  {d.salesOrder.number}
                </Link>
              ) : (
                d.salesOrder.number
              )}{" "}
              ({d.salesOrder.customerName})
            </span>
          ) : null,
        ]}
        actions={<Help screen="production.production_order" />}
        steps={v.status === "cancelled" || v.status === "failed" || !v.progress.steps ? [] : v.progress.steps.map((x) => ({ label: x.label, state: x.state === "todo" ? "upcoming" : (x.state as "done" | "current") }))}
        {...nextSlots(v, planKey, approvalNext)}
      />
      <PageIntro>One production order: what to make, its batches, and the one thing to do next.</PageIntro>

      {sp.finished && v.batches.some((b) => b.batchNumber === sp.finished) && (
        <div className="mb-4">
          {/* ADR-080 G3: back from Finish batch (UX review S6). */}
          <Banner tone="ok" title={`Batch ${sp.finished} finished`}>
            It waits in the QA hold area for the quality check; when QA says OK it moves to the finished-goods shelf.{" "}
            <NextApprover next={finishedQaNext} inline />
          </Banner>
        </div>
      )}
      {v.status === "cancelled" ? (
        <div className="mb-4">
          <Banner tone="neu" title="Cancelled">{wo.cancelReason}</Banner>
        </div>
      ) : v.status === "failed" || !v.progress.steps ? (
        <div className="mb-4">
          <Banner tone="rej" title="Failed">Every batch of this order failed the quality check. Nothing from it can be sold.</Banner>
        </div>
      ) : (
        (v.statusView.stepNote || v.statusView.batchesTotal > 1) && (
          // The progress strip is in the header (ADR-123); its note and the batch count stay as one small line.
          <p className="-mt-2 mb-4 flex flex-wrap items-center gap-x-1.5 text-meta text-fg-2" data-testid="order-step-note">
            {v.statusView.stepNote && (
              <span className="inline-flex items-center gap-1.5">
                {/until|time over/.test(v.statusView.stepNote) && <Hourglass size={14} aria-hidden />}
                {v.statusView.stepNote}
              </span>
            )}
            {v.statusView.stepNote && v.statusView.batchesTotal > 1 && <span aria-hidden>·</span>}
            {v.statusView.batchesTotal > 1 && <span className="text-muted">Batches: {batchesWords(v)}</span>}
          </p>
        )
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <nav className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="Production order sections">
            {TABS.map(([k, label]) => (
              <Link key={k} href={`?tab=${k}`} aria-current={k === tab ? "page" : undefined} className={cx("inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full px-4 text-[14px] font-medium", k === tab ? "bg-primary text-white" : "text-fg hover:bg-surface-2")}>
                {label}
              </Link>
            ))}
          </nav>

          <BatchRows v={v} />

          {tab === "today" && (
            <>
              {v.canAddLog && !v.anyBatchStarted ? (
                <EmptyState title="Nothing to write yet">You write what happened each day once a batch of this order has started.</EmptyState>
              ) : v.canAddLog ? (
                <Card>
                  <CardTitle>What happened today?</CardTitle>
                  <DailyLogForm workOrderId={wo.id} defectTypes={types} batches={batchOptions} today={v.today} />
                </Card>
              ) : (
                v.logs !== null && (
                  <EmptyState title="Daily log">{["draft", "planned"].includes(wo.status) ? "The daily log starts once the order is approved." : "Entries can no longer be added to this order."}</EmptyState>
                )
              )}
              {todays.length > 0 && (
                <Card>
                  <CardTitle>Recorded today</CardTitle>
                  <ul className="space-y-2">
                    {todays.map((e) => (
                      <LogEntry key={e.id} e={e} v={v} types={types} canCorrect={false} />
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}

          {tab === "log" &&
            (v.logs === null ? (
              <EmptyState title="You can't see the daily log">Your role does not include the daily log. Ask your site manager if you need it.</EmptyState>
            ) : v.logs.length === 0 ? (
              <EmptyState title="Nothing recorded yet">Each day, write what happened, how many good pieces were made and any rejects.</EmptyState>
            ) : (
              <>
                <ul className="space-y-2">
                  {v.logs.map((e) => (
                    <LogEntry key={e.id} e={e} v={v} types={types} canCorrect={v.canAddLog} />
                  ))}
                </ul>
                {v.summary && (
                  <Card>
                    <CardTitle>Good and rejects</CardTitle>
                    <DefectTables summary={v.summary} showProduct={false} />
                  </Card>
                )}
              </>
            ))}

          {tab === "materials" &&
            (d.materials.length === 0 ? (
              <EmptyState title="Materials appear after approval">Approving the order works out what it needs and sets it aside.</EmptyState>
            ) : (
              <div className="space-y-3">
                {missing.length > 0 && ["released", "in_progress"].includes(wo.status) && (
                  <Banner tone="warn" title="Some materials are missing">
                    {missing.map((m) => `${m.materialName}: ${qty(m.short, m.baseUom)}`).join(" · ")}
                    {d.actions.canTopUp && (
                      <span className="mt-2 block">
                        When new stock has arrived, set it aside for this order:
                        <span className="mt-2 block">
                          <SetAsideAgainButton workOrderId={wo.id} />
                        </span>
                      </span>
                    )}
                  </Banner>
                )}
                {d.materials.map((m) => (
                  <Card key={m.materialId} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 font-medium">{m.materialName}</p>
                      {D(m.short).gt(0) ? <Chip tone="warn">Missing {qty(m.short, m.baseUom)}</Chip> : <Chip tone="ok">Enough</Chip>}
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-[14px]">
                      {(
                        [
                          ["Needed", m.required],
                          ["Set aside", D(m.reserved).plus(m.staged).toString()],
                          ["Used", m.consumed],
                        ] as const
                      ).map(([k, val]) => (
                        <div key={k}>
                          <dt className="text-[12px] text-muted">{k}</dt>
                          <dd className="tabular">{qty(val, m.baseUom)}</dd>
                        </div>
                      ))}
                    </dl>
                    {(m.reservations.length > 0 || m.recommended.length > 0 || m.blocked.length > 0) && (
                      <details className="mt-2 text-[13px]">
                        <summary className="min-h-[44px] cursor-pointer py-2.5 font-medium">More details</summary>
                        {m.reservations.length > 0 && <p className="text-fg-2">Lots set aside: {m.reservations.map((r) => `${r.lotNumber} at ${r.locationCode} (${qty(r.qty, m.baseUom)})`).join(" · ")}</p>}
                        {m.recommended.length > 0 && <p className="mt-1 text-fg-2">Use first (earliest expiry): {m.recommended.map((r) => `${r.lotNumber} at ${r.locationCode}, expires ${fmtDate(r.expiresOn)}, ${qty(r.available, m.baseUom)} free`).join(" · ")}</p>}
                        {m.blocked.length > 0 && <p className="mt-1 text-muted">Not usable: {m.blocked.map((b) => `${b.lotNumber} (${b.reason})`).join(" · ")}</p>}
                      </details>
                    )}
                  </Card>
                ))}
              </div>
            ))}

          {tab === "output" && (
            <>
              {v.batches.length === 0 ? (
                <EmptyState title="No batch yet">The batch is created when the order is approved.</EmptyState>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {v.batches.map((b) => (
                    <Link key={b.id} href={["planned", "materials_staged", "in_process", "rework_approved"].includes(b.status) ? continueHref({ batchId: b.id, workOrderId: wo.id }) : batchRecordHref(b.id)} className="block rounded-[16px] border border-line bg-surface p-3.5 hover:shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[13px] font-semibold">{b.batchNumber}</span>
                        <Chip tone={b.status === "closed" || b.status === "released" ? "ok" : b.status === "rejected" ? "rej" : "info"}>{b.word}</Chip>
                      </div>
                      <p className="mt-1 text-[13px] text-muted">{["planned", "materials_staged", "in_process", "rework_approved"].includes(b.status) ? "Continue this batch" : "See the full batch record"}</p>
                    </Link>
                  ))}
                </div>
              )}
              {v.summary && (
                <Card>
                  <CardTitle>Made so far (from the daily log)</CardTitle>
                  <DefectTables summary={v.summary} showProduct={false} />
                </Card>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          {v.canAssign && (
            <div className="rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)]">
              <AssignForm workOrderId={wo.id} current={v.assignee?.id ?? null} people={people} />
            </div>
          )}
          {v.canCancel && (
            <details className="rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)]">
              <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium">Cancel this order</summary>
              <div className="mt-2">
                <CancelOrderForm workOrderId={wo.id} />
              </div>
            </details>
          )}
          <details className="rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)]">
            <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium">More details</summary>
            <dl className="mt-2 space-y-1.5 text-[14px]">
              <div>
                <dt className="text-[12px] text-muted">How much</dt>
                <dd className="tabular">
                  {fmtMass(wo.qtyPlannedBase)} ({batchPlanWords(wo.batchPlan, d.product.family) ?? `${wo.batchCount} × ${fmtMass(wo.batchSizeBase)}`})
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Planned dates</dt>
                <dd>
                  {fmtDate(wo.plannedStart)}
                  {wo.plannedEnd !== wo.plannedStart ? ` – ${fmtDate(wo.plannedEnd)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Recipe and steps</dt>
                <dd>
                  {d.formulaRevision ? `${d.formulaRevision.label}` : "Chosen when the order is approved"}
                  {d.routingRevision ? ` · ${d.routingRevision.label}` : ""}
                </dd>
              </div>
              {d.newerRevision && (
                <div>
                  <dt className="text-[12px] text-muted">Newer recipe</dt>
                  <dd>{d.newerRevision} is in use from today. This order and its batches keep the version they were approved with.</dd>
                </div>
              )}
              {d.line && (
                <div>
                  <dt className="text-[12px] text-muted">Line</dt>
                  <dd>{d.line.name}</dd>
                </div>
              )}
              {(d.people.planner || d.people.supervisor || d.people.approvedBy) && (
                <div>
                  <dt className="text-[12px] text-muted">People</dt>
                  <dd>
                    {[d.people.planner && `Planned by ${d.people.planner}`, d.people.supervisor && `Supervisor ${d.people.supervisor}`, d.people.approvedBy && `Approved by ${d.people.approvedBy} · ${fmtDateTime(wo.approvedAt)}`].filter(Boolean).join(" · ")}
                  </dd>
                </div>
              )}
              {wo.notes && (
                <div>
                  <dt className="text-[12px] text-muted">Notes</dt>
                  <dd className="whitespace-pre-line">{wo.notes}</dd>
                </div>
              )}
            </dl>
            {canPlanAnother && (
              <div className="mt-3">
                <p className="mb-2 text-[13px] text-fg-2">
                  This order has {v.batches.length} of {wo.batchCount} batches. Plan the missing one:
                </p>
                <PlanBatchButton workOrderId={wo.id} idempotencyKey={planKey} label={`Plan batch ${v.batches.length + 1} of ${wo.batchCount}`} secondary />
              </div>
            )}
            {editOpts && (
              <details className="mt-3">
                <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium">Change this draft</summary>
                <div className="mt-2">
                  <WorkOrderForm
                    mode="edit"
                    options={editOpts}
                    initial={{
                      workOrderId: wo.id,
                      productId: wo.productId,
                      formulaId: wo.formulaId,
                      batchSizeKg: D(wo.batchSizeBase).div(1000).toString(),
                      batchCount: wo.batchCount,
                      plannedStart: wo.plannedStart,
                      plannedEnd: wo.plannedEnd,
                      productionLineId: wo.productionLineId,
                      priority: wo.priority,
                      assignedSupervisorId: wo.assignedSupervisorId,
                      targetUnits: wo.targetUnits ? D(wo.targetUnits).toFixed(0) : null,
                      notes: wo.notes,
                    }}
                  />
                </div>
              </details>
            )}
            {history.length > 0 && (
              <details className="mt-3" data-testid="order-history">
                <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium">What happened to this order</summary>
                <ol className="mt-2 flex max-h-[360px] flex-col gap-2 overflow-y-auto text-[13px]">
                  {history.map((h, i) => (
                    <li key={i} className="border-l-2 border-line pl-3">
                      <p className="text-fg">{h.text}</p>
                      <p className="text-[12px] text-muted">
                        {h.who} · {fmtDateTime(h.at)}
                      </p>
                      {h.reason && <p className="text-[12px] text-fg-2">Reason: {h.reason}</p>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </details>
        </aside>
      </div>
    </div>
  );
}
