import Link from "next/link";
import { NextApprover } from "@/ui/next-approver";
import { packCheckNext } from "@/modules/sales";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getPack } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { LotStatusChip } from "@/ui/inventory/bits";
import { LABEL_KIND_WORDS, labelCountWords, LabelPreview } from "@/ui/labels";
import { labelPreviewOrNull } from "@/modules/documents";
import { plural } from "@/lib/plural";
import { PlaceName } from "@/ui/inventory/place-name";
import { ScanOrPick } from "@/ui/scan-or-pick";
import { Forbidden } from "../../../forbidden";
import { addBoxAction, approvePackAction, boxingNoteAction, cancelPackAction, packCheckScanAction, packLabelsAction, removeBoxAction, submitPackAction } from "../../../sales/fulfilment-actions";
import { Cmd, ReasonCmd, ScanPanel } from "../../../sales/fulfilment-forms";
import { LABELS_MENU_PATH } from "@/lib/menu-paths";

export const metadata = { title: "Pack" };

/** Boxing screen (W08-02..05): add boxes, print labels, submit, checker scans and verifies, boxing note. */
export default async function PackPage({ params, searchParams }: { params: Promise<{ packId: string }>; searchParams: Promise<{ done?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.pack.view")) return <Forbidden what="boxing" permission="inventory.pack.view" />;
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
  const canCancel = p.status === "open" && live.length === 0 && ctx.can("inventory.pack.create");
  const canNote = ctx.can("documents.generated_document.create") && p.status !== "cancelled";
  // ADR-099 (re-audit B N9): box labels are printed here. Boxes without a label, or with one made but not printed.
  const needLabel = live.filter((b) => b.labelStatus !== "printed");
  const labelsToPrint = needLabel.length;
  const firstBox = needLabel[0] ?? live[0];
  const previewData = v.labelTemplate && firstBox ? await labelPreviewOrNull(ctx, { entityType: "container", entityId: firstBox.containerId, labelTemplateId: v.labelTemplate.id }) : null;
  const preview = previewData?.options[0] ?? null;
  const next = boxing && ctx.can("inventory.pack.create") ? (
    <NextStep text={diff > 0 ? `Scan the lot and pack the next box (${qty(String(diff))} still to box).` : "All units are boxed. Send the boxes for checking."} action={diff > 0 ? { label: "Pack a box", href: "#add-box" } : ctx.can("inventory.pack.submit") ? { label: "Submit for checking", href: "#submit" } : undefined} />
  ) : checking && ctx.can("inventory.pack.approve") && !v.isPacker ? (
    <NextStep text={`Scan the boxes and check their labels (${v.checkedCount} of ${v.required} done), then verify.`} action={{ label: "Check the boxes", href: "#check" }} />
  ) : checking ? (
    <NextStep text="Boxed and sent for checking." waitingFor={<NextApprover next={await packCheckNext(ctx, { packId: p.id })} inline />} />
  ) : p.status === "open" ? (
    <NextStep text="Boxing has started." waitingFor="Waiting for the packer to add the boxes." />
  ) : p.status === "cancelled" ? (
    <NextStep text="Cancelled. Nothing more to do." />
  ) : (
    <NextStep text="Checked and done. Print the boxing note if it is needed." action={note ? { label: "Print boxing note", href: `/print/documents/${note.id}` } : undefined} />
  );
  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ href: "/warehouse/packs", label: "Boxing" }}
        typeLabel="Boxing"
        reference={p.packNumber}
        title={v.productName}
        chip={<StatusChip status={p.status} label={checking ? "Waiting for the check" : p.status === "open" ? "Boxing now" : undefined} />}
        meta={[cfg.sourceText ?? null]}
        actions={
          <MoreMenu compact>
            <div className="flex flex-col gap-3">
              <LinkButton href="/warehouse/packs" variant="secondary">All boxing jobs</LinkButton>
              {canNote && <Cmd action={boxingNoteAction} fields={{ packId: p.id }} label={note ? "Make the boxing note again" : "Make the boxing note"} variant="secondary" />}
              {canCancel && <ReasonCmd action={cancelPackAction} fields={{ packId: p.id }} label="Cancel boxing" placeholder="e.g. Started by mistake" />}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for boxing one lot: pack each box and print its label, then another person scans the boxes and checks them.</PageIntro>
      {next}
      {done === "repacked" && <Banner tone="ok" title="Repacked. Print the new box labels, then a checker checks the boxes." />}
      {p.usedDefaultConfig && <Banner tone="warn" title="The usual box size was used">No customer box size was found, so the product's usual size is used. Sales should look at it before sending.</Banner>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>About this boxing</CardTitle>
            <Dl
              items={[
                ["Product", v.productName],
                ["Lot", v.lotNumber ? <span key="lot">{v.lotNumber} <LotStatusChip status={v.lotStatus ?? "released"} expiresOn={v.expiresOn} /> · expires {fmtDate(v.expiresOn)}</span> : "Several lots"],
                ["Units per box", String(p.unitsPerBox)],
                ["Boxed", `${qty(p.packedUnitsBase)}${p.expectedUnitsBase ? ` of ${qty(p.expectedUnitsBase)} (lot stock after samples)` : ""}`],
                ["Shelf", v.locationCode ? <PlaceName key="shelf" name={v.locationName} code={v.locationCode} /> : "—"],
                ["Packer · checker", `${v.packer}${v.checkerName ? ` · ${v.checkerName}` : ""}`],
                ["Shipping marks", cfg.shippingMarks ?? "—"],
                ["Box label", v.labelTemplate ? `${v.labelTemplate.widthMm} × ${v.labelTemplate.heightMm} mm` : "Not set up yet"],
              ]}
            />
            {p.expectedUnitsBase && diff !== 0 && p.status === "open" && <p className="mt-3 text-[13px] text-[var(--warn-fg)]">{diff > 0 ? `${diff} units still to box` : `${-diff} units over the output`}: it cannot be checked until boxes × units equal what was made (after samples).</p>}
          </Card>
          {boxing && ctx.can("inventory.pack.create") && (
            <Card id="add-box">
              <CardTitle>Add a box</CardTitle>
              <Cmd action={addBoxAction} fields={{ packId: p.id }} label="Pack box and print label" pending="Packing…" variant="cta" size="lg">
                {v.lotNumber && <ScanOrPick kind="lot" name="lotPayload" submit="code" label="Which lot are you boxing?" hint="Tap it or scan its label: this checks you box the right lot." candidates={[{ value: v.lotNumber, title: v.productName, detail: `${v.locationName ? `on ${v.locationName} · ` : ""}lot ${v.lotNumber}`, code: v.lotNumber, codes: [v.lotNumber] }]} onlyCandidates search={false} />}
                <Field label="How many in this box?" htmlFor="qty" hint={`A full box has ${p.unitsPerBox}; fewer makes a part box (the label says so).`}><Input id="qty" name="qty" inputMode="numeric" defaultValue={String(Math.min(p.unitsPerBox, diff > 0 ? diff : p.unitsPerBox))} /></Field>
              </Cmd>
            </Card>
          )}
          {checking && ctx.can("inventory.pack.approve") && !v.isPacker && (
            <Card id="check">
              <CardTitle>Checker: scan boxes · {v.checkedCount} of {v.required} ({p.verificationMode === "all" ? "every box" : "sample"})</CardTitle>
              <ScanPanel scan={packCheckScanAction.bind(null, p.id)} label="Scan each box label" hint="Compare the label with the box contents and the artwork version; tick the box below before scanning a box whose label is wrong." labelCheck />
            </Card>
          )}
          {checking && v.isPacker && <Banner tone="info" title="Waiting for a checker">You packed these boxes, so someone else checks them.</Banner>}
          <Card>
            <CardTitle>Boxes · {live.length}</CardTitle>
            {v.boxes.length === 0 ? (
              <EmptyState title="No boxes yet">Scan the lot and pack the first box.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-line text-[13px]">
                {v.boxes.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className={b.status !== "packed" ? "text-muted line-through" : ""}>
                      #{b.boxNo} · <Link href={`/inventory/containers/${b.containerId}`} className="font-mono hover:underline">{b.number}</Link> · {qty(b.qtyBase)} {b.isPartial && <Chip tone="warn">PARTIAL</Chip>} · {b.labelStatus === "printed" ? "label printed" : b.labelStatus ? "label not printed yet" : "no label yet"} {b.checked && "· checked ✓"} {b.status !== "packed" && `· ${b.status}`}
                    </span>
                    {boxing && b.status === "packed" && <ReasonCmd action={removeBoxAction} fields={{ packId: p.id, containerId: b.containerId }} label="Remove" placeholder="e.g. Carton torn" />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {p.status !== "cancelled" && ctx.can("inventory.label_job.view") && live.length > 0 && (
            <Card id="box-labels">
              <CardTitle>Box labels</CardTitle>
              {v.labelTemplate ? (
                <div className="flex flex-col gap-3" data-testid="box-labels">
                  {preview && <LabelPreview kind="box" data={preview.face} sentence={`${LABEL_KIND_WORDS.box.stick} Each box gets its own label: product, lot, use-by date, pieces in the box, box 3 of ${live.length} and the square code.`} />}
                  {labelsToPrint > 0 ? (
                    ctx.can("inventory.label_job.create") ? (
                      <Cmd action={packLabelsAction} fields={{ packId: p.id }} label={`Print ${labelCountWords(labelsToPrint)}`} pending="Making the labels…" variant={boxing ? "secondary" : "cta"} size="lg">
                        <p className="text-[15px] text-fg-2">{labelsToPrint === live.length ? `None of the ${plural(live.length, "box", "boxes")} has a printed label yet.` : `${plural(labelsToPrint, "box", "boxes")} of ${live.length} still ${labelsToPrint === 1 ? "needs its" : "need their"} label.`}</p>
                      </Cmd>
                    ) : (
                      <p className="text-[15px] text-fg-2">{plural(labelsToPrint, "box", "boxes")} still {labelsToPrint === 1 ? "needs a label" : "need labels"}. Your job cannot print labels: ask the warehouse lead.</p>
                    )
                  ) : (
                    <p className="text-[15px] text-fg-2" data-testid="box-labels-done">Every box has its label. Lost or damaged one? Open the box and print it again with a reason.</p>
                  )}
                </div>
              ) : (
                <Banner tone="warn" title="Box labels are not set up">Ask the system administrator to approve a box label layout ({LABELS_MENU_PATH}).</Banner>
              )}
            </Card>
          )}
          {boxing && ctx.can("inventory.pack.submit") && live.length > 0 && (
            <Card id="submit">
              <CardTitle>Done boxing?</CardTitle>
              <Cmd action={submitPackAction} fields={{ packId: p.id }} label="Submit for checking" variant="primary" />
            </Card>
          )}
          {checking && ctx.can("inventory.pack.approve") && !v.isPacker && (
            <Card id="verify">
              <CardTitle>Check and verify</CardTitle>
              <Cmd action={approvePackAction} fields={{ packId: p.id }} label="Verify pack" variant="cta" size="lg">
                <p className="text-[13px] text-fg-2">Every unit must be boxed, the boxes scanned and no label marked wrong.</p>
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
              <p className="text-[13px] text-fg-2">Made when the boxes are checked.</p>
            )}
          </Card>
          <Card>
            <CardTitle>Checker scans</CardTitle>
            {v.scans.length === 0 ? <p className="text-[13px] text-fg-2">No scans yet.</p> : (
              <ul className="flex flex-col gap-1 text-[12px]">
                {v.scans.map((s) => <li key={s.id}>{fmtDateTime(s.scannedAt)} · {s.scannedByName} · {s.boxNumber ?? s.scanPayload} · {s.result.replace(/_/g, " ")}</li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
