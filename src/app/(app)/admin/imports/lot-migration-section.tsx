import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { issueImportFileUrl, lotMigrationHistory } from "@/modules/imports";
import { Card, CardTitle, Table, Td } from "@/ui/core";
import { Chip, StatusChip } from "@/ui/status";
import { VerifyForm } from "./forms";

/**
 * Lot page section for migrated lots (US-2-26, MC-12): the opening-balance receipt line(s) the lot came
 * from (count sheet, counter and checker, opening status and hold reason) and the scanned legacy BMR(s)
 * with the lot's legacy number, with a signed download and the second-person index check.
 * Renders nothing for lots that did not come from an opening import and carry no legacy number.
 *
 * Mount on src/app/(app)/inventory/[lotId]/page.tsx (one line, inside the page's main column):
 *   <LotMigrationSection ctx={ctx} lotId={lot.id} />
 */
export async function LotMigrationSection({ ctx, lotId }: { ctx: AuthContext; lotId: string }) {
  const h = await lotMigrationHistory(ctx, lotId);
  if (h.opening.length === 0 && h.documents.length === 0 && !h.legacyNumber) return null;
  const links = new Map<string, string>();
  if (ctx.can("documents.file_attachment.view")) {
    for (const d of h.documents) {
      try {
        links.set(d.id, (await issueImportFileUrl(ctx, d.fileAttachmentId)).url);
      } catch {
        /* no access to the scan: the row still shows the index */
      }
    }
  }
  return (
    <Card>
      <CardTitle>Opening stock and legacy records</CardTitle>
      {h.legacyNumber && <p className="mb-2 text-[13px] text-muted">Legacy batch / lot number: <span className="font-mono">{h.legacyNumber}</span> (search only; never printed in a scan code).</p>}
      {h.opening.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <Table head={["Opening receipt", "Location", "Counted", "Count sheet", "Counted / checked", "Opening status", "Import"]}>
            {h.opening.map((o) => (
              <tr key={`${o.receiptId}-${o.lineNo}`} className="align-top">
                <Td>
                  <Link className="font-mono text-primary-text underline" href={`/inventory/receive/${o.receiptId}`}>
                    {o.receiptNumber}
                  </Link>
                  <p className="text-[12px] text-muted">{fmtDateTime(o.postedAt)}{o.reversed ? " · reversed" : ""}</p>
                </Td>
                <Td>{o.location}</Td>
                <Td className="tabular">
                  {o.qtyEntered} {o.uomEntered}
                  {o.uomEntered !== o.baseUom ? <span className="text-[12px] text-muted"> = {o.qtyBase} {o.baseUom}</span> : null}
                  {o.containerCount ? <p className="text-[12px] text-muted">{o.containerCount} container(s)</p> : null}
                </Td>
                <Td className="font-mono text-[13px]">{o.countSheetRef}</Td>
                <Td className="text-[13px]">
                  {o.countedBy} / {o.checkedBy}
                </Td>
                <Td>
                  <StatusChip status={o.initialQualityStatus} />
                  {o.holdReasonNote && <p className="text-[12px] text-muted">{o.holdReasonNote}</p>}
                  {o.qualityStatusClaimed && <p className="text-[12px] text-muted">Old records: {o.qualityStatusClaimed}</p>}
                </Td>
                <Td>
                  {ctx.can("platform.import_job.view") ? (
                    <Link className="font-mono text-primary-text underline" href={`/admin/imports/${o.importJobId}`}>
                      {o.importNumber}
                    </Link>
                  ) : (
                    <span className="font-mono">{o.importNumber}</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {!h.canSeeDocuments ? (
        <p className="text-[13px] text-muted">Scanned legacy records are visible to QA and site managers.</p>
      ) : h.documents.length === 0 ? (
        <p className="text-[13px] text-muted">{h.legacyNumber ? "No scanned record is indexed for this legacy number yet." : "No legacy number on this lot."}</p>
      ) : (
        <ul className="divide-y divide-line">
          {h.documents.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="text-[14px]">
                <span className="font-mono">{d.documentNumber}</span> · {d.legacyKind.toUpperCase()} {d.legacyNumber}
                <p className="text-[13px] text-muted">
                  {d.productCode ?? "product not indexed"} · {d.startDate ? fmtDate(d.startDate) : "?"} – {d.endDate ? fmtDate(d.endDate) : "?"} · disposition {d.disposition ?? "unknown"}
                  {d.qaName ? ` · QA ${d.qaName}` : ""}
                </p>
                {d.verifiedAt ? <Chip tone="ok">Index verified by {d.verifiedByName}</Chip> : <Chip tone="warn">Index not verified yet</Chip>}
              </div>
              <div className="flex flex-col gap-2">
                {links.get(d.id) && (
                  <a className="text-[13px] text-primary-text underline" href={links.get(d.id)}>
                    Download scan
                  </a>
                )}
                {!d.verifiedAt && h.canVerify && d.indexedBy !== ctx.userId && <VerifyForm documentId={d.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
