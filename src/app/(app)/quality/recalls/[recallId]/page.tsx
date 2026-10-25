import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getRecallCase } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { fmtLotQty } from "../../_ui";
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

const OUTCOME = { pending: ["Pending", "appr"], recalled: ["Recalled", "bad"], already_recalled: ["Already recalled", "bad"], not_marked: ["Not marked", "neu"] } as const;

/** Recall case (ux-system §9.14): approval card, scope, Mark recalled, customer notification list, reconciliation, closure. */
export default async function RecallCasePage({ params, searchParams }: { params: Promise<{ recallId: string }>; searchParams: Promise<{ opened?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.recall_case.view")) return <Forbidden what="recall cases" />;
  const { recallId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getRecallCase>>;
  try {
    v = await getRecallCase(ctx, recallId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Recall case not found" action={<LinkButton href="/quality/recalls" variant="secondary">Recall cases</LinkButton>}>
          This case does not exist or none of its records is at your sites.
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
        title={c.recallNumber}
        subtitle={`${c.kindLabel} · ${c.title}`}
        actions={
          <>
            {v.can.export && (
              <>
                <a className={exportLinkCls} href={`/api/v1/quality/recalls/${c.id}/notification-list?format=csv`}>
                  Notification list CSV
                </a>
                <a className={exportLinkCls} href={`/api/v1/quality/recalls/${c.id}/notification-list?format=xlsx`}>
                  XLSX
                </a>
              </>
            )}
            <LinkButton href="/quality/recalls" variant="secondary">
              Recall cases
            </LinkButton>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        {sp.opened && <Banner tone="ok" title={`Case ${c.recallNumber} opened as a draft`}>Review the scope and classification, then submit it: QA and then the owner approve before any stock is marked.</Banner>}
        {c.recallKind === "mock" && <Banner tone="info" title="Mock recall (drill)">No stock is marked recalled. Customers on the list are contacted as a drill only.</Banner>}
        {(v.hiddenLots > 0 || v.hiddenLines > 0 || c.hiddenAtOpening > 0) && (
          <Banner tone="warn" title="Part of this case is at sites outside your access">
            {v.hiddenLots} lot(s) and {v.hiddenLines} customer line(s) are not shown{c.hiddenAtOpening ? `; ${c.hiddenAtOpening} linked record(s) were outside the opener's access when the scope was captured` : ""}.
          </Banner>
        )}

        <Card>
          <CardTitle action={<RecallStatusChip status={c.status} />}>Case</CardTitle>
          <p className="mb-4 whitespace-pre-wrap text-[14px]">{c.description}</p>
          <Dl
            items={[
              ["Traced from", `${c.subjectKind.replace("_", " ")} ${c.subjectCode} (${c.traceMode})`],
              ["Scope as of", fmtDateTime(c.scopeAsOf)],
              ["Complaint", v.complaint ? <Link key="c" className="text-primary-text hover:underline" href={`/quality/complaints/${v.complaint.id}`}>{v.complaint.number}</Link> : "—"],
              ["Classification", c.classification ?? "Not set (QA / regulatory)"],
              ["Obligations", c.regulatoryNotes ?? "—"],
              ["Opened", `${fmtDateTime(c.openedAt)} · ${c.openedByName}`],
              ["Submitted", c.submittedAt ? `${fmtDateTime(c.submittedAt)} · ${c.submittedByName}` : "—"],
              ["Marked", c.markedAt ? `${fmtDateTime(c.markedAt)} · ${c.markedByName}` : "—"],
              ["Closed", c.closedAt ? `${fmtDateTime(c.closedAt)} · ${c.closedByName}` : c.status === "cancelled" ? `Cancelled: ${c.cancelReason}` : "—"],
            ]}
          />
          {v.can.edit && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[13px] text-primary-text">Edit classification and obligations</summary>
              <div className="mt-3">
                <ClassificationForm recallCaseId={c.id} classification={c.classification} regulatoryNotes={c.regulatoryNotes} />
              </div>
            </details>
          )}
          {(v.can.submit || v.can.refresh) && (
            <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line pt-4">
              {v.can.submit && <SubmitRecallForm recallCaseId={c.id} />}
              {v.can.refresh && <RefreshScopeForm recallCaseId={c.id} />}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Approval</CardTitle>
          <ol className="flex flex-col gap-2 text-[14px]">
            {v.approval.steps.map((s) => (
              <li key={s.step} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  Step {s.step}: {s.label}
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
                    Cycle {h.cycle}: {h.decision} by {h.name} on {fmtDateTime(h.at)}
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
          {c.status === "submitted" && !v.can.decide && <p className="mt-3 text-[13px] text-muted">The opener and the submitter cannot approve; each step is decided by a different person in the step&apos;s role.</p>}
        </Card>

        <Card>
          <CardTitle>Scope: lots</CardTitle>
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
            <Table head={["Lot", "Role", "Status now", "At opening", "Outcome", "Site"]}>
              {v.lots.map((l) => {
                const [label, tone] = OUTCOME[l.outcome as keyof typeof OUTCOME] ?? [l.outcome, "neu"];
                return (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap font-medium">
                      <Link className="text-primary-text hover:underline" href={`/quality/lots/${l.lotId}`}>
                        {l.lotNumber}
                      </Link>
                    </Td>
                    <Td>{l.traceRole === "start" ? "Subject" : "Made from it"}</Td>
                    <Td>
                      <StatusChip status={l.status} />
                    </Td>
                    <Td>
                      {l.statusAtOpening.replace("_", " ")} · {fmtLotQty(l.onHandAtOpening, l.uomBase)}
                    </Td>
                    <Td>
                      <Chip tone={tone}>{label}</Chip>
                      {l.note && <div className="text-[12px] text-muted">{l.note}</div>}
                    </Td>
                    <Td>{l.siteCode}</Td>
                  </tr>
                );
              })}
            </Table>
          )}
          {v.boxes.length > 0 && (
            <p className="mt-3 text-[13px] text-fg-2">
              Boxes ({v.boxes.length}, they carry their lot&apos;s status): {v.boxes.map((b) => `${b.number}${b.drNumber ? ` (DR ${b.drNumber})` : ""}`).join(", ")}
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Customer notification list</CardTitle>
          <details className="mb-3 text-[13px]">
            <summary className="cursor-pointer text-primary-text">Notice wording (company configuration)</summary>
            <p className="mt-2 whitespace-pre-wrap rounded-[12px] border border-line bg-surface-2 p-3">{v.noticeText}</p>
            <p className="mt-1 text-[12px] text-muted">Setting quality.recall_case.notice_text; it must be approved by the company&apos;s QA and regulatory personnel before a real notification is sent.</p>
          </details>
          {v.customers.length === 0 ? (
            <p className="text-[13px] text-muted">No shipments of the affected lots at your sites; nobody to notify.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {v.customers.map((cu) => (
                <li key={cu.customerId} className="rounded-[16px] border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{cu.name}</span>
                    <span className="text-[12px] text-muted">{cu.code}</span>
                    {cu.acknowledgedAt ? <Chip tone="ok">Acknowledged</Chip> : cu.notifiedAt ? <Chip tone="info">Notified {fmtDateTime(cu.notifiedAt)}{cu.method ? ` · ${cu.method}` : ""}</Chip> : <Chip tone="warn">To notify</Chip>}
                  </div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-[13px]">
                      <thead className="text-[11px] uppercase text-muted">
                        <tr>
                          <th className="py-1">DR</th>
                          <th>Lot</th>
                          <th>Shipped</th>
                          <th>Returned</th>
                          <th>Accounted</th>
                          <th>Outstanding</th>
                        </tr>
                      </thead>
                      <tbody className="tabular">
                        {cu.lines.map((l) => (
                          <tr key={l.id} className="border-t border-line align-top">
                            <td className="py-1">{l.drNumber}</td>
                            <td>{l.lotNumber}</td>
                            <td>{fmtLotQty(l.qtyShippedBase, l.uomBase)}</td>
                            <td>{fmtLotQty(l.qtyReturnedLive, l.uomBase)}</td>
                            <td>
                              {fmtLotQty(l.qtyAccountedBase, l.uomBase)}
                              {l.accountedNote && <div className="text-[11px] text-muted">{l.accountedNote}</div>}
                            </td>
                            <td>{l.reconciled ? <Chip tone="ok">0</Chip> : <Chip tone="warn">{fmtLotQty(l.outstanding, l.uomBase)}</Chip>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {v.can.notify && (
                    <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                      {!cu.notifiedAt && <NotifyForm recallCaseId={c.id} customerId={cu.customerId} event="notified" methods={v.notifyMethods} />}
                      {cu.notifiedAt && !cu.acknowledgedAt && <NotifyForm recallCaseId={c.id} customerId={cu.customerId} event="acknowledged" methods={v.notifyMethods} />}
                    </div>
                  )}
                  {v.can.account && c.status === "recovering" && (
                    <details className="mt-3 border-t border-line pt-3">
                      <summary className="cursor-pointer text-[13px] text-primary-text">Record quantities accounted for without a return</summary>
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
          <CardTitle>Reconciliation and closure</CardTitle>
          {v.totals.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing shipped: nothing to reconcile.</p>
          ) : (
            <Dl items={v.totals.map((t) => [`Unit ${t.uom}`, `shipped ${t.shipped} − returned ${t.returned} − accounted ${t.accounted} = ${t.outstanding} outstanding (${t.pct} % reconciled)`] as [string, string])} />
          )}
          {c.closureReport && <p className="mt-3 whitespace-pre-wrap text-[14px]">Closure report: {c.closureReport}</p>}
          {c.reconciliationExplanation && <p className="mt-2 whitespace-pre-wrap text-[13px] text-fg-2">Gaps explained: {c.reconciliationExplanation}</p>}
          {c.status === "recovering" && v.pendingLotCount > 0 && <p className="mt-3 text-[13px] text-muted">{v.pendingLotCount} lot(s) are still pending (some may be at another site); closure waits for them.</p>}
          {v.can.close && (
            <div className="mt-4 border-t border-line pt-4">
              <CloseRecallForm recallCaseId={c.id} hasGaps={hasGaps} />
            </div>
          )}
        </Card>

        {v.can.cancel && (
          <Card>
            <details>
              <summary className="cursor-pointer text-[13px] text-primary-text">Cancel this case (before any stock is marked)</summary>
              <div className="mt-3">
                <CancelRecallForm recallCaseId={c.id} />
              </div>
            </details>
          </Card>
        )}

        <Card>
          <CardTitle>History</CardTitle>
          <ol className="flex flex-col gap-1 text-[13px]">
            {v.timeline.map((t, i) => (
              <li key={i}>
                {fmtDateTime(t.at)} · {t.by}: {t.from ? `${t.from} → ` : ""}
                {t.to}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
