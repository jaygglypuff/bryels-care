import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { daysUntil, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getQaQueue } from "@/modules/quality/dispositions";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { Explain, MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Forbidden } from "../forbidden";
import { DecisionChip, QaStatusChip, WordChip, fmtLotQty } from "./_ui";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";

function Count({ n }: { n: number }) {
  return (
    <span className="ml-2 inline-flex min-w-[24px] items-center justify-center rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-fg-2 tabular" aria-label={`${n} items`}>
      {n}
    </span>
  );
}

/** The other quality screens, in plain words (secondary: "⋯ More"). */
function OtherWork({ can }: { can: (p: string) => boolean }) {
  const links: [string, string, boolean][] = [
    ["/quality/inspections", "Quality checks (tests)", can("quality.inspection.view")],
    ["/quality/deviations", "Problem reports", can("quality.deviation.view")],
    ["/quality/holds", "Stopped by QA", can("quality.hold.view")],
    ["/quality/bulk", "Decide many lots at once", can("quality.disposition.approve")],
    ["/quality/trace", "Where it came from and where it went", can("quality.genealogy.view")],
    ["/quality/complaints", "Customer complaints", can("quality.complaint.view")],
    ["/quality/capa", "Fix-and-prevent plans", can("quality.capa.view")],
    ["/quality/changes", "Change requests", can("quality.change_control.view")],
    ["/quality/recalls", "Product recalls", can("quality.recall_case.view")],
    ["/quality/label-verification", "Check the labels in an area", can("inventory.label_job.view")],
  ];
  return (
    <ul className="flex flex-col">
      {links
        .filter(([, , ok]) => ok)
        .map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="flex min-h-[44px] items-center rounded-[10px] px-2 text-[14px] text-fg hover:bg-surface-2">
              {label}
            </Link>
          </li>
        ))}
    </ul>
  );
}

export default async function QaQueuePage() {
  const ctx = await requireContext();
  if (!ctx.can("quality.disposition.view")) return <Forbidden what="the QA queue" />;
  const q = await getQaQueue(ctx);
  const waiting = q.lots.filter((l) => l.qualityStatus === "quarantine");
  const stopped = q.lots.filter((l) => l.qualityStatus === "on_hold");
  const canDecide = ctx.can("quality.disposition.approve");
  const firstBatch = q.batches[0];
  const firstLot = waiting[0] ?? stopped[0];

  return (
    <>
      <PageHeader
        title="QA queue"
        subtitle={`${ctx.currentSite.name}`}
        actions={
          <>
            <Help screen="quality.release" />
            <MoreMenu>
              <OtherWork can={(p) => ctx.can(p as Parameters<typeof ctx.can>[0])} />
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for the QA person: see what is waiting for a quality check and say OK or not OK.</PageIntro>

      {firstBatch ? (
        <NextStep text={`Next: check the batch of ${firstBatch.productName} and say OK or not OK.`} action={canDecide ? { label: "Check this batch", href: `/quality/check/${firstBatch.id}` } : undefined} waitingFor={canDecide ? undefined : "Waiting for a QA person to check it."} />
      ) : firstLot ? (
        <NextStep text={`Next: check ${firstLot.itemName} (delivered ${fmtDate(firstLot.receivedAt)}) and say OK or not OK.`} action={canDecide ? { label: "Check this delivery", href: `/quality/lots/${firstLot.id}` } : undefined} waitingFor={canDecide ? undefined : "Waiting for a QA person to check it."} />
      ) : (
        <NextStep text="Nothing is waiting for a quality check right now." />
      )}
      {!canDecide && (firstBatch || firstLot) && (
        <div className="-mt-2 mb-4">
          <WhoCanHelp permission="quality.disposition.approve" siteId={ctx.currentSiteId} hideEmails lead="QA people who decide: " />
        </div>
      )}

      <div className="flex flex-col gap-5">
        <Card>
          <CardTitle>
            Batches waiting for QA check
            <Count n={q.batches.length} />
          </CardTitle>
          <div className="-mt-2 mb-3 text-[13px] text-muted">
            Finished batches, oldest first. They cannot be sold until QA says OK. <Explain term="batch" />
          </div>
          {q.batches.length === 0 ? (
            <EmptyState title="No batch is waiting">Batches appear here as soon as production presses &quot;Finish batch&quot;. Questions? Ask the production supervisor.</EmptyState>
          ) : (
            <PlainList label="Batches waiting for QA check">
              {q.batches.map((b) => (
                <PlainRow
                  key={b.id}
                  testId="qa-batch-row"
                  href={`/quality/check/${b.id}`}
                  title={b.productName}
                  code={b.batchNumber}
                  status={
                    <>
                      <QaStatusChip status={b.status} />
                      {b.failedCount > 0 && <WordChip tone="bad" icon="bad">{b.failedCount} test(s) not OK</WordChip>}
                      {b.openDeviations > 0 && <WordChip tone="bad" icon="new">{b.openDeviations} open problem report(s)</WordChip>}
                    </>
                  }
                  facts={
                    <>
                      {b.actualUnits ? `${fmtQty(b.actualUnits, "pcs", 0)} made` : "Amount not recorded"}
                      {b.completedAt ? ` · finished ${fmtDateTime(b.completedAt)}` : ""}
                    </>
                  }
                />
              ))}
            </PlainList>
          )}
        </Card>

        <Card>
          <CardTitle>
            Deliveries waiting for QA check, and lots stopped by QA
            <Count n={q.lots.length} />
          </CardTitle>
          <div className="-mt-2 mb-3 text-[13px] text-muted">
            {waiting.length} waiting for QA check, {stopped.length} stopped by QA, oldest delivery first. Nobody can use, set aside or ship them until QA decides. <Explain term="lot" />
          </div>
          {q.lots.length === 0 ? (
            <EmptyState title="Nothing waiting">No delivery is waiting for a QA check and nothing is stopped by QA at this site. New deliveries appear here after the warehouse receives them.</EmptyState>
          ) : (
            <PlainList label="Lots waiting for QA">
              {q.lots.map((l) => {
                const days = daysUntil(l.expiresOn);
                return (
                  <PlainRow
                    key={l.id}
                    testId="qa-lot-row"
                    href={`/quality/lots/${l.id}`}
                    title={l.itemName}
                    code={l.lotNumber}
                    tone={l.expired ? "bad" : undefined}
                    status={
                      <>
                        <QaStatusChip status={l.qualityStatus} />
                        {l.expired ? <QaStatusChip status="expired" /> : days !== null && days <= 90 ? <Chip tone="warn">{days} days left</Chip> : null}
                      </>
                    }
                    facts={
                      <>
                        {fmtLotQty(l.onHand, l.baseUom)}
                        {l.supplierName ? ` · from ${l.supplierName}` : ""} · received {fmtDate(l.receivedAt)}
                        {l.expiresOn ? ` · use by ${fmtDate(l.expiresOn)}` : ""}
                      </>
                    }
                  />
                );
              })}
            </PlainList>
          )}
        </Card>

        <Card>
          <CardTitle>
            Last QA decisions
            <Count n={q.decisions.length} />
          </CardTitle>
          {q.decisions.length === 0 ? (
            <EmptyState title="No decisions yet">Every OK or not OK that QA gives at this site is listed here with who gave it and why.</EmptyState>
          ) : (
            <>
              {[q.decisions.slice(0, 6), q.decisions.slice(6)].map((list, i) =>
                list.length === 0 ? null : i === 0 ? (
                  <PlainList key={i} label="Last QA decisions">
                    {list.map((d) => (
                <PlainRow
                  key={d.id}
                  href={d.href}
                  title={d.subjectName ?? d.subjectNumber}
                  code={d.subjectNumber}
                  status={<DecisionChip decision={d.decision} />}
                  facts={
                    <>
                      {d.decidedByName}, {fmtDateTime(d.decidedAt)}
                      {d.reason ? ` · “${d.reason}”` : ""}
                    </>
                  }
                />
              ))}
                  </PlainList>
                ) : (
                  <div key={i} className="mt-3">
                    <MoreDetails title={`Older decisions (${list.length})`}>
                      <PlainList label="Older QA decisions">
                        {list.map((d) => (
                <PlainRow
                  key={d.id}
                  href={d.href}
                  title={d.subjectName ?? d.subjectNumber}
                  code={d.subjectNumber}
                  status={<DecisionChip decision={d.decision} />}
                  facts={
                    <>
                      {d.decidedByName}, {fmtDateTime(d.decidedAt)}
                      {d.reason ? ` · “${d.reason}”` : ""}
                    </>
                  }
                />
              ))}
                      </PlainList>
                    </MoreDetails>
                  </div>
                ),
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
