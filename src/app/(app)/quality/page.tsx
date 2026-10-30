import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, daysUntil, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getQaQueue } from "@/modules/quality/dispositions";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../forbidden";
import { DecisionChip, Transition, fmtLotQty } from "./_ui";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";

function Count({ n }: { n: number }) {
  return (
    <span className="ml-2 inline-flex min-w-[24px] items-center justify-center rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-fg-2 tabular" aria-label={`${n} items`}>
      {n}
    </span>
  );
}

export default async function QaQueuePage() {
  const ctx = await requireContext();
  if (!ctx.can("quality.disposition.view")) return <Forbidden what="the QA queue" />;
  const q = await getQaQueue(ctx);
  const quarantined = q.lots.filter((l) => l.qualityStatus === "quarantine");
  const held = q.lots.filter((l) => l.qualityStatus === "on_hold");

  return (
    <>
      <PageHeader
        title="QA queue"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} — lots and batches waiting for a quality decision`}
        actions={
          <>
            <Help screen="quality.release" />
            <LinkButton href="/quality/check" variant="primary">Waiting for check</LinkButton>
            {ctx.can("quality.inspection.view") && <LinkButton href="/quality/inspections" variant="secondary">Inspections</LinkButton>}
            {ctx.can("quality.deviation.view") && <LinkButton href="/quality/deviations" variant="secondary">Deviations</LinkButton>}
            {ctx.can("quality.disposition.approve") && <LinkButton href="/quality/bulk" variant="secondary">Bulk disposition</LinkButton>}
            {ctx.can("quality.genealogy.view") && <LinkButton href="/quality/trace" variant="secondary">Traceability</LinkButton>}
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <Card>
          <CardTitle>
            Material lots awaiting inspection and lots on hold
            <Count n={q.lots.length} />
          </CardTitle>
          <p className="-mt-2 mb-3 text-[13px] text-muted">
            {quarantined.length} in quarantine, {held.length} on QA hold, oldest received first. Stock in these lots cannot be issued, allocated or shipped until QA decides.
          </p>
          {q.lots.length === 0 ? (
            <EmptyState title="Nothing waiting">No material lots are in quarantine and no lots are on hold at this site.</EmptyState>
          ) : (
            <Table head={["Lot", "Item", "Status", "On hand", "Supplier / supplier lot", "Received", "Expiry", ""]}>
              {q.lots.map((l) => {
                const days = daysUntil(l.expiresOn);
                return (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap font-medium">
                      <Link className="text-primary-text hover:underline" href={`/quality/lots/${l.id}`}>
                        {l.lotNumber}
                      </Link>
                    </Td>
                    <Td>
                      {l.itemName}
                      <div className="text-[12px] text-muted">{l.itemCode}</div>
                    </Td>
                    <Td>
                      <StatusChip status={l.qualityStatus} />
                    </Td>
                    <Td>
                      {fmtLotQty(l.onHand, l.baseUom)}
                      {l.locationCodes && <div className="text-[12px] text-muted">{l.locationCodes}</div>}
                    </Td>
                    <Td>
                      {l.supplierName ?? "—"}
                      <div className="text-[12px] text-muted">{l.supplierLotNumber ?? ""}</div>
                    </Td>
                    <Td>
                      {fmtDate(l.receivedAt)}
                      <div className="text-[12px] text-muted">
                        {l.receiptNumber ?? ""}
                        {l.receivedByName ? ` · ${l.receivedByName}` : ""}
                      </div>
                    </Td>
                    <Td>
                      {fmtDate(l.expiresOn)}
                      {l.expired ? (
                        <div className="mt-0.5">
                          <StatusChip status="expired" />
                        </div>
                      ) : days !== null && days <= 90 ? (
                        <div className="mt-0.5">
                          <Chip tone="warn">{days} days left</Chip>
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-right">
                      <LinkButton href={`/quality/lots/${l.id}`} variant="secondary" size="sm">
                        Decide
                      </LinkButton>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card>
          <CardTitle>
            Batches awaiting a QA decision
            <Count n={q.batches.length} />
          </CardTitle>
          {q.batches.length === 0 ? (
            <EmptyState title="No batches awaiting QC">Batches appear here when production completes them and transfers the output to quarantine.</EmptyState>
          ) : (
            <Table head={["Batch", "Product", "Output lot", "Yield", "Tests / inspection", "Completed", ""]}>
              {q.batches.map((b) => (
                <tr key={b.id}>
                  <Td className="whitespace-nowrap font-medium">
                    <Link className="text-primary-text hover:underline" href={`/quality/batches/${b.id}`}>
                      {b.batchNumber}
                    </Link>
                  </Td>
                  <Td>{b.productName}</Td>
                  <Td>
                    {b.outputLotNumber ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {b.outputLotNumber}
                        {b.outputLotStatus && <StatusChip status={b.outputLotStatus} />}
                      </span>
                    ) : (
                      "—"
                    )}
                    {b.actualUnits && <div className="text-[12px] text-muted">{fmtQty(b.actualUnits, "pcs", 0)}</div>}
                  </Td>
                  <Td>{b.yieldPct ? `${D(b.yieldPct).toFixed(1)} %` : "—"}</Td>
                  <Td>
                    {b.testCount}
                    {b.failedCount > 0 && (
                      <span className="ml-2">
                        <Chip tone="bad">{b.failedCount} failed</Chip>
                      </span>
                    )}
                    {b.inspectionStatus && <div className="mt-0.5 text-[12px] text-muted">Inspection {b.inspectionStatus.replace(/_/g, " ")}</div>}
                    {b.openDeviations > 0 && (
                      <div className="mt-0.5">
                        <Chip tone="bad">{b.openDeviations} open deviation(s)</Chip>
                      </div>
                    )}
                  </Td>
                  <Td>{fmtDateTime(b.completedAt)}</Td>
                  <Td className="text-right">
                    <LinkButton href={`/quality/check/${b.id}`} size="sm">
                      Check quality
                    </LinkButton>{" "}
                    <LinkButton href={`/quality/batches/${b.id}`} variant="secondary" size="sm">
                      Review
                    </LinkButton>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardTitle>
            Recent decisions
            <Count n={q.decisions.length} />
          </CardTitle>
          {q.decisions.length === 0 ? (
            <EmptyState title="No decisions yet">QA dispositions recorded at this site will appear here.</EmptyState>
          ) : (
            <Table head={["When", "Subject", "Decision", "Status change", "Decided by", "Reason"]}>
              {q.decisions.map((d) => (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(d.decidedAt)}</Td>
                  <Td className="whitespace-nowrap font-medium">
                    <Link className="text-primary-text hover:underline" href={d.href}>
                      {d.subjectNumber}
                    </Link>
                    <div className="text-[12px] text-muted">{d.subjectType === "lot" ? "Lot" : "Batch"}</div>
                  </Td>
                  <Td>
                    <DecisionChip decision={d.decision} />
                  </Td>
                  <Td>
                    <Transition from={d.fromStatus} to={d.toStatus} />
                  </Td>
                  <Td>{d.decidedByName}</Td>
                  <Td className="max-w-[320px] text-[13px] text-fg-2">{d.reason ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
