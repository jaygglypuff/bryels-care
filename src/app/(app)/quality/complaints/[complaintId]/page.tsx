import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getComplaint } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ComplaintStatusChip, TraceMatchChip } from "../_ui";
import { ClassifyForm, CloseForm, RaiseDeviationForm, ReopenForm, ResolveForm, StartInvestigationForm, UpdateComplaintForm } from "../forms";

export const dynamic = "force-dynamic";

const RETURN_WORD: Record<string, string> = { draft: "Draft", submitted: "Waiting for approval", approved: "Approved", received: "Received in quarantine", inspected: "Dispositioned", closed: "Closed", cancelled: "Cancelled" };

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
          This complaint does not exist or is not at one of your sites.
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
        title={c.complaintNumber}
        subtitle={`${c.customerName} · ${c.categoryLabel} · ${c.siteCode}`}
        actions={
          <>
            {v.can.trace && (
              <LinkButton href={`/quality/recall?complaintId=${c.id}`} variant="secondary">
                Trace this lot
              </LinkButton>
            )}
            <a className={linkCls} href={`/print/complaint-acknowledgement/${c.id}`}>
              Acknowledgement
            </a>
            {/* Wave 4 W4C (US-6-18): CAPA from a complaint */}
            {ctx.can("quality.capa.create") && (
              <LinkButton href={`/quality/capa/new?complaintId=${c.id}`} variant="secondary">
                Open CAPA
              </LinkButton>
            )}
            <LinkButton href="/quality/complaints" variant="secondary">
              Complaints
            </LinkButton>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        {sp.logged && <Banner tone="ok" title={`Complaint ${c.complaintNumber} logged`}>QA has been notified to assess it.</Banner>}
        {c.recallReviewFlagged && (
          <Banner tone="bad" title="Recall assessment prompted" action={<LinkButton href={`/quality/recall?complaintId=${c.id}`} variant="secondary">Open recall explorer</LinkButton>}>
            The severity is on the company&apos;s list of severities that prompt a recall assessment. The decision to recall or withdraw is taken by people (QA and the owner); the explorer lists every affected customer and box.
          </Banner>
        )}
        {c.traceMatch === "mismatch" && <Banner tone="warn" title="Code not found in this customer's shipments">The lot or box named is not among the recorded shipments to this customer. Confirm the code with the customer.</Banner>}

        <Card>
          <CardTitle action={<ComplaintStatusChip status={c.status} />}>What the customer reports</CardTitle>
          <p className="mb-4 whitespace-pre-wrap text-[14px]">{c.description}</p>
          <Dl
            items={[
              ["Customer", `${c.customerName} (${c.customerCode})${c.customerReference ? ` · ref. ${c.customerReference}` : ""}`],
              ["Received", `${fmtDateTime(c.receivedAt)} · ${c.channelLabel} · logged by ${c.receivedByName}`],
              ["Code on the label", c.reportedCode ?? "—"],
              ["Trace check", <span key="m" className="inline-flex flex-wrap items-center gap-2"><TraceMatchChip match={c.traceMatch} /><span className="text-[13px] text-muted">{c.traceMatchLabel}</span></span>],
              ["Product", v.product ? `${v.product.sku} ${v.product.name}` : "—"],
              ["Lot", v.lot ? <span key="l" className="inline-flex flex-wrap items-center gap-2"><Link className="text-primary-text hover:underline" href={`/quality/lots/${v.lot.id}`}>{v.lot.number}</Link><StatusChip status={v.lot.status} />{v.lot.expiresOn ? <span className="text-[12px] text-muted">exp. {fmtDate(v.lot.expiresOn)}</span> : null}</span> : "—"],
              ["Box", v.box ? <Link key="b" className="text-primary-text hover:underline" href={`/inventory/containers/${v.box.id}`}>{v.box.number}</Link> : "—"],
              ["Other lots in the box", v.extraLots.length ? v.extraLots.map((l) => l.number).join(", ") : "—"],
              ["Shipment", v.shipment ? <span key="s">{v.shipment.drNumber} · {v.shipment.orderId ? <Link className="text-primary-text hover:underline" href={`/sales/${v.shipment.orderId}`}>{v.shipment.orderNumber}</Link> : null} · dispatched {fmtDate(v.shipment.dispatchedAt)}</span> : "—"],
              ["Quantity affected", c.qtyAffected ?? "—"],
              ["Sample returned", c.sampleReturned ? "Yes" : "No"],
              ["Severity", c.severity ? `${c.severity}${c.classifiedByName ? ` · ${c.classifiedByName}` : ""}` : "Awaiting QA classification"],
            ]}
          />
        </Card>

        <Card>
          <CardTitle action={<Chip tone="neu">Internal</Chip>}>Investigation</CardTitle>
          <Dl
            items={[
              ["Investigation", c.investigation ?? "—"],
              ["Root cause", c.rootCause ?? "—"],
              ["Resolution", c.resolution ? `${c.resolution}${c.resolvedByName ? ` · ${c.resolvedByName}` : ""}` : "—"],
              ["Internal notes", c.internalNotes ?? "—"],
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
              <summary className="cursor-pointer text-[13px] text-primary-text">{c.severity ? "Change the severity" : "Classify the severity"}</summary>
              <div className="mt-3">
                <ClassifyForm complaintId={c.id} levels={v.severityLevels} />
              </div>
            </details>
          )}
          {v.can.update && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[13px] text-primary-text">Update the record</summary>
              <div className="mt-3">
                <UpdateComplaintForm complaintId={c.id} current={{ investigation: c.investigation, rootCause: c.rootCause, internalNotes: c.internalNotes, customerResponse: c.customerResponse }} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle action={<Chip tone="info">Customer-facing</Chip>}>Reply to the customer</CardTitle>
          <p className="whitespace-pre-wrap text-[14px]">{c.customerResponse ?? <span className="text-muted">No reply recorded yet.</span>}</p>
          <p className="mt-2 text-[12px] text-muted">The acknowledgement prints the customer&apos;s description and this reply only; internal notes, the investigation and the severity never appear on it.</p>
        </Card>

        <Card>
          <CardTitle>Linked records</CardTitle>
          <ul className="flex flex-col gap-2 text-[14px]">
            <li className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Deviation:</span>
              {v.deviation ? (
                <>
                  <Link className="text-primary-text hover:underline" href={`/quality/deviations/${v.deviation.id}`}>
                    {v.deviation.number}
                  </Link>
                  <Chip tone={v.deviation.status === "closed" ? "neu" : "warn"}>{v.deviation.status}</Chip>
                </>
              ) : (
                <span className="text-muted">none</span>
              )}
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Returns:</span>
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
              {v.can.startReturn && (
                <LinkButton href={`/sales/returns/new?complaintId=${c.id}`} variant="secondary" size="sm">
                  Start a return
                </LinkButton>
              )}
            </li>
          </ul>
          {v.can.raiseDeviation && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[13px] text-primary-text">Raise a deviation from this complaint</summary>
              <div className="mt-3">
                <RaiseDeviationForm complaintId={c.id} />
              </div>
            </details>
          )}
        </Card>

        {c.status !== "closed" && (
          <Card>
            <CardTitle>Next step</CardTitle>
            {v.can.resolve && <ResolveForm complaintId={c.id} />}
            {v.can.reopen && (
              <div className="mb-4">
                <ReopenForm complaintId={c.id} />
              </div>
            )}
            {c.status === "resolved" && (v.can.close ? <CloseForm complaintId={c.id} /> : <p className="text-[13px] text-muted">{v.can.closeBlockedReason}</p>)}
            {c.status === "open" && !v.can.investigate && <p className="text-[13px] text-muted">Waiting for the investigation to start.</p>}
            {c.status === "investigating" && !v.can.resolve && <p className="text-[13px] text-muted">Under investigation.</p>}
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
