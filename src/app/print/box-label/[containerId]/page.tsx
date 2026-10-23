import { notFound } from "next/navigation";
import QRCode from "qrcode";
import Decimal from "decimal.js";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate } from "@/lib/qty";
import { getContainer, type ContainerDetail } from "@/modules/inventory/containers";
import { LinkButton } from "@/ui/core";
import { fmtLotQty } from "@/ui/inventory/bits";
import { LABEL_CSS } from "../label-css";
import { PrintButton } from "../../lot-label/print-button";

export const metadata = { title: "Box label" };

const STATUS_WORD: Record<string, string> = { quarantine: "QUARANTINE", released: "RELEASED", on_hold: "QA HOLD", rejected: "REJECTED", expired: "EXPIRED", recalled: "RECALLED" };

/**
 * Box label (US-2-15), same page pattern and 100 × 50 mm size as the lot label: QR payload
 * BC:BOX:<container_number> (ADR-017, never a URL), contents, earliest expiry, quality status at
 * print and PARTIAL for a partial box. Template/printer configuration is US-2-12.
 */
export default async function BoxLabelPage({ params }: { params: Promise<{ containerId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.create") || !ctx.can("inventory.container.view")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { containerId } = await params;
  let box: ContainerDetail;
  try {
    box = await getContainer(ctx, containerId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const payload = `BC:BOX:${box.containerNumber}`;
  const svg = await QRCode.toString(payload, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const statuses = [...new Set(box.contents.map((c) => c.qualityStatus))];
  const word = statuses.length === 1 ? (STATUS_WORD[statuses[0]] ?? statuses[0].toUpperCase()) : statuses.length ? "MIXED STATUS" : "EMPTY";
  const expiries = box.contents.map((c) => c.expiresOn).filter((x): x is string => !!x).sort();
  const first = box.contents[0];
  return (
    <main>
      <style>{LABEL_CSS}</style>
      <div className="no-print mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 px-4 pt-6">
        <div>
          <h1 className="text-[18px] font-semibold">Box label · {box.containerNumber}</h1>
          <p className="text-[13px] text-muted">100 × 50 mm, one label per page. Contents and status are as of printing; reprint after a split, merge or repack.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/inventory/containers/${box.id}`} variant="secondary" size="lg">Back</LinkButton>
          <PrintButton />
        </div>
      </div>
      <div className="lbl-sheet">
        <article className="lbl" aria-label={`Label for box ${box.containerNumber}`} data-testid="box-label">
          <div className="lbl-qr">
            <div dangerouslySetInnerHTML={{ __html: svg }} data-testid="box-label-qr" data-payload={payload} />
            <p>{payload}</p>
          </div>
          <div className="lbl-main">
            <div className="lbl-lot">{box.containerNumber}</div>
            <div className="lbl-item">{first ? first.itemName : "Empty box"}{box.contents.length > 1 ? ` +${box.contents.length - 1} lot(s)` : ""}</div>
            <div className="lbl-code">{first?.itemCode ?? ""}</div>
            <dl className="lbl-grid">
              <dt>Lot</dt>
              <dd>{box.contents.map((c) => c.lotNumber).join(", ") || "—"}</dd>
              <dt>Qty</dt>
              <dd>{box.contents.map((c) => fmtLotQty(new Decimal(c.qtyBase).toString(), c.baseUom)).join(", ") || "—"}{box.isPartial ? " · PARTIAL" : ""}</dd>
              <dt>Expiry</dt>
              <dd>{fmtDate(expiries[0] ?? null)}</dd>
              <dt>Packed</dt>
              <dd>{fmtDate(box.packedAt)}</dd>
            </dl>
            <div className={`lbl-status${statuses.length === 1 && statuses[0] === "released" ? "" : " q"}`}>{word}</div>
          </div>
        </article>
      </div>
    </main>
  );
}
