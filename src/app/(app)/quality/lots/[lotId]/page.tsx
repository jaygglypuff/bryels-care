import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { daysUntil, fmtDate, fmtDateTime } from "@/lib/qty";
import { getLotDisposition } from "@/modules/quality/dispositions";
import { issueDownloadUrl, listLotDocuments } from "@/modules/inventory/receiving-documents";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DecisionChip, DeviationStatusChip, InspectionStatusChip, Transition, fmtLotQty, statusTone } from "../../_ui";
import { StartInspectionButton } from "../../w2c-forms";
import { decideLotAction } from "../../actions";
import { DecisionForm, type DecisionOption } from "../../decision-form";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";

const BANNER: Record<string, { title: string; body: string }> = {
  quarantine: { title: "Quarantined: awaiting QA decision", body: "This lot cannot be issued, allocated or shipped until it is released." },
  on_hold: { title: "On QA hold", body: "Use of this lot is blocked until QA releases it from hold or rejects it." },
  released: { title: "Released", body: "This lot may be used and shipped through the normal flows." },
  rejected: { title: "Rejected", body: "This lot is blocked and its stock is in the rejected-goods location." },
  expired: { title: "Expired", body: "This lot is past its expiry date and cannot be released. Reject it to move the stock to the rejected-goods cage." },
  recalled: { title: "Recalled", body: "This lot is blocked by a recall." },
};

const HINT: Record<string, string> = {
  release: "Quarantine → Released. The lot becomes usable.",
  release_from_hold: "On hold → Released.",
  hold: "Blocks use until QA lifts the hold. Stock stays where it is.",
  reject: "Lot → Rejected. All stock moves to the rejected-goods location.",
};

export default async function LotDispositionPage({ params }: { params: Promise<{ lotId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.disposition.view")) return <Forbidden what="QA lot decisions" />;
  const { lotId } = await params;

  let v: Awaited<ReturnType<typeof getLotDisposition>>;
  try {
    v = await getLotDisposition(ctx, lotId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Lot not found" action={<LinkButton href="/quality" variant="secondary">Back to QA queue</LinkButton>}>
          This lot does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const { lot } = v;
  const docs = await Promise.all(
    (await listLotDocuments(ctx, lot.id)).map(async (d) => ({
      ...d,
      href: ctx.can("documents.file_attachment.view") ? ((await issueDownloadUrl(ctx, d.id).catch(() => null))?.url ?? null) : null,
    })),
  );
  const banner = BANNER[lot.qualityStatus] ?? { title: lot.qualityStatus, body: "" };
  const days = daysUntil(lot.expiresOn);
  const options: DecisionOption[] = v.decisions.map((d) => ({
    value: d.decision,
    label: d.label,
    hint: HINT[d.decision],
    blocker: d.blocker,
    danger: d.decision === "reject",
  }));

  return (
    <>
      <PageHeader
        title={lot.lotNumber}
        subtitle={
          <>
            {v.itemName} {v.itemCode && <span className="text-muted">· {v.itemCode}</span>} · {lot.itemKind === "material" ? "Material lot" : "Finished-goods lot"}
          </>
        }
        actions={
          <>
            <Help screen="quality.release" />
            <LinkButton href="/quality" variant="secondary">
              QA queue
            </LinkButton>
            <LinkButton href={`/inventory/${lot.id}`} variant="secondary">
              Lot details
            </LinkButton>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <Banner tone={statusTone(lot.qualityStatus)} title={banner.title}>
          {banner.body}
        </Banner>
        {v.expired && lot.qualityStatus !== "expired" && (
          <Banner tone="exp" title={`Expiry date passed (${fmtDate(lot.expiresOn)})`}>
            Release is blocked. Reject the lot or place it on hold.
          </Banner>
        )}
        {v.pendingBatch && (
          <Banner tone="appr" title={`Output of batch ${v.pendingBatch.number}`} action={<LinkButton href={`/quality/batches/${v.pendingBatch.id}`} size="sm">Open batch release</LinkButton>}>
            Finished-goods lots are released or rejected together with their batch.
          </Banner>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle>Lot identity</CardTitle>
            <Dl
              items={[
                ["Lot number", lot.lotNumber],
                ["Item", v.itemName],
                ["Status", <StatusChip key="s" status={lot.qualityStatus} />],
                ["Expiry", <span key="e">{fmtDate(lot.expiresOn)}{days !== null && !v.expired ? <span className="text-muted"> · {days} days</span> : null}</span>],
                ["Manufactured", fmtDate(lot.manufacturedOn)],
                ["Base unit", lot.baseUom],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>{lot.itemKind === "material" ? "Receipt" : "Origin"}</CardTitle>
            {v.receipt ? (
              <Dl
                items={[
                  ["Goods receipt", v.receipt.receiptNumber],
                  ["Supplier", v.receipt.supplierName],
                  ["Supplier lot", lot.supplierLotNumber ?? "—"],
                  ["Supplier document", v.receipt.supplierDocumentNumber ?? "—"],
                  ["Received by", v.receipt.receivedByName],
                  ["Received", fmtDateTime(v.receipt.receivedAt)],
                  ["Quantity received", fmtLotQty(v.receipt.qtyReceived, lot.baseUom)],
                ]}
              />
            ) : (
              <Dl
                items={[
                  ["Source batch", v.sourceBatch ? <Link key="b" className="text-primary-text hover:underline" href={`/quality/batches/${v.sourceBatch.id}`}>{v.sourceBatch.number}</Link> : "—"],
                  ["Batch status", v.sourceBatch ? <StatusChip key="bs" status={v.sourceBatch.status} /> : "—"],
                  ["Supplier", lot.supplierName ?? "—"],
                  ["Supplier lot", lot.supplierLotNumber ?? "—"],
                  ["Created by", v.createdByName ?? "—"],
                  ["Created", fmtDateTime(lot.createdAt)],
                ]}
              />
            )}
          </Card>
        </div>

        {lot.itemKind === "material" && (
          <Card>
            <CardTitle>Supplier documents</CardTitle>
            {docs.length === 0 ? (
              <p className="text-[13px] text-muted">No CoA or other supplier document is attached to this lot{v.receipt ? "; attach it on the goods receipt" : ""}.</p>
            ) : (
              <ul className="space-y-1 text-[13px]">
                {docs.map((d) => (
                  <li key={d.id}>
                    {d.href ? <a href={d.href} className="font-medium text-primary-text hover:underline">{d.fileName}</a> : <span className="font-medium">{d.fileName}</span>}
                    <span className="text-muted"> · {d.documentKind.toUpperCase()}{d.documentNumber ? ` ${d.documentNumber}` : ""} · {d.uploadedBy}, {fmtDateTime(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <CardTitle>Stock on hand</CardTitle>
          {v.stock.length === 0 ? (
            <EmptyState title="No stock on hand">The lot has been fully used, shipped or written off.</EmptyState>
          ) : (
            <Table head={["Location", "Kind", "Quantity"]}>
              {v.stock.map((s) => (
                <tr key={s.locationCode}>
                  <Td className="font-medium">
                    {s.locationCode} <span className="font-normal text-muted">· {s.locationName}</span>
                  </Td>
                  <Td>{s.kind.charAt(0).toUpperCase() + s.kind.slice(1)}</Td>
                  <Td>{fmtLotQty(s.qty, lot.baseUom)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {lot.itemKind === "material" && (
          <Card>
            <CardTitle>Incoming inspection</CardTitle>
            {v.inspections.length === 0 ? (
              <p className="text-[13px] text-muted">No inspection recorded for this lot. Start one to sample it and enter the approved incoming plan&apos;s tests.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[14px]">
                {v.inspections.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    <Link className="font-medium text-primary-text hover:underline" href={`/quality/inspections/${i.id}`}>
                      {i.number}
                    </Link>
                    <InspectionStatusChip status={i.status} outcome={i.outcome} />
                  </li>
                ))}
              </ul>
            )}
            {v.can.startInspection && !v.inspections.some((i) => i.status !== "cancelled") && (
              <div className="mt-3">
                <StartInspectionButton lotId={lot.id} />
              </div>
            )}
          </Card>
        )}

        <Card>
          <CardTitle action={v.can.raiseDeviation ? <LinkButton href={`/quality/deviations/new?lotId=${lot.id}`} variant="secondary" size="sm">Raise deviation</LinkButton> : undefined}>Deviations</CardTitle>
          {v.deviations.length === 0 ? (
            <p className="text-[13px] text-muted">No deviation names this lot.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.deviations.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start gap-2 py-2 text-[14px]">
                  <Link className="font-medium text-primary-text hover:underline" href={`/quality/deviations/${d.id}`}>
                    {d.number}
                  </Link>
                  <DeviationStatusChip status={d.status} />
                  {d.status === "closed" && d.releasePermitted === false && <Chip tone="rej">Release not permitted</Chip>}
                  <span className="min-w-0 flex-1 text-[13px] text-fg-2">{d.description}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>QA decision</CardTitle>
          {v.canDecide ? (
            <>
              {v.isReceiver && (
                <div className="mb-3">
                  <Banner tone="warn" title="You received this lot">
                    Separation of duties: another QA user must release it. You may still place it on hold or reject it.
                  </Banner>
                </div>
              )}
              <DecisionForm action={decideLotAction} hidden={{ lotId: lot.id }} options={options} />
            </>
          ) : (
            <p className="text-[13px] text-muted">You can view this lot. Recording a QA decision needs the QA approval permission (quality.disposition.approve).</p>
          )}
        </Card>

        <Card>
          <CardTitle>Decision history</CardTitle>
          {v.history.length === 0 ? (
            <EmptyState title="No decisions yet">Every QA decision on this lot is listed here with who made it and why.</EmptyState>
          ) : (
            <Table head={["When", "Decision", "Status change", "Decided by", "Reason"]}>
              {v.history.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(h.decidedAt)}</Td>
                  <Td>
                    <DecisionChip decision={h.decision} />
                  </Td>
                  <Td>
                    <Transition from={h.fromStatus} to={h.toStatus} />
                  </Td>
                  <Td>{h.decidedByName}</Td>
                  <Td className="text-fg-2">{h.reason ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
