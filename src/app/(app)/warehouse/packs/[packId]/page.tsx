import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getPack } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { addBoxAction, approvePackAction, boxingNoteAction, cancelPackAction, packCheckScanAction, packLabelsAction, removeBoxAction, submitPackAction } from "../../../sales/fulfilment-actions";
import { Cmd, ReasonCmd, ScanPanel } from "../../../sales/fulfilment-forms";

export const metadata = { title: "Pack" };

/** Boxing screen (W08-02..05): add boxes, print labels, submit, checker scans and verifies, boxing note. */
export default async function PackPage({ params, searchParams }: { params: Promise<{ packId: string }>; searchParams: Promise<{ done?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.pack.view")) return <Forbidden what="boxing" />;
  const { packId } = await params;
  const { done } = await searchParams;
  let v: Awaited<ReturnType<typeof getPack>>;
  try {
    v = await getPack(ctx, packId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const p = v.pack;
  const live = v.boxes.filter((b) => b.status === "packed");
  const uom = v.baseUom ?? "pcs";
  const qty = (x: string) => fmtQty(x, uom, uom === "pcs" ? 0 : 3);
  const boxing = p.status === "open" && !p.submittedAt && p.sourceKind !== "repack";
  const checking = p.status === "open" && !!p.submittedAt;
  const diff = p.expectedUnitsBase ? Number(p.expectedUnitsBase) - Number(p.packedUnitsBase) : 0;
  const cfg = p.configSnapshot as { shippingMarks?: string | null; sourceText?: string };
  const note = v.documents.find((d) => d.documentKind === "boxing_note" && d.status === "ready");
  return (
    <>
      <PageHeader
        title={p.packNumber}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusChip status={p.status} label={checking ? "Awaiting check" : undefined} /> {cfg.sourceText ?? ""} · {v.sku}</span>}
        actions={<LinkButton href="/warehouse/packs" variant="secondary">All packs</LinkButton>}
      />
      {done === "repacked" && <div className="mb-4"><Banner tone="ok" title="Repacked. Print the new box labels, then a checker verifies the boxes." /></div>}
      {p.usedDefaultConfig && <div className="mb-4"><Banner tone="warn" title="Default config used">No approved customer carton count was found; the SKU default applies. Sales should review before shipment.</Banner></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Pack</CardTitle>
            <Dl
              items={[
                ["Product", `${v.sku} · ${v.productName}`],
                ["Lot", v.lotNumber ? <span key="lot">{v.lotNumber} <StatusChip status={v.lotStatus ?? "released"} /> · expires {fmtDate(v.expiresOn)}</span> : "Several lots"],
                ["Units per box", String(p.unitsPerBox)],
                ["Boxed", `${qty(p.packedUnitsBase)}${p.expectedUnitsBase ? ` of ${qty(p.expectedUnitsBase)} (lot stock after samples)` : ""}`],
                ["Location", v.locationCode ?? "—"],
                ["Packer · checker", `${v.packer}${v.checkerName ? ` · ${v.checkerName}` : ""}`],
                ["Shipping marks", cfg.shippingMarks ?? "—"],
                ["Label template", v.labelTemplate?.code ?? "Not set up"],
              ]}
            />
            {p.expectedUnitsBase && diff !== 0 && p.status === "open" && <p className="mt-3 text-[13px] text-[var(--warn-fg)]">{diff > 0 ? `${diff} units still to box` : `${-diff} units over the output`}: verification is blocked until boxes × units equal the lot stock after samples.</p>}
          </Card>
          {boxing && ctx.can("inventory.pack.create") && (
            <Card>
              <CardTitle>Add a box</CardTitle>
              <Cmd action={addBoxAction} fields={{ packId: p.id }} label="Pack box and print label" pending="Packing…" variant="cta" size="lg">
                <Field label="Scan the lot label" htmlFor="lotPayload" hint={`Must be lot ${v.lotNumber}`}><Input id="lotPayload" name="lotPayload" placeholder={`BC:LOT:${v.lotNumber}`} autoComplete="off" /></Field>
                <Field label="Units in this box" htmlFor="qty" hint={`Full box = ${p.unitsPerBox}; fewer marks the box PARTIAL`}><Input id="qty" name="qty" inputMode="numeric" defaultValue={String(Math.min(p.unitsPerBox, diff > 0 ? diff : p.unitsPerBox))} /></Field>
              </Cmd>
            </Card>
          )}
          {checking && ctx.can("inventory.pack.approve") && !v.isPacker && (
            <Card>
              <CardTitle>Checker: scan boxes · {v.checkedCount} of {v.required} ({p.verificationMode === "all" ? "every box" : "sample"})</CardTitle>
              <ScanPanel scan={packCheckScanAction.bind(null, p.id)} label="Scan each box label" hint="Compare the label with the box contents and the artwork version; tick the box below before scanning a box whose label is wrong." labelCheck />
            </Card>
          )}
          {checking && v.isPacker && <Banner tone="info" title="Waiting for a checker">You packed these boxes, so someone else verifies them (checker ≠ packer).</Banner>}
          <Card>
            <CardTitle>Boxes · {live.length}</CardTitle>
            {v.boxes.length === 0 ? (
              <EmptyState title="No boxes yet">Scan the lot and pack the first box.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-line text-[13px]">
                {v.boxes.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className={b.status !== "packed" ? "text-muted line-through" : ""}>
                      #{b.boxNo} · <Link href={`/inventory/containers/${b.containerId}`} className="font-mono hover:underline">{b.number}</Link> · {qty(b.qtyBase)} {b.isPartial && <Chip tone="warn">PARTIAL</Chip>} · label {b.labelStatus ?? "none"} {b.checked && "· checked ✓"} {b.status !== "packed" && `· ${b.status}`}
                    </span>
                    {boxing && b.status === "packed" && <ReasonCmd action={removeBoxAction} fields={{ packId: p.id, containerId: b.containerId }} label="Remove" placeholder="e.g. Carton torn" />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {p.status !== "cancelled" && ctx.can("inventory.label_job.create") && live.length > 0 && (
            <Card>
              <CardTitle>Box labels</CardTitle>
              {v.labelTemplate ? (
                <Cmd action={packLabelsAction} fields={{ packId: p.id }} label="Send missing labels to the print station" variant="secondary">
                  <p className="text-[13px] text-fg-2">One label per box: BC:BOX, SKU, lot, expiry, units, packed date, packer initials, box n of N.</p>
                </Cmd>
              ) : (
                <Banner tone="warn" title="Box label printing isn't set up">Ask an administrator to approve a box (carton) label template under Management → System → Templates & labels.</Banner>
              )}
              <LinkButton href="/labels" variant="ghost" className="mt-2">Open the print station</LinkButton>
            </Card>
          )}
          {boxing && ctx.can("inventory.pack.submit") && live.length > 0 && (
            <Card>
              <CardTitle>Done boxing</CardTitle>
              <Cmd action={submitPackAction} fields={{ packId: p.id }} label="Submit for checking" variant="primary" />
            </Card>
          )}
          {checking && ctx.can("inventory.pack.approve") && !v.isPacker && (
            <Card>
              <CardTitle>Verify pack</CardTitle>
              <Cmd action={approvePackAction} fields={{ packId: p.id }} label="Verify pack" variant="cta" size="lg">
                <p className="text-[13px] text-fg-2">Needs the lot output reconciled, the required boxes checked and no label marked wrong.</p>
              </Cmd>
            </Card>
          )}
          <Card>
            <CardTitle>Boxing note</CardTitle>
            {note ? (
              <>
                <LinkButton href={`/print/documents/${note.id}`} target="_blank" variant="primary" className="w-full">Print boxing note ({note.documentNumber})</LinkButton>
                <p className="mt-2 text-[12px] text-muted">Rev {note.recordRevisionNo}{note.recordRevisionNo > 1 ? " (regenerated after a repack)" : ""}</p>
              </>
            ) : (
              <p className="text-[13px] text-fg-2">Generated when the pack is verified.</p>
            )}
            {ctx.can("documents.generated_document.create") && p.status !== "cancelled" && (
              <div className="mt-3"><Cmd action={boxingNoteAction} fields={{ packId: p.id }} label={note ? "Regenerate boxing note" : "Generate boxing note"} variant="secondary" /></div>
            )}
          </Card>
          {p.status === "open" && live.length === 0 && ctx.can("inventory.pack.create") && (
            <Card><ReasonCmd action={cancelPackAction} fields={{ packId: p.id }} label="Cancel pack" placeholder="e.g. Started by mistake" /></Card>
          )}
          <Card>
            <CardTitle>Checker scans</CardTitle>
            {v.scans.length === 0 ? <EmptyState title="No scans yet" /> : (
              <ul className="flex flex-col gap-1 text-[12px]">
                {v.scans.map((s) => <li key={s.id}>{fmtDateTime(s.scannedAt)} · {s.scannedByName} · {s.boxNumber ?? s.scanPayload} · {s.result.replace(/_/g, " ")}</li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
