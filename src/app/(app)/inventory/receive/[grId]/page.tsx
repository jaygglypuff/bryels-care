import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText, Pencil } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getReceiptDocument, type ReceiptDocument } from "@/modules/inventory/receiving";
import { issueDownloadUrl } from "@/modules/inventory/receiving-documents";
import { supplierOptions } from "@/modules/masterdata";
import { poFromReceiptOptions } from "@/modules/procurement";
import { Card, CardTitle, Dl, Field, Input, LinkButton, Select, Textarea } from "@/ui/core";
import { LotStatusChip, fmtLotQty } from "@/ui/inventory/bits";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { ReceiptStatusChip, fmtBytes } from "@/ui/receiving";
import { Banner } from "@/ui/status";
import { RecordHeader } from "@/ui/record";
import { goodsReceiptSteps } from "@/ui/record-steps";
import { Forbidden } from "../../../forbidden";
import { approveDiscrepancyAction, cancelDraftAction, createPoFromReceiptAction, linkSupplierAction, postDraftAction, recordDiscrepancyAction, reverseReceiptAction, voidFileAction } from "./actions";
import { ActionForm, ReasonField, UploadWidget } from "./forms";
import { printReceiptLabelsAction } from "../../../labels/actions";

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
  const headerDocs = await withLinks(ctx, gr.headerDocuments);
  const lines = await Promise.all(gr.lines.map(async (l) => ({ ...l, docs: await withLinks(ctx, l.documents) })));
  const sups = gr.can.linkSupplier ? await supplierOptions(ctx) : [];
  const storageReady = !!process.env.FILE_STORAGE;
  // S6 (ADR-077): an urgent receipt without a PO can get its purchase order afterwards.
  const atf = gr.status === "posted" && !gr.purchaseOrderId ? await poFromReceiptOptions(ctx, gr.id) : null;
  const hidden = { receiptId: gr.id };
  const canPutAway = gr.status === "posted" && ctx.can("inventory.movement.post");
  // Usability test 2026-10-30: printing from the receipt goes straight to the print preview.
  const printLabels = gr.can.printLabels && (
    <ActionForm action={printReceiptLabelsAction} hidden={hidden} submit={`Print labels (${gr.lines.length})`} variant={gr.status === "posted" ? "cta" : "secondary"} pendingText="Making the labels…" className="inline-flex" />
  );
  // One next action (R3): post a draft; once posted, label the containers, then put the stock away.
  const primary = gr.can.post ? (
    <ActionForm
      action={postDraftAction}
      hidden={hidden}
      submit={ctx.can("inventory.label_job.create") ? "Save and print labels" : "Save receipt"}
      variant="cta"
      pendingText="Saving receipt…"
      confirm="Save this receipt? The lots and stock are made now. Mistakes can only be fixed by reversing it."
    />
  ) : gr.can.printLabels ? (
    printLabels
  ) : canPutAway ? (
    <LinkButton href="/inventory/receive/put-away" variant="cta" size="lg">Put away</LinkButton>
  ) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <RecordHeader
        typeLabel="Delivery received"
        reference={gr.receiptNumber ?? "Not finished"}
        title={gr.supplierName}
        siteCode={ctx.allowedSites.find((x) => x.id === gr.siteId)?.code}
        status={gr.status}
        meta={[
          ["Received", fmtDateTime(gr.receivedAt)],
          ["Number on the supplier's paper", gr.supplierDocumentNumber],
        ]}
        steps={goodsReceiptSteps(gr.status)}
        primary={primary}
        next={
          gr.can.post
            ? "Saving makes one lot per item. The lots wait for the QA check. The receipt gets its number."
            : gr.status === "posted" && gr.can.printLabels
              ? "Next: stick a label on every container and leave them in the hold area. After QA approves the lot, put it away."
              : undefined
        }
        secondary={
          <>
            {gr.can.edit && (
              <LinkButton href={`/inventory/receive/${gr.id}/edit`} variant="secondary">
                <Pencil size={16} /> Change it
              </LinkButton>
            )}
            <MoreMenu>
              <div className="flex flex-col gap-3">
                {canPutAway && gr.can.printLabels && <LinkButton href="/inventory/receive/put-away" variant="secondary">Put away</LinkButton>}
                {ctx.can("procurement.goods_receipt.create") && <LinkButton href="/inventory/receive" variant="secondary">Receive another delivery</LinkButton>}
                <LinkButton href="/inventory/receipts" variant="secondary">All deliveries received</LinkButton>
                {(gr.can.cancel || gr.can.reverse) && (
                  <div data-testid="receipt-cancel-reverse">
                    <p className="mb-2 text-[13px] text-fg-2">
                      {gr.can.cancel ? "Cancel this unfinished delivery. It is kept on record and can no longer be saved to stock." : "Undo this delivery (kept on record): every item is taken back out of stock. Refused if stock has moved since; move it back first."}
                    </p>
                    <ActionForm
                      action={gr.can.cancel ? cancelDraftAction : reverseReceiptAction}
                      hidden={hidden}
                      submit={gr.can.cancel ? "Cancel it" : "Undo this delivery"}
                      variant="danger"
                      confirm={gr.can.cancel ? "Cancel this unfinished delivery?" : "Undo this saved delivery? The stock is taken back out. It stays on record."}
                    >
                      <ReasonField id="cancel-reason" placeholder={gr.can.cancel ? "e.g. delivery refused at the dock" : "e.g. received at the wrong site"} />
                    </ActionForm>
                  </div>
                )}
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for one delivery: what came, the lot and label for each item, papers from the supplier, and any problem with it.</PageIntro>
      {posted && gr.status === "posted" && (
        <Banner tone="ok" title={`Receipt ${gr.receiptNumber} saved`}>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={14} /> {gr.lines.length} new {gr.lines.length === 1 ? "lot is" : "lots are"} waiting for the quality check. Stick a label on every container and leave them in the hold area; put them away after QA approves.
          </span>
        </Banner>
      )}
      {saved && gr.status === "draft" && <Banner tone="info" title="Saved for later">Nothing is in stock yet. Add papers or problems, then save the receipt.</Banner>}
      {gr.status === "draft" && !saved && <Banner tone="info" title="Not finished">No lot, label or stock exists until the receipt is saved.</Banner>}
      {gr.status === "reversed" && (
        <Banner tone="rej" title="Receipt reversed">
          {gr.reversalReason} · by {gr.reversedByName} on {fmtDateTime(gr.reversedAt)}. The lots stay on record with zero stock.
        </Banner>
      )}
      {gr.status === "cancelled" && <Banner tone="neu" title="Cancelled (it was not finished)">{gr.cancelReason}</Banner>}
      {gr.supplierBlocked && gr.status === "draft" && (
        <Banner tone="bad" title="Supplier stopped: this receipt cannot be saved (V-ASL)">{gr.supplier?.reason ?? "Procurement or QA must resolve the supplier's status first."}</Banner>
      )}
      {!gr.supplierId && gr.status !== "cancelled" && (
        <Banner tone="warn" title="Supplier not in the supplier list">
          &ldquo;{gr.supplierName}&rdquo; is not linked to a supplier record. QA cannot release these lots until procurement links it.
        </Banner>
      )}

      {atf?.purchaseOrder && (
        <Banner tone="info" title={`Purchase order ${atf.purchaseOrder.poNumber} was made from this receipt`}>
          {ctx.can("procurement.purchase_order.view") ? <Link className="font-medium text-primary-text underline" href={`/procurement/orders/${atf.purchaseOrder.id}`}>Open the purchase order</Link> : "Purchasing handles it."}
        </Banner>
      )}
      {atf?.canCreate && (
        <Card data-testid="create-po-from-receipt">
          <CardTitle>No purchase order yet</CardTitle>
          <p className="mb-3 text-[13px] text-muted">This was an urgent buy. Make the purchase order now from what was received: the items and quantities are filled in, you enter the prices. It goes for approval as usual and nothing more is expected from the supplier.</p>
          <details className="group">
            <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center rounded-full bg-cta px-5 text-[14px] font-medium text-white">Create PO from this receipt</summary>
            <ActionForm action={createPoFromReceiptAction} hidden={{ ...hidden, idempotencyKey: randomUUID() }} submit="Create purchase order" variant="cta" pendingText="Creating…" className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Supplier" htmlFor="atf-supplier">
                  <Select id="atf-supplier" name="supplierId" required defaultValue={atf.supplierId ?? ""}>
                    <option value="" disabled>Choose…</option>
                    {atf.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tax amount (optional)" htmlFor="atf-tax">
                  <Input id="atf-tax" name="taxAmount" inputMode="decimal" placeholder="From the supplier's invoice" />
                </Field>
              </div>
              <ul className="space-y-2">
                {atf.lines.map((l, i) => (
                  <li key={l.id} className="grid grid-cols-1 items-end gap-3 rounded-[12px] border border-line p-3 sm:grid-cols-[1fr_200px]">
                    <input type="hidden" name={`lines.${i}.receiptLineId`} value={l.id} />
                    <label className="flex min-h-[44px] items-start gap-3 text-[14px]">
                      <input type="checkbox" name={`lines.${i}.include`} value="yes" defaultChecked className="mt-0.5 size-5 shrink-0" />
                      <span className="min-w-0">
                        <span className="font-medium">{l.name}</span> <span className="text-muted">· {l.code}</span>
                        <span className="block text-[13px] text-muted">Received {fmtLotQty(l.qtyBase, l.baseUom)}</span>
                      </span>
                    </label>
                    <Field label={`Price per ${l.uomEntered ?? l.baseUom}`} htmlFor={`atf-price-${l.id}`}>
                      <Input id={`atf-price-${l.id}`} name={`lines.${i}.unitAmount`} inputMode="decimal" placeholder="Supplier price if empty" />
                    </Field>
                  </li>
                ))}
              </ul>
              <Field label="Why was there no purchase order?" htmlFor="atf-reason" hint="Kept on the purchase order and shown to the approver.">
                <Textarea id="atf-reason" name="reason" required minLength={5} maxLength={1000} placeholder="e.g. ran out of coconut oil; owner ordered by phone" />
              </Field>
              <Field label="Notes (optional)" htmlFor="atf-notes">
                <Input id="atf-notes" name="notes" maxLength={1000} />
              </Field>
            </ActionForm>
          </details>
        </Card>
      )}
      {atf && !atf.canCreate && !atf.purchaseOrder && ctx.can("procurement.purchase_order.create") && atf.blockedReason && (
        <p className="text-[13px] text-muted">{atf.blockedReason}</p>
      )}

      <Card>
        <CardTitle>{gr.status === "draft" ? "What came" : "What came (one lot each)"}</CardTitle>
        <ul className="space-y-3">
          {lines.map((l) => (
            <li key={l.id} className="rounded-[12px] border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold">{l.materialName}</p>
                  {l.lotNumber ? (
                    <p className="text-[13px]">
                      Lot{" "}
                      <Link href={`/inventory/${l.lotId}`} className="font-mono font-semibold text-primary-text hover:underline" data-testid="created-lot">
                        {l.lotNumber}
                      </Link>
                    </p>
                  ) : (
                    <p className="text-[13px] text-muted">Item {l.lineNo} · the lot is made when the delivery is saved</p>
                  )}
                  <p className="text-[13px] text-muted">
                    Supplier&apos;s code on the sack {l.supplierLotNumber ?? "—"}{l.brand ? ` · brand ${l.brand}` : ""}
                  </p>
                  <p className="text-[12px] text-muted">
                    Expires {fmtDate(l.expiresOn)}
                    {l.retestOn ? ` · retest ${fmtDate(l.retestOn)}` : ""} · at {l.locationCode} ({l.locationName})
                    {l.containerCount ? ` · ${l.containerCount} sacks/containers` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular">{fmtLotQty(l.qtyBase, l.baseUom)}</span>
                  {l.uomEntered && l.uomEntered !== l.baseUom && <span className="text-[12px] text-muted">entered {fmtQty(l.qtyEntered, l.uomEntered, 2)}</span>}
                  {l.lotStatus && <LotStatusChip status={l.lotStatus} expiresOn={l.expiresOn} />}
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
                    {l.discrepancyApprovedBy ? ` · approved by ${l.approvedByName} (${l.discrepancyApprovalNote})` : " · waiting for purchasing to accept it"}
                  </p>
                  {!l.discrepancyApprovedBy && gr.can.approveDiscrepancy && (
                    <div className="mt-2">
                      {gr.can.isReceiver || ctx.sodConflict(l.discrepancyRecordedBy) ? (
                        <p className="text-[12px] text-muted">You received these goods or wrote down this problem, so another purchasing person must accept it.</p>
                      ) : (
                        <ActionForm action={approveDiscrepancyAction} hidden={{ ...hidden, lineId: l.id }} submit="Accept the problem" variant="secondary" className="space-y-2">
                          <ReasonField id={`appr-${l.id}`} name="note" label="Decision note" placeholder="e.g. accepted; supplier credits the short quantity" />
                        </ActionForm>
                      )}
                    </div>
                  )}
                </div>
              )}
              {gr.can.recordDiscrepancy && !l.discrepancyApprovedBy && (
                <details className="mt-2">
                  <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[13px] text-primary-text">{l.discrepancyKind ? "Change the problem" : "Something wrong with this item?"}</summary>
                  <ActionForm action={recordDiscrepancyAction} hidden={{ ...hidden, lineId: l.id }} submit="Save the problem" variant="secondary" className="mt-2 space-y-2">
                    <Field label="What kind of problem?" htmlFor={`kind-${l.id}`}>
                      <Select id={`kind-${l.id}`} name="kind" defaultValue={l.discrepancyKind ?? "short"}>
                        <option value="short">Less came than ordered</option>
                        <option value="over">More came than ordered</option>
                        <option value="damaged">Damaged</option>
                        <option value="wrong_item">Wrong item</option>
                        <option value="missing_documents">Papers are missing</option>
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
        <CardTitle>Delivery paper (photo or scan)</CardTitle>
        <DocList docs={headerDocs} receiptId={gr.id} canVoid={gr.can.voidFile} />
        {gr.can.upload && storageReady && (
          <div className="mt-3">
            <UploadWidget entityType="goods_receipt" entityId={gr.id} header idPrefix="up-header" />
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>About this delivery</CardTitle>
        <Dl
          items={[
            ["Number", gr.receiptNumber ?? "Given when saved"],
            ["Status", <ReceiptStatusChip key="s" status={gr.status} />],
            ["Supplier", gr.supplier ? <Link key="sup" href={`/masterdata/suppliers/${gr.supplier.id}`} className="text-primary-text hover:underline">{gr.supplierName} ({gr.supplier.code})</Link> : `${gr.supplierName} (not in the supplier list)`],
            ["Number on the supplier's paper", gr.supplierDocumentNumber ?? "—"],
            ["Why no purchase order", gr.reasonLabel ?? "—"],
            ["Received", `${fmtDateTime(gr.receivedAt)} by ${gr.receivedByName}`],
            ["Saved", gr.postedAt ? `${fmtDateTime(gr.postedAt)} by ${gr.postedByName}` : "—"],
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

    </div>
  );
}
