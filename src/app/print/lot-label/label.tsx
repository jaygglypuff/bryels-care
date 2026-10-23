import QRCode from "qrcode";
import { fmtDate } from "@/lib/qty";
import { fmtLotQty } from "@/ui/inventory/bits";

export type LabelData = {
  lotNumber: string;
  itemName: string;
  itemCode: string;
  supplierLotNumber: string | null;
  receivedOn: Date | string | null;
  expiresOn: string | null;
  qualityStatus: string;
  qtyBase: string;
  baseUom: string;
};

const STATUS_WORD: Record<string, string> = {
  quarantine: "QUARANTINE",
  released: "RELEASED",
  on_hold: "QA HOLD",
  rejected: "REJECTED",
  expired: "EXPIRED",
  recalled: "RECALLED",
};

/** Screen + print CSS: one 100 × 50 mm label per page (A-INV-MVP-04: label size configurable later). */
export const LABEL_CSS = `
@page { size: 100mm 50mm; margin: 0; }
.lbl-sheet { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px 12px; }
.lbl { width: 100mm; height: 50mm; box-sizing: border-box; padding: 3mm; background: #fff; color: #000;
  border: 1px solid #c9c6bc; border-radius: 2mm; display: grid; grid-template-columns: 30mm 1fr; gap: 3mm; overflow: hidden;
  font-family: Inter, Arial, sans-serif; }
.lbl-qr svg { width: 30mm; height: 30mm; display: block; }
.lbl-qr p { font: 600 6.5pt/1.1 ui-monospace, Menlo, monospace; margin-top: 1.2mm; word-break: break-all; }
.lbl-main { min-width: 0; display: flex; flex-direction: column; }
.lbl-lot { font: 700 15pt/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: -0.3pt; }
.lbl-item { font: 600 8.5pt/1.15 Inter, Arial, sans-serif; margin-top: 1.2mm; max-height: 7.5mm; overflow: hidden; }
.lbl-code { font: 400 7pt/1.1 Inter, Arial, sans-serif; color: #333; }
.lbl-grid { display: grid; grid-template-columns: auto 1fr; column-gap: 2mm; row-gap: 0.4mm; font: 400 7pt/1.15 Inter, Arial, sans-serif; margin-top: 1.2mm; }
.lbl-grid dt { color: #444; } .lbl-grid dd { font-weight: 600; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lbl-status { margin-top: auto; border: 0.5mm solid #000; text-align: center; font: 800 10pt/1.3 Inter, Arial, sans-serif; letter-spacing: 0.6pt; }
.lbl-status.q { background: #000; color: #fff; }
@media print {
  html, body { background: #fff !important; margin: 0; padding: 0; }
  .lbl-sheet { display: block; padding: 0; }
  .lbl { border: none; border-radius: 0; break-after: page; page-break-after: always; }
  .lbl:last-child { break-after: auto; page-break-after: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

export async function LotLabel({ d }: { d: LabelData }) {
  const payload = `BC:LOT:${d.lotNumber}`;
  const svg = await QRCode.toString(payload, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const word = STATUS_WORD[d.qualityStatus] ?? d.qualityStatus.toUpperCase();
  return (
    <article className="lbl" aria-label={`Label for lot ${d.lotNumber}`} data-testid="lot-label">
      <div className="lbl-qr">
        <div dangerouslySetInnerHTML={{ __html: svg }} data-testid="lot-label-qr" data-payload={payload} />
        <p>{payload}</p>
      </div>
      <div className="lbl-main">
        <div className="lbl-lot">{d.lotNumber}</div>
        <div className="lbl-item">{d.itemName}</div>
        <div className="lbl-code">{d.itemCode}</div>
        <dl className="lbl-grid">
          <dt>Supplier lot</dt>
          <dd>{d.supplierLotNumber ?? "—"}</dd>
          <dt>Received</dt>
          <dd>{fmtDate(d.receivedOn)}</dd>
          <dt>Expiry</dt>
          <dd>{fmtDate(d.expiresOn)}</dd>
          <dt>Qty</dt>
          <dd>{fmtLotQty(d.qtyBase, d.baseUom)}</dd>
        </dl>
        <div className={`lbl-status${d.qualityStatus === "released" ? "" : " q"}`}>{word}</div>
      </div>
    </article>
  );
}
