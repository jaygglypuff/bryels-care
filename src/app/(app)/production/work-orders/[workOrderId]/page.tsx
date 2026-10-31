import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { getWorkOrder, progressLabel, workOrderFormOptions, type WorkOrderDetail } from "@/modules/production";
import { Card, CardTitle, Dl, EmptyState, Field, LinkButton, PageHeader, Table, Td, Textarea, cx } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { cancelWorkOrderAction, workOrderCommandAction } from "../actions";
import { CommandForm } from "../command-form";
import { WorkOrderForm } from "../wo-form";
import { NextStep, type NextStepProps } from "../next-step";
import { Help } from "@/ui/help/help";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "Production order" };
export const dynamic = "force-dynamic";

const TABS = ["overview", "batches", "materials", "history"] as const;
const WORD: Record<string, string> = { in_progress: "In progress", completed: "Completed", released: "Released" };

function qty(v: string, uom: string) {
  return uom === "g" ? fmtMass(v) : fmtQty(v, uom, 1);
}

function nextStep(d: WorkOrderDetail): NextStepProps {
  const id = d.workOrder.id;
  const a = d.actions;
  const status = d.workOrder.status;
  const base = { workOrderId: id, command: null, label: null } as const;
  if (a.canPlan) return { workOrderId: id, command: "plan", label: "Plan (resolve revisions)", pendingText: "Planning…" };
  if (status === "planned" && a.canRelease) {
    if (a.releaseBlockedBySod) return { ...base, blocked: { title: "Release by another person", body: "You planned this production order; separation of duties needs another person with release permission." }, who: { permission: "production.work_order.approve", siteId: d.workOrder.siteId } };
    return { workOrderId: id, command: "release", label: "Release and reserve materials", pendingText: "Reserving…", withNote: true };
  }
  if (a.canCreateBatch) return { workOrderId: id, command: "create_batch", label: `Create batch ${d.batches.length + 1} of ${d.workOrder.batchCount}`, pendingText: "Creating…" };
  // ADR-073: when the next step belongs to another role, say who can do it.
  const needed = status === "draft" ? "production.work_order.submit" : status === "planned" ? "production.work_order.approve" : status === "released" ? "production.batch.create" : null;
  return {
    ...base,
    idle: ["in_progress", "completed", "closed", "cancelled"].includes(status) ? "Progress follows the batches." : "No action for your role at this step.",
    who: needed ? { permission: needed, siteId: d.workOrder.siteId } : null,
  };
}

export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.view")) return <Forbidden what="production orders" />;
  const { workOrderId } = await params;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "overview";
  let d: WorkOrderDetail;
  try {
    d = await getWorkOrder(ctx, workOrderId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const wo = d.workOrder;
  const shortages = d.materials.filter((m) => D(m.short).gt(0));
  const editOpts = d.actions.canEdit ? await workOrderFormOptions(ctx) : null;

  return (
    <div>
      <PageHeader
        title={wo.workOrderNumber}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={wo.status} label={WORD[wo.status]} />
            <span>{d.product.name} · {wo.batchCount} × {fmtMass(wo.batchSizeBase)} · {fmtDate(wo.plannedStart)} – {fmtDate(wo.plannedEnd)}</span>
          </span>
        }
        actions={<LinkButton href="/production/board" variant="secondary">Board</LinkButton>}
      />
      <PageIntro>Older view of one production order: the set-aside materials and its batches.</PageIntro>
      {d.newerRevision && (
        <div className="mb-4">
          <Banner tone="info" title="Revision in use">
            This work order uses {d.formulaRevision?.label}; {d.newerRevision} is effective today. Existing batches keep their frozen snapshot.
          </Banner>
        </div>
      )}
      {wo.status === "cancelled" && <div className="mb-4"><Banner tone="neu" title="Cancelled">{wo.cancelReason}</Banner></div>}
      {shortages.length > 0 && ["released", "in_progress"].includes(wo.status) && (
        <div className="mb-4">
          <Banner tone="warn" title="Materials short">
            {shortages.map((s) => `${s.materialName}: ${qty(s.short, s.baseUom)}`).join(" · ")}
          </Banner>
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <nav className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="Production order sections">
          {TABS.map((t) => (
            <Link key={t} href={`?tab=${t}`} aria-current={t === tab ? "page" : undefined} className={cx("whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium capitalize", t === tab ? "bg-primary text-white" : "text-fg hover:bg-surface-2")}>
              {t}
            </Link>
          ))}
        </nav>
        <div />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {tab === "overview" && (
            <Card>
              <CardTitle>Overview</CardTitle>
              <Dl
                items={[
                  ["Product", `${d.product.name} (${d.product.skuCode})`],
                  ["Quantity", `${fmtMass(wo.qtyPlannedBase)}${wo.targetUnits ? ` · target ${fmtQty(wo.targetUnits, "units", 0)}` : ""}`],
                  ["Batches", `${wo.batchCount} × ${fmtMass(wo.batchSizeBase)}`],
                  ["Formula revision", d.formulaRevision?.label ?? `${d.formula.code} (resolved at planning)`],
                  ["Routing revision", d.routingRevision?.label ?? "Resolved at planning"],
                  ["Line", d.line ? `${d.line.code} · ${d.line.name}` : "—"],
                  ["Planned", `${fmtDate(wo.plannedStart)} – ${fmtDate(wo.plannedEnd)}`],
                  ["Priority", String(wo.priority)],
                  ["Planner", d.people.planner ?? "—"],
                  ["Supervisor", d.people.supervisor ?? "—"],
                  ["Released by", d.people.approvedBy ? `${d.people.approvedBy} · ${fmtDateTime(wo.approvedAt)}` : "—"],
                  ["Sales order", d.salesOrder?.number ?? "—"],
                ]}
              />
              {wo.notes && <p className="mt-4 text-[13px] text-fg-2">{wo.notes}</p>}
            </Card>
          )}
          {tab === "overview" && editOpts && (
            <details className="rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)]">
              <summary className="cursor-pointer font-medium">Edit draft</summary>
              <div className="mt-4">
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

          {tab === "batches" &&
            (d.batches.length === 0 ? (
              <EmptyState title="No batches yet">{["planned", "released", "in_progress"].includes(wo.status) ? "Create the first batch with the button on the right." : "Batches are created once the production order is planned."}</EmptyState>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {d.batches.map((b) => (
                  <Link key={b.id} href={b.status === "planned" ? `/production/staging/${b.id}` : `/production/${b.id}`} className="block rounded-[16px] border border-line bg-surface p-3.5 hover:shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-semibold">{b.batchNumber}</span>
                      <StatusChip status={b.status} />
                    </div>
                    <p className="mt-1 text-[12px] text-muted">{fmtMass(b.plannedSizeG)} · planned {fmtDate(b.plannedStartOn)}</p>
                    <p className="mt-1 text-[12px]">{progressLabel(b.status, b.stepsDone, b.stepsTotal)}</p>
                  </Link>
                ))}
              </div>
            ))}

          {tab === "materials" &&
            (d.materials.length === 0 ? (
              <EmptyState title="Materials appear after planning">Planning freezes the formula revision; its lines define the requirement.</EmptyState>
            ) : (
              <div className="space-y-3">
                {d.materials.map((m) => (
                  <Card key={m.materialId} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{m.materialName}</p>
                        <p className="text-[12px] text-muted">{m.materialCode}</p>
                      </div>
                      {D(m.short).gt(0) ? <Chip tone="warn">Short {qty(m.short, m.baseUom)}</Chip> : <Chip tone="ok">Covered</Chip>}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-5">
                      {[["Required", m.required], ["Reserved", m.reserved], ["Staged", m.staged], ["Consumed", m.consumed], ["Free (eligible)", m.freeEligible]].map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
                          <dd className="tabular">{qty(v, m.baseUom)}</dd>
                        </div>
                      ))}
                    </dl>
                    {m.reservations.length > 0 && (
                      <p className="mt-3 text-[12px]">
                        <span className="font-semibold">Reserved lots: </span>
                        {m.reservations.map((r) => `${r.lotNumber} @ ${r.locationCode} ${qty(r.qty, m.baseUom)}`).join(" · ")}
                      </p>
                    )}
                    {m.recommended.length > 0 && (
                      <p className="mt-1 text-[12px] text-fg-2">
                        <span className="font-semibold">FEFO candidates: </span>
                        {m.recommended.map((r) => `#${r.rank} ${r.lotNumber} @ ${r.locationCode} (exp ${fmtDate(r.expiresOn)}, ${qty(r.available, m.baseUom)} free)`).join(" · ")}
                      </p>
                    )}
                    {m.blocked.length > 0 && <p className="mt-1 text-[12px] text-muted">Not usable: {m.blocked.map((b) => `${b.lotNumber} (${b.reason})`).join(" · ")}</p>}
                  </Card>
                ))}
              </div>
            ))}

          {tab === "history" && (
            <Card>
              <CardTitle>History</CardTitle>
              <Table head={["When", "Who", "Event", "Detail"]}>
                {d.audits.map((a) => (
                  <tr key={a.id}>
                    <Td className="whitespace-nowrap">{fmtDateTime(a.occurredAt)}</Td>
                    <Td>{a.actor ?? a.actorLabel ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{a.action.replace("production.work_order.", "").replace(/_/g, " ")}</Td>
                    <Td className="text-[12px] text-fg-2">{a.reason ?? ""}</Td>
                  </tr>
                ))}
              </Table>
              <p className="mt-3 text-[12px] text-muted">State changes: {d.transitions.map((t) => `${t.fromState ?? "new"} → ${t.toState} (${t.actor}, ${fmtDateTime(t.occurredAt)})`).join(" · ")}</p>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardTitle>Next step</CardTitle>
            <NextStep {...nextStep(d)} />
            {d.actions.canTopUp && shortages.length > 0 && (
              <div className="mt-3">
                <CommandForm action={workOrderCommandAction} fields={{ workOrderId: wo.id, command: "top_up" }} label="Reserve again (new stock)" variant="secondary" size="sm" />
              </div>
            )}
          </Card>
          {d.actions.canCancel && (
            <Card>
              <CardTitle>Cancel production order</CardTitle>
              <CommandForm action={cancelWorkOrderAction} fields={{ workOrderId: wo.id }} label="Cancel production order" variant="danger" size="sm" confirm="Cancel this production order? Its reservations end and unstarted batches are abandoned.">
                <Field label="Reason" htmlFor="reason">
                  <Textarea id="reason" name="reason" required minLength={5} maxLength={500} className="min-h-[56px]" />
                </Field>
              </CommandForm>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
