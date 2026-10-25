import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText, Pencil, Printer } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getReceiptDocument, type ReceiptDocument } from "@/modules/inventory/receiving";
import { issueDownloadUrl } from "@/modules/inventory/receiving-documents";
import { supplierOptions } from "@/modules/masterdata";
import { Card, CardTitle, Dl, Field, LinkButton, PageHeader, Select } from "@/ui/core";
import { fmtLotQty } from "@/ui/inventory/bits";
import { ReceiptStatusChip, fmtBytes } from "@/ui/receiving";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { approveDiscrepancyAction, cancelDraftAction, linkSupplierAction, postDraftAction, recordDiscrepancyAction, reverseReceiptAction, voidFileAction } from "./actions";
import { ActionForm, ReasonField, UploadWidget } from "./forms";

export const metadata = { title: "Goods receipt" };

type Doc = ReceiptDocument["headerDocuments"][number];

async function withLinks(ctx: Awaited<ReturnType<typeof requireContext>>, docs: Doc[]) {
  if (!ctx.can("documents.file_attachment.view")) return docs.map((d) => ({ ...d, href: null as string | null }));
  return Promise.all(docs.map(async (d) => ({ ...d, href: (await issueDownloadUrl(ctx, d.id).catch(() => null))?.url ?? null })));
}

function DocList({ docs, receiptId, canVoid }: { docs: (Doc & { href: string | null })[]; receiptId: string; canVoid: boolean }) {
  if (docs.length === 0) return <p className="text-[13px] text-muted">No documents attached.</p>;
  return (
    <ul className="space-y-2">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2 text-[13px]">
          <span className="flex min-w-0 items-center gap-2">
            <FileText size={14} className="shrink-0" />
            {d.href ? (
              <a href={d.href} className="truncate font-medium text-primary-text hover:underline" rel="noopener">
                {d.fileName}
              </a>
            ) : (
              <span className="truncate font-medium">{d.fileName}</span>
            )}
            <span className="text-muted">
              {(d.documentKind ?? d.attachmentKind).toUpperCase()}
              {d.documentNumber ? ` ${d.documentNumber}` : ""} · {fmtBytes(Number(d.sizeBytes))} · {d.uploadedBy}
            </span>
          </span>
          {canVoid && (
            <details>
              <summary className="cursor-pointer text-[12px] text-muted">Remove</summary>
              <ActionForm action={voidFileAction} hidden={{ receiptId, attachmentId: d.id }} submit="Remove file" variant="danger" className="mt-2 space-y-2">
                <ReasonField id={`void-${d.id}`} placeholder="e.g. wrong supplier's certificate" />
              </ActionForm>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ grId: string }>; searchParams: Promise<{ posted?: string; saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.goods_receipt.view")) return <Forbidden what="goods receipts" />;
  const { grId } = await params;
  const { posted, saved } = await searchParams;
  let gr: ReceiptDocument;
  try {
    gr = await getReceiptDocument(ctx, grId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const title = gr.receiptNumber ?? "Draft receipt";
  const headerDocs = await withLinks(ctx, gr.headerDocuments);
  const lines = await Promise.all(gr.lines.map(async (l) => ({ ...l, docs: await withLinks(ctx, l.documents) })));
  const sups = gr.can.linkSupplier ? await supplierOptions(ctx) : [];
  const storageReady = !!process.env.FILE_STORAGE;
  const hidden = { receiptId: gr.id };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={title}
        subtitle={
          <>
            <Link href="/inventory/receipts" className="text-primary-text hover:underline">Receipts</Link> · goods receipt from {gr.supplierName} · <ReceiptStatusChip status={gr.status} />
          </>
        }
      />
      {posted && gr.status === "posted" && (
        <Banner tone="ok" title={`Receipt ${gr.receiptNumber} posted`}>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={14} /> {gr.lines.length} new {gr.lines.length === 1 ? "lot is" : "lots are"} in quarantine. Label every container, then put the stock away; QA can then release it.
          </span>
        </Banner>
      )}
      {saved && gr.status === "draft" && <Banner tone="info" title="Draft saved">Nothing is in stock yet. Attach documents, record discrepancies, then post.</Banner>}
      {gr.status === "draft" && !saved && <Banner tone="info" title="Draft: not posted">No lot, label or stock exists until the receipt is posted.</Banner>}
      {gr.status === "reversed" && (
        <Banner tone="rej" title="Receipt reversed">
          {gr.reversalReason} · by {gr.reversedByName} on {fmtDateTime(gr.reversedAt)}. The lots stay on record with zero stock.
        </Banner>
      )}
      {gr.status === "cancelled" && <Banner tone="neu" title="Draft cancelled">{gr.cancelReason}</Banner>}
      {gr.supplierBlocked && gr.status === "draft" && (
        <Banner tone="bad" title="Supplier suspended: posting is blocked (V-ASL)">{gr.supplier?.reason ?? "Procurement or QA must resolve the supplier's status first."}</Banner>
      )}
      {!gr.supplierId && gr.status !== "cancelled" && (
        <Banner tone="warn" title="Supplier not in the supplier list">
          &ldquo;{gr.supplierName}&rdquo; is not linked to a supplier record. QA cannot release these lots until procurement links it.
        </Banner>
      )}

      <div className="flex flex-wrap gap-2">
        {gr.can.printLabels && (
          <LinkButton href={`/print/lot-label/receipt/${gr.id}`} target="_blank" variant={posted ? "cta" : "secondary"} size="lg">
            <Printer size={18} /> Print labels ({gr.lines.length})
          </LinkButton>
        )}
        {gr.status === "posted" && ctx.can("inventory.movement.post") && <LinkButton href="/inventory/receive/put-away" variant="secondary" size="lg">Put away</LinkButton>}
        {gr.can.edit && (
          <LinkButton href={`/inventory/receive/${gr.id}/edit`} variant="secondary" size="lg">
            <Pencil size={16} /> Edit draft
          </LinkButton>
        )}
        {ctx.can("procurement.goods_receipt.create") && <LinkButton href="/inventory/receive" variant="secondary" size="lg">Receive more</LinkButton>}
      </div>

      {gr.can.post && (
        <Card>
          <CardTitle>Post this receipt</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Creates one quarantined lot and one receipt movement per line, and allocates the receipt number.</p>
          <ActionForm action={postDraftAction} hidden={hidden} submit="Post receipt" variant="cta" pendingText="Posting receipt…" confirm="Post this receipt? Lots and stock are created and can only be corrected by reversal." />
        </Card>
      )}

      <Card>
        <CardTitle>{gr.status === "draft" ? "Lines" : "Created lots"}</CardTitle>
        <ul className="space-y-3">
          {lines.map((l) => (
            <li key={l.id} className="rounded-[12px] border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {l.lotNumber ? (
                    <Link href={`/inventory/${l.lotId}`} className="font-mono text-[18px] font-semibold text-primary-text hover:underline" data-testid="created-lot">
                      {l.lotNumber}
                    </Link>
                  ) : (
                    <p className="text-[13px] font-semibold text-muted">Line {l.lineNo} · lot created at posting</p>
                  )}
                  <p className="text-[13px]">
                    {l.materialName} <span className="text-muted">· {l.materialCode} · supplier lot {l.supplierLotNumber ?? "—"}</span>
                  </p>
                  <p className="text-[12px] text-muted">
                    Expires {fmtDate(l.expiresOn)}
                    {l.retestOn ? ` · retest ${fmtDate(l.retestOn)}` : ""} · at {l.locationCode} ({l.locationName})
                    {l.containerCount ? ` · ${l.containerCount} containers` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular">{fmtLotQty(l.qtyBase, l.baseUom)}</span>
                  {l.uomEntered && l.uomEntered !== l.baseUom && <span className="text-[12px] text-muted">entered {fmtQty(l.qtyEntered, l.uomEntered, 2)}</span>}
                  {l.lotStatus && <StatusChip status={l.lotStatus} />}
                </div>
              </div>
              {l.flags.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {l.flags.map((f) => (
                    <li key={f} className="flex items-center gap-1.5 text-[13px] text-[var(--warn-fg)]">
                      <AlertTriangle size={14} className="shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              )}
              {l.discrepancyKind && (
                <div className="mt-2 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]">
                  <p className="font-medium">
                    {l.discrepancyLabel}: {l.discrepancyNote}
                  </p>
                  <p className="text-muted">
                    Recorded by {l.recordedByName ?? "—"} {l.discrepancyRecordedAt ? `on ${fmtDateTime(l.discrepancyRecordedAt)}` : ""}
                    {l.discrepancyApprovedBy ? ` · approved by ${l.approvedByName} (${l.discrepancyApprovalNote})` : " · awaiting procurement approval"}
                  </p>
                  {!l.discrepancyApprovedBy && gr.can.approveDiscrepancy && (
                    <div className="mt-2">
                      {gr.can.isReceiver || ctx.sodConflict(l.discrepancyRecordedBy) ? (
                        <p className="text-[12px] text-muted">You received these goods or recorded this discrepancy, so another procurement user must approve it.</p>
                      ) : (
                        <ActionForm action={approveDiscrepancyAction} hidden={{ ...hidden, lineId: l.id }} submit="Approve discrepancy" variant="secondary" className="space-y-2">
                          <ReasonField id={`appr-${l.id}`} name="note" label="Decision note" placeholder="e.g. accepted; supplier credits the short quantity" />
                        </ActionForm>
                      )}
                    </div>
                  )}
                </div>
              )}
              {gr.can.recordDiscrepancy && !l.discrepancyApprovedBy && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[13px] text-primary-text">{l.discrepancyKind ? "Change discrepancy" : "Record a discrepancy"}</summary>
                  <ActionForm action={recordDiscrepancyAction} hidden={{ ...hidden, lineId: l.id }} submit="Record discrepancy" variant="secondary" className="mt-2 space-y-2">
                    <Field label="Type" htmlFor={`kind-${l.id}`}>
                      <Select id={`kind-${l.id}`} name="kind" defaultValue={l.discrepancyKind ?? "short"}>
                        <option value="short">Short delivery</option>
                        <option value="over">Over-delivery</option>
                        <option value="damaged">Damaged</option>
                        <option value="wrong_item">Wrong item</option>
                        <option value="missing_documents">Missing documents</option>
                      </Select>
                    </Field>
                    <ReasonField id={`note-${l.id}`} name="note" label="What was wrong" />
                  </ActionForm>
                </details>
              )}
              <div className="mt-3 space-y-2">
                <p className="text-[13px] font-medium">Supplier documents</p>
                <DocList docs={l.docs} receiptId={gr.id} canVoid={gr.can.voidFile} />
                {gr.can.upload &&
                  (storageReady ? (
                    <UploadWidget entityType="goods_receipt_line" entityId={l.id} idPrefix={`up-${l.id}`} />
                  ) : (
                    <p className="text-[13px] text-muted">File storage isn&apos;t set up, so documents cannot be attached yet. Ask the system administrator.</p>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>Delivery document</CardTitle>
        <DocList docs={headerDocs} receiptId={gr.id} canVoid={gr.can.voidFile} />
        {gr.can.upload && storageReady && (
          <div className="mt-3">
            <UploadWidget entityType="goods_receipt" entityId={gr.id} header idPrefix="up-header" />
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Receipt</CardTitle>
        <Dl
          items={[
            ["Receipt no.", gr.receiptNumber ?? "Allocated at posting"],
            ["Status", <ReceiptStatusChip key="s" status={gr.status} />],
            ["Supplier", gr.supplier ? <Link key="sup" href={`/masterdata/suppliers/${gr.supplier.id}`} className="text-primary-text hover:underline">{gr.supplierName} ({gr.supplier.code})</Link> : `${gr.supplierName} (not in the supplier list)`],
            ["Supplier document", gr.supplierDocumentNumber ?? "—"],
            ["Unplanned reason", gr.reasonLabel ?? "—"],
            ["Received", `${fmtDateTime(gr.receivedAt)} by ${gr.receivedByName}`],
            ["Posted", gr.postedAt ? `${fmtDateTime(gr.postedAt)} by ${gr.postedByName}` : "—"],
            ["Notes", gr.notes ?? "—"],
          ]}
        />
      </Card>

      {gr.can.linkSupplier && (
        <Card>
          <CardTitle>Link supplier</CardTitle>
          {sups.length === 0 ? (
            <p className="text-[13px] text-muted">No active suppliers yet. Add the supplier in Master data first.</p>
          ) : (
            <ActionForm action={linkSupplierAction} hidden={hidden} submit="Link supplier" variant="secondary">
              <Field label="Supplier record" htmlFor="link-supplier">
                <Select id="link-supplier" name="supplierId" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {sups.map((s) => (
                    <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          )}
        </Card>
      )}

      {(gr.can.cancel || gr.can.reverse) && (
        <Card>
          <CardTitle>{gr.can.cancel ? "Cancel draft" : "Reverse receipt"}</CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            {gr.can.cancel ? "The draft is kept for the record and can no longer be posted." : "Posts a reversal for every line out of its receipt location. Refused if stock has moved since; move it back first. The lots stay on record."}
          </p>
          <ActionForm
            action={gr.can.cancel ? cancelDraftAction : reverseReceiptAction}
            hidden={hidden}
            submit={gr.can.cancel ? "Cancel draft" : "Reverse receipt"}
            variant="danger"
            confirm={gr.can.cancel ? "Cancel this draft?" : "Reverse this posted receipt? This posts reversal movements."}
          >
            <ReasonField id="cancel-reason" placeholder={gr.can.cancel ? "e.g. delivery refused at the dock" : "e.g. received at the wrong site"} />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
