import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { defectTypes, getProductionOrder, type DailyLogRow, type ProductionOrderView } from "@/modules/production";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Help } from "@/ui/help/help";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Forbidden } from "../../../forbidden";
import { ApproveButton, CancelOrderForm, DailyLogForm } from "../forms";
import { ActionButton, DefectTables, NeededBy, OrderStatusChip, OrderWarning, ProgressStrip } from "../parts";

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

function NextActionCard({ v }: { v: ProductionOrderView }) {
  const a = v.nextAction;
  return (
    <Card>
      <CardTitle>Next step</CardTitle>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] text-fg-2">{a.hint}</p>
        <ActionButton a={a} approve={<ApproveButton workOrderId={v.detail.workOrder.id} />} />
        {a.kind === "wait" && !a.who && <p className="text-[13px] text-muted">Nothing to press yet.</p>}
      </div>
    </Card>
  );
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
              {b.action.kind === "none" ? <p className="text-[13px] text-muted">{b.action.hint}</p> : <ActionButton a={b.action} size="md" />}
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

export default async function ProductionOrderPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.view")) return <Forbidden what="production orders" />;
  const { workOrderId } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "today";
  let v: ProductionOrderView;
  try {
    v = await getProductionOrder(ctx, workOrderId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const d = v.detail;
  const wo = d.workOrder;
  const types = v.canAddLog ? await defectTypes(ctx, wo.siteId) : [];
  const todays = v.logs?.filter((l) => l.logDate === v.today && !l.replacedById) ?? [];
  const missing = d.materials.filter((m) => D(m.short).gt(0));
  const batchOptions = v.batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber }));

  return (
    <div>
      <PageHeader
        title={d.product.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <OrderStatusChip status={v.status} label={v.statusLabel} subtitle={v.statusView.subtitle} warn={v.statusView.warn} />
            <OrderWarning text={v.statusView.warning} />
            <span className="font-medium text-fg">
              {v.pieces.text} {v.pieces.word}
            </span>
            <span className="font-mono">{wo.workOrderNumber}</span>
            <NeededBy date={v.neededBy} late={v.late} />
            {d.salesOrder && (
              <span>
                For customer order{" "}
                {ctx.can("sales.sales_order.view") ? (
                  <Link href={`/sales/${d.salesOrder.id}`} className="underline">
                    {d.salesOrder.number}
                  </Link>
                ) : (
                  d.salesOrder.number
                )}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Help screen="production.production_order" />
            <LinkButton href="/production/orders" variant="secondary">All orders</LinkButton>
          </>
        }
      />

      {v.status === "cancelled" ? (
        <div className="mb-4">
          <Banner tone="neu" title="Cancelled">{wo.cancelReason}</Banner>
        </div>
      ) : v.status === "failed" || !v.progress.steps ? (
        <div className="mb-4">
          <Banner tone="rej" title="Failed">Every batch of this order failed the quality check. Nothing from it can be sold.</Banner>
        </div>
      ) : (
        <Card className="mb-4">
          <ProgressStrip steps={v.progress.steps} note={v.statusView.stepNote} />
          {v.statusView.batchesNote && <p className="mt-2 text-[13px] text-muted">Batches: {v.statusView.batchesNote}</p>}
        </Card>
      )}

      <div className="mb-4 lg:hidden">
        <NextActionCard v={v} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <nav className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="Production order sections">
            {TABS.map(([k, label]) => (
              <Link key={k} href={`?tab=${k}`} aria-current={k === tab ? "page" : undefined} className={cx("min-h-[40px] whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium", k === tab ? "bg-primary text-white" : "text-fg hover:bg-surface-2")}>
                {label}
              </Link>
            ))}
          </nav>

          <BatchRows v={v} />

          {tab === "today" && (
            <>
              {v.canAddLog ? (
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
                    {m.reservations.length > 0 && (
                      <details className="mt-2 text-[13px]">
                        <summary className="min-h-[44px] cursor-pointer py-2.5 font-medium">More details</summary>
                        <p className="text-fg-2">Lots set aside: {m.reservations.map((r) => `${r.lotNumber} at ${r.locationCode} (${qty(r.qty, m.baseUom)})`).join(" · ")}</p>
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
                    <Link key={b.id} href={b.status === "planned" ? `/production/staging/${b.id}` : `/production/${b.id}`} className="block rounded-[16px] border border-line bg-surface p-3.5 hover:shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[13px] font-semibold">{b.batchNumber}</span>
                        <Chip tone={b.status === "closed" || b.status === "released" ? "ok" : b.status === "rejected" ? "rej" : "info"}>{b.word}</Chip>
                      </div>
                      <p className="mt-1 text-[13px] text-muted">Open the full batch record</p>
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
          <div className="hidden lg:block">
            <NextActionCard v={v} />
          </div>
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
                  {fmtMass(wo.qtyPlannedBase)} ({wo.batchCount} × {fmtMass(wo.batchSizeBase)})
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Planned dates</dt>
                <dd>
                  {fmtDate(wo.plannedStart)}
                  {wo.plannedEnd !== wo.plannedStart ? ` – ${fmtDate(wo.plannedEnd)}` : ""}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[13px] text-muted">
              Advanced: <Link href={`/production/work-orders/${wo.id}`} className="underline">full order record {wo.workOrderNumber}</Link>
            </p>
          </details>
        </aside>
      </div>
    </div>
  );
}
