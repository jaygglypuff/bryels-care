import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getRecallCase } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { QaStatusChip, Timeline, fmtLotQty, qaWord } from "../../_ui";
import { RecallStatusChip, exportLinkCls } from "../../capa/_ui";
import {
  AccountedForm,
  CancelRecallForm,
  ClassificationForm,
  CloseRecallForm,
  DecideRecallForm,
  MarkRecalledForm,
  NotifyForm,
  RefreshScopeForm,
  StartDrillForm,
  StartRecoveryForm,
  SubmitRecallForm,
} from "../forms";

export const dynamic = "force-dynamic";

const OUTCOME = { pending: ["Not stopped yet", "appr"], recalled: ["Recalled", "bad"], already_recalled: ["Was already recalled", "bad"], not_marked: ["Not marked", "neu"] } as const;
const KIND_WORD: Record<string, string> = { recall: "Product recall", withdrawal: "Take off the shelves (withdrawal)", mock: "Practice recall (drill)" };


/** Recall case (ux-system §9.14): approval card, scope, Mark recalled, customer notification list, reconciliation, closure. */
export default async function RecallCasePage({ params, searchParams }: { params: Promise<{ recallId: string }>; searchParams: Promise<{ opened?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.recall_case.view")) return <Forbidden what="product recalls" />;
  const { recallId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getRecallCase>>;
  try {
    v = await getRecallCase(ctx, recallId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Product recall not found" action={<LinkButton href="/quality/recalls" variant="secondary">All product recalls</LinkButton>}>
          This recall does not exist or none of it is at your sites. Ask QA if you think it should be here.
        </EmptyState>
      );
    }
    throw e;
  }
  const c = v.recall;
  const lines = v.customers.flatMap((x) => x.lines);
  const hasGaps = lines.some((l) => !l.reconciled);
  return (
    <>
      <PageHeader
        title={c.title}
        subtitle={
          <>
            {KIND_WORD[c.recallKind] ?? c.kindLabel} · <RecordNo>{c.recallNumber}</RecordNo>
          </>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              {v.can.export && (
                <>
                  <a className={exportLinkCls} href={`/api/v1/quality/recalls/${c.id}/notification-list?format=csv`}>
                    List of customers to tell (CSV)
                  </a>
                  <a className={exportLinkCls} href={`/api/v1/quality/recalls/${c.id}/notification-list?format=xlsx`}>
                    List of customers to tell (Excel)
                  </a>
                </>
              )}
              {v.can.refresh && <RefreshScopeForm recallCaseId={c.id} />}
              <LinkButton href="/quality/recalls" variant="secondary">
                All product recalls
              </LinkButton>
              {v.can.cancel && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel is possible only before any stock is stopped.</p>
                  <CancelRecallForm recallCaseId={c.id} />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for QA and the owner: approve the recall, stop the stock, tell every customer, and count the products that come back.</PageIntro>
      {c.status === "draft" ? (
        v.can.submit ? <NextStep text="Next: check the lots and customers below, then send it for approval." action={{ label: "Send for approval", href: "#case" }} /> : <NextStep text="The recall is being prepared." waitingFor={`Waiting for ${c.openedByName} to send it for approval.`} />
      ) : c.status === "submitted" ? (
        v.can.decide && v.approval.next ? <NextStep text="Next: approve the recall or not (your password is needed)." action={{ label: "Decide", href: "#approval" }} /> : <NextStep text="Sent for approval." waitingFor={v.approval.next ? `Waiting for: ${v.approval.next.label} (a different person for each step).` : "Waiting for approval."} />
      ) : c.status === "approved" ? (
        v.can.mark ? <NextStep text="Next: stop every lot in this recall so nobody ships it." action={{ label: "Stop the lots", href: "#lots" }} /> : v.can.drill ? <NextStep text="Next: start the practice (no stock is stopped)." action={{ label: "Start the practice", href: "#lots" }} /> : <NextStep text="Approved." waitingFor="Waiting for QA to stop the lots." />
      ) : c.status === "notifying" ? (
        v.can.startRecovery ? <NextStep text="Every customer is told. Next: start getting the products back." action={{ label: "Start getting them back", href: "#customers" }} /> : v.can.notify ? <NextStep text="Next: tell each customer below and write down how." action={{ label: "Tell customers", href: "#customers" }} /> : <NextStep text="Customers are being told." waitingFor="Waiting for QA." />
      ) : c.status === "recovering" ? (
        v.can.close ? <NextStep text="Next: write the final report and close the recall." action={{ label: "Close the recall", href: "#closure" }} /> : <NextStep text="Products are coming back." waitingFor={v.pendingLotCount > 0 ? `${v.pendingLotCount} lot(s) are not stopped yet (maybe at another site).` : "Waiting for QA to close it."} />
      ) : null}

      <div className="flex flex-col gap-5">
        {sp.opened && <Banner tone="ok" title="Draft saved">Check the lots and customers, then send it for approval: QA and then the owner approve before any stock is stopped.</Banner>}
        {c.recallKind === "mock" && <Banner tone="info" title="Practice recall (drill)">No stock is stopped. Customers on the list are contacted only as practice.</Banner>}
        {(v.hiddenLots > 0 || v.hiddenLines > 0 || c.hiddenAtOpening > 0) && (
          <Banner tone="warn" title="Part of this recall is at sites you cannot see">
            {v.hiddenLots} lot(s) and {v.hiddenLines} customer line(s) are not shown{c.hiddenAtOpening ? `; ${c.hiddenAtOpening} linked record(s) were at sites the starter could not see` : ""}.
          </Banner>
        )}

        <Card>
          <span id="case" className="block scroll-mt-24" />
          <CardTitle action={<RecallStatusChip status={c.status} />}>Why it must come back</CardTitle>
          <p className="mb-4 whitespace-pre-wrap text-[14px]">{c.description}</p>
          <Dl
            items={[
              ["Started from", `${c.subjectCode} (${c.traceMode === "forward" ? "where it went" : "also batches that used the same materials"})`],
              ["List as of", fmtDateTime(c.scopeAsOf)],
              ["Complaint", v.complaint ? <Link key="c" className="text-primary-text hover:underline" href={`/quality/complaints/${v.complaint.id}`}>{v.complaint.number}</Link> : "—"],
              ["Class", c.classification ?? "Not set (QA / regulatory)"],
              ["Who must be told", c.regulatoryNotes ?? "—"],
              ["Started", `${c.openedByName}, ${fmtDateTime(c.openedAt)}`],
              ["Sent for approval", c.submittedAt ? `${c.submittedByName}, ${fmtDateTime(c.submittedAt)}` : "—"],
              ["Stock stopped", c.markedAt ? `${c.markedByName}, ${fmtDateTime(c.markedAt)}` : "—"],
              ["Closed", c.closedAt ? `${c.closedByName}, ${fmtDateTime(c.closedAt)}` : c.status === "cancelled" ? `Cancelled: ${c.cancelReason}` : "—"],
            ]}
          />
          {v.can.edit && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Change the class and who must be told</summary>
              <div className="mt-3">
                <ClassificationForm recallCaseId={c.id} classification={c.classification} regulatoryNotes={c.regulatoryNotes} />
              </div>
            </details>
          )}
          {v.can.submit && (
            <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line pt-4">
              <SubmitRecallForm recallCaseId={c.id} />
            </div>
          )}
        </Card>

        <Card>
          <span id="approval" className="block scroll-mt-24" />
          <CardTitle>Approval</CardTitle>
          <ol className="flex flex-col gap-2 text-[14px]">
            {v.approval.steps.map((s) => (
              <li key={s.step} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {s.step}. {s.label}
                </span>
                {s.roleCodes.length > 0 && <span className="text-[12px] text-muted">({s.roleCodes.map((r) => r.replace(/_/g, " ")).join(" or ")})</span>}
                {s.done ? <Chip tone="ok">Approved by {s.approvals.map((a) => a.name).join(", ")}</Chip> : c.status === "submitted" ? <Chip tone="appr">Waiting</Chip> : null}
              </li>
            ))}
          </ol>
          {v.approval.history.some((h) => h.decision !== "approved") && (
            <ul className="mt-3 border-t border-line pt-3 text-[12px] text-fg-2">
              {v.approval.history
                .filter((h) => h.decision !== "approved")
                .map((h, i) => (
                  <li key={i}>
                    Round {h.cycle}: {({ returned: "sent back", rejected: "said no" } as Record<string, string>)[h.decision] ?? h.decision} by {h.name} on {fmtDateTime(h.at)}
                    {h.note ? ` — ${h.note}` : ""}
                  </li>
                ))}
            </ul>
          )}
          {v.can.decide && v.approval.next && (
            <div className="mt-4 border-t border-line pt-4">
              <DecideRecallForm recallCaseId={c.id} stepLabel={v.approval.next.label} />
            </div>
          )}
          {c.status === "submitted" && !v.can.decide && <p className="mt-3 text-[13px] text-muted">The person who started it and the person who sent it cannot approve it; each step is decided by a different person.</p>}
        </Card>

        <Card>
          <span id="lots" className="block scroll-mt-24" />
          <CardTitle>Lots in this recall</CardTitle>
          {v.can.mark && (
            <div className="mb-4">
              <MarkRecalledForm recallCaseId={c.id} count={v.lots.filter((l) => l.outcome === "pending").length} />
            </div>
          )}
          {v.can.drill && (
            <div className="mb-4">
              <StartDrillForm recallCaseId={c.id} />
            </div>
          )}
          {v.lots.length === 0 ? (
            <p className="text-[13px] text-muted">No lots at your sites.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[14px]">
              {v.lots.map((l) => {
                const [label, tone] = OUTCOME[l.outcome as keyof typeof OUTCOME] ?? [l.outcome, "neu"];
                return (
                  <li key={l.id} className="flex flex-col gap-1 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link className="font-mono font-medium text-primary-text hover:underline" href={`/quality/lots/${l.lotId}`}>
                        {l.lotNumber}
                      </Link>
                      <QaStatusChip status={l.status} />
                      <Chip tone={tone}>{label}</Chip>
                    </span>
                    <span className="text-[13px] text-fg-2">
                      {l.traceRole === "start" ? "The one you started from" : "Made from it"} · at the start: {qaWord(l.statusAtOpening)}, {fmtLotQty(l.onHandAtOpening, l.uomBase)} · {l.siteCode}
                    </span>
                    {l.note && <span className="text-[12px] text-muted">{l.note}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {v.boxes.length > 0 && (
            <p className="mt-3 text-[13px] text-fg-2">
              Boxes ({v.boxes.length}; a box has the status of its lot): {v.boxes.map((b) => `${b.number}${b.drNumber ? ` (DR ${b.drNumber})` : ""}`).join(", ")}
            </p>
          )}
        </Card>

        <Card>
          <span id="customers" className="block scroll-mt-24" />
          <CardTitle>Customers to tell</CardTitle>
          <details className="mb-3 text-[13px]">
            <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">What we tell them (company text)</summary>
            <p className="mt-2 whitespace-pre-wrap rounded-[12px] border border-line bg-surface-2 p-3">{v.noticeText}</p>
            <p className="mt-1 text-[12px] text-muted">Setting quality.recall_case.notice_text; it must be approved by the company&apos;s QA and regulatory personnel before a real notification is sent.</p>
          </details>
          {v.customers.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing of these lots was sent from your sites; nobody to tell.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {v.customers.map((cu) => (
                <li key={cu.customerId} className="rounded-[16px] border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{cu.name}</span>
                    <span className="text-[12px] text-muted">{cu.code}</span>
                    {cu.acknowledgedAt ? <Chip tone="ok">Answered</Chip> : cu.notifiedAt ? <Chip tone="info">Told {fmtDateTime(cu.notifiedAt)}{cu.method ? ` · ${cu.method}` : ""}</Chip> : <Chip tone="warn">To tell</Chip>}
                  </div>
                  <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                    {cu.lines.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-x-2">
                        <span className="font-mono text-[12px] text-muted">{l.lotNumber}</span>
                        <span>
                          sent {fmtLotQty(l.qtyShippedBase, l.uomBase)} · back {fmtLotQty(l.qtyReturnedLive, l.uomBase)} · accounted {fmtLotQty(l.qtyAccountedBase, l.uomBase)}
                        </span>
                        {l.reconciled ? <Chip tone="ok">All counted</Chip> : <Chip tone="warn">Still out: {fmtLotQty(l.outstanding, l.uomBase)}</Chip>}
                        <span className="text-[12px] text-muted">receipt {l.drNumber}</span>
                        {l.accountedNote && <span className="text-[12px] text-muted">({l.accountedNote})</span>}
                      </li>
                    ))}
                  </ul>
                  {v.can.notify && (
                    <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                      {!cu.notifiedAt && <NotifyForm recallCaseId={c.id} customerId={cu.customerId} event="notified" methods={v.notifyMethods} />}
                      {cu.notifiedAt && !cu.acknowledgedAt && <NotifyForm recallCaseId={c.id} customerId={cu.customerId} event="acknowledged" methods={v.notifyMethods} />}
                    </div>
                  )}
                  {v.can.account && c.status === "recovering" && (
                    <details className="mt-3 border-t border-line pt-3">
                      <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Products that will not come back (thrown away, used, never sold)</summary>
                      <div className="mt-2 flex flex-col gap-3">
                        {cu.lines.map((l) => (
                          <div key={l.id}>
                            <p className="text-[12px] text-muted">
                              DR {l.drNumber} · lot {l.lotNumber}
                            </p>
                            <AccountedForm lineId={l.id} current={String(Number(l.qtyAccountedBase))} />
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {v.can.startRecovery && (
            <div className="mt-4 border-t border-line pt-4">
              <StartRecoveryForm recallCaseId={c.id} />
            </div>
          )}
        </Card>

        <Card>
          <span id="closure" className="block scroll-mt-24" />
          <CardTitle>Count and close</CardTitle>
          {v.totals.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing was sent: nothing to count.</p>
          ) : (
            <Dl items={v.totals.map((t) => [`In ${t.uom}`, `sent ${t.shipped} − back ${t.returned} − accounted ${t.accounted} = ${t.outstanding} still out (${t.pct} % counted)`] as [string, string])} />
          )}
          {c.closureReport && <p className="mt-3 whitespace-pre-wrap text-[14px]">Final report: {c.closureReport}</p>}
          {c.reconciliationExplanation && <p className="mt-2 whitespace-pre-wrap text-[13px] text-fg-2">Why amounts do not add up: {c.reconciliationExplanation}</p>}
          {c.status === "recovering" && v.pendingLotCount > 0 && <p className="mt-3 text-[13px] text-muted">{v.pendingLotCount} lot(s) are not stopped yet (some may be at another site); closing waits for them.</p>}
          {v.can.close && (
            <div className="mt-4 border-t border-line pt-4">
              <CloseRecallForm recallCaseId={c.id} hasGaps={hasGaps} />
            </div>
          )}
        </Card>



        <Card>
          <CardTitle>What happened</CardTitle>
          <Timeline rows={v.timeline} word={(s) => ({ draft: "being prepared", submitted: "waiting for approval", approved: "approved", notifying: "telling customers", recovering: "getting products back", closed: "done", cancelled: "cancelled" })[s] ?? s} />
        </Card>
      </div>
    </>
  );
}
