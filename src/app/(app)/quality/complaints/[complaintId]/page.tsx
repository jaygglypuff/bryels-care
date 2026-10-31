import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getComplaint } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { QaStatusChip, Timeline } from "../../_ui";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ComplaintStatusChip, TraceMatchChip } from "../_ui";
import { ClassifyForm, CloseForm, RaiseDeviationForm, ReopenForm, ResolveForm, StartInvestigationForm, UpdateComplaintForm } from "../forms";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";

const RETURN_WORD: Record<string, string> = { draft: "Draft", submitted: "Waiting for approval", approved: "Approved", received: "Received – waiting for QA check", inspected: "QA decided", closed: "Closed", cancelled: "Cancelled" };

export default async function ComplaintPage({ params, searchParams }: { params: Promise<{ complaintId: string }>; searchParams: Promise<{ logged?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.complaint.view")) return <Forbidden what="complaints" />;
  const { complaintId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getComplaint>>;
  try {
    v = await getComplaint(ctx, complaintId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Complaint not found" action={<LinkButton href="/quality/complaints" variant="secondary">Complaints</LinkButton>}>
          This complaint does not exist or is not at one of your sites. Ask QA if you think it should be here.
        </EmptyState>
      );
    }
    throw e;
  }
  const c = v.complaint;
  const linkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";
  return (
    <>
      <PageHeader
        title={`Complaint from ${c.customerName}`}
        subtitle={
          <>
            {c.categoryLabel} · <RecordNo>{c.complaintNumber}</RecordNo>
          </>
        }
        actions={
          <>
            <Help screen="quality.complaint" />
            <MoreMenu>
              <div className="flex flex-col gap-2">
                {v.can.trace && (
                  <LinkButton href={`/quality/recall?complaintId=${c.id}`} variant="secondary">
                    Who else received this product
                  </LinkButton>
                )}
                <a className={linkCls} href={`/print/complaint-acknowledgement/${c.id}`}>
                  Letter to the customer (print)
                </a>
                {ctx.can("quality.capa.create") && (
                  <LinkButton href={`/quality/capa/new?complaintId=${c.id}`} variant="secondary">
                    Start a fix-and-prevent plan
                  </LinkButton>
                )}
                {v.can.startReturn && (
                  <LinkButton href={`/sales/returns/new?complaintId=${c.id}`} variant="secondary">
                    Take the goods back (return)
                  </LinkButton>
                )}
                <LinkButton href="/quality/complaints" variant="secondary">
                  All complaints
                </LinkButton>
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for QA: find out why the customer had a problem, answer them, then close the complaint.</PageIntro>
      {c.status === "open" ? (
        v.can.investigate ? <NextStep text="Next: say how serious it is and what QA will check." action={{ label: "Start looking into it", href: "#work" }} /> : <NextStep text="QA has been told." waitingFor="Waiting for QA to look into it." />
      ) : c.status === "investigating" ? (
        v.can.resolve ? <NextStep text="Next: write what QA found and the answer to the customer." action={{ label: "Write the answer", href: "#next" }} /> : <NextStep text="QA is looking into it." waitingFor="Waiting for QA." />
      ) : c.status === "resolved" ? (
        v.can.close ? <NextStep text="Next: the customer has the answer. Close the complaint." action={{ label: "Close it", href: "#next" }} /> : <NextStep text="Answered." waitingFor={v.can.closeBlockedReason ?? "Waiting for QA to close it."} />
      ) : null}

      <div className="flex flex-col gap-5">
        {sp.logged && <Banner tone="ok" title="Complaint saved">QA has been told and will look into it.</Banner>}
        {c.recallReviewFlagged && (
          <Banner tone="bad" title="Check if a product recall is needed" action={<LinkButton href={`/quality/recall?complaintId=${c.id}`} variant="secondary">Who received it</LinkButton>}>
            This is serious enough that QA and the owner must decide whether to call the product back. The list shows every customer who got it.
          </Banner>
        )}
        {c.traceMatch === "mismatch" && <Banner tone="warn" title="We did not send this lot to this customer">The number on the label is not in what we sent them. Ask the customer to read it again.</Banner>}

        <Card>
          <CardTitle action={<ComplaintStatusChip status={c.status} />}>What the customer reports</CardTitle>
          <p className="mb-4 whitespace-pre-wrap text-[14px]">{c.description}</p>
          <Dl
            items={[
              ["Customer", `${c.customerName} (${c.customerCode})${c.customerReference ? ` · their ref. ${c.customerReference}` : ""}`],
              ["Received", `${fmtDateTime(c.receivedAt)} · ${c.channelLabel} · written down by ${c.receivedByName}`],
              ["Number on the label", c.reportedCode ?? "—"],
              ["Did we send it to them?", <span key="m" className="inline-flex flex-wrap items-center gap-2"><TraceMatchChip match={c.traceMatch} /><span className="text-[13px] text-muted">{c.traceMatchLabel}</span></span>],
              ["Product", v.product ? `${v.product.name} · ${v.product.sku}` : "—"],
              ["Lot", v.lot ? <span key="l" className="inline-flex flex-wrap items-center gap-2"><Link className="text-primary-text hover:underline" href={`/quality/lots/${v.lot.id}`}>{v.lot.number}</Link><QaStatusChip status={v.lot.status} />{v.lot.expiresOn ? <span className="text-[12px] text-muted">use by {fmtDate(v.lot.expiresOn)}</span> : null}</span> : "—"],
              ["Box", v.box ? <Link key="b" className="text-primary-text hover:underline" href={`/inventory/containers/${v.box.id}`}>{v.box.number}</Link> : "—"],
              ["Other lots in the box", v.extraLots.length ? v.extraLots.map((l) => l.number).join(", ") : "—"],
              ["Delivery", v.shipment ? <span key="s">{v.shipment.drNumber} · {v.shipment.orderId ? <Link className="text-primary-text hover:underline" href={`/sales/${v.shipment.orderId}`}>{v.shipment.orderNumber}</Link> : null} · sent {fmtDate(v.shipment.dispatchedAt)}</span> : "—"],
              ["Pieces affected", c.qtyAffected ? String(Number(c.qtyAffected)) : "—"],
              ["Sample given back", c.sampleReturned ? "Yes" : "No"],
              ["How serious", c.severity ? `${c.severity}${c.classifiedByName ? ` · ${c.classifiedByName}` : ""}` : "Not rated yet (QA)"],
            ]}
          />
        </Card>

        <Card>
          <span id="work" className="block scroll-mt-24" />
          <CardTitle action={<Chip tone="neu">For us only</Chip>}>What QA found</CardTitle>
          <Dl
            items={[
              ["What QA checks", c.investigation ?? "—"],
              ["What caused it", c.rootCause ?? "—"],
              ["What QA found and did", c.resolution ? `${c.resolution}${c.resolvedByName ? ` · ${c.resolvedByName}` : ""}` : "—"],
              ["Notes for us only", c.internalNotes ?? "—"],
              ["Closed", c.closedAt ? `${fmtDateTime(c.closedAt)} · ${c.closedByName}` : "—"],
            ]}
          />
          {v.can.investigate && (
            <div className="mt-4 border-t border-line pt-4">
              <StartInvestigationForm complaintId={c.id} levels={v.severityLevels} canClassify={v.can.classify} />
            </div>
          )}
          {v.can.classify && c.status !== "open" && (
            <details className="mt-4 border-t border-line pt-4" open={!c.severity}>
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">{c.severity ? "Change how serious it is" : "Say how serious it is"}</summary>
              <div className="mt-3">
                <ClassifyForm complaintId={c.id} levels={v.severityLevels} />
              </div>
            </details>
          )}
          {v.can.update && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Add to what QA found</summary>
              <div className="mt-3">
                <UpdateComplaintForm complaintId={c.id} current={{ investigation: c.investigation, rootCause: c.rootCause, internalNotes: c.internalNotes, customerResponse: c.customerResponse }} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle action={<Chip tone="info">The customer sees this</Chip>}>Answer to the customer</CardTitle>
          <p className="whitespace-pre-wrap text-[14px]">{c.customerResponse ?? <span className="text-muted">No answer written yet.</span>}</p>
          <p className="mt-2 text-[12px] text-muted">The letter to the customer prints only what they told us and this answer; our notes, what QA checks and how serious it is never appear on it.</p>
        </Card>

        <Card>
          <CardTitle>Linked</CardTitle>
          <ul className="flex flex-col gap-2 text-[14px]">
            <li className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Problem report:</span>
              {v.deviation ? (
                <>
                  <Link className="text-primary-text hover:underline" href={`/quality/deviations/${v.deviation.id}`}>
                    {v.deviation.number}
                  </Link>
                  <Chip tone={v.deviation.status === "closed" ? "neu" : "warn"}>{v.deviation.status === "closed" ? "closed" : "open"}</Chip>
                </>
              ) : (
                <span className="text-muted">none</span>
              )}
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Goods taken back:</span>
              {v.returns.length ? (
                v.returns.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1">
                    <Link className="text-primary-text hover:underline" href={`/sales/returns/${r.id}`}>
                      {r.number}
                    </Link>
                    <span className="text-[12px] text-muted">{RETURN_WORD[r.status] ?? r.status}</span>
                  </span>
                ))
              ) : (
                <span className="text-muted">none</span>
              )}
            </li>
          </ul>
          {v.can.raiseDeviation && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Send a problem report to QA about this complaint</summary>
              <div className="mt-3">
                <RaiseDeviationForm complaintId={c.id} />
              </div>
            </details>
          )}
        </Card>

        {c.status !== "closed" && (
          <Card>
            <span id="next" className="block scroll-mt-24" />
            <CardTitle>Answer and close</CardTitle>
            {v.can.resolve && <ResolveForm complaintId={c.id} />}
            {v.can.reopen && (
              <div className="mb-4">
                <MoreDetails title="Not finished? Look into it again">
                  <ReopenForm complaintId={c.id} />
                </MoreDetails>
              </div>
            )}
            {c.status === "resolved" && (v.can.close ? <CloseForm complaintId={c.id} /> : <p className="text-[13px] text-muted">{v.can.closeBlockedReason}</p>)}
            {c.status === "open" && !v.can.investigate && <p className="text-[13px] text-muted">Waiting for QA to start looking into it.</p>}
            {c.status === "investigating" && !v.can.resolve && <p className="text-[13px] text-muted">QA is looking into it.</p>}
          </Card>
        )}

        <Card>
          <CardTitle>What happened</CardTitle>
          <Timeline rows={v.timeline} word={(s) => ({ open: "new", investigating: "QA looking into it", resolved: "answered", closed: "closed" })[s] ?? s} />
        </Card>
      </div>
    </>
  );
}
