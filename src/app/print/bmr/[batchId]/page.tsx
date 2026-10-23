import type { Metadata } from "next";
import { Logo } from "@/ui/brand";
import Link from "next/link";
import QRCode from "qrcode";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { type BatchRecord, getBatchRecord } from "@/modules/production";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Batch Manufacturing Record" };
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ batchId: string }> };

/** Escapes text for a CSS string literal used in @page margin boxes. */
const cssString = (s: string) => `"${s.replace(/[\\"]/g, (m) => "\\" + m).replace(/[\r\n]+/g, " ")}"`;

const DOC_STATE: Record<string, string> = {
  draft: "DRAFT",
  planned: "DRAFT",
  materials_staged: "IN PROGRESS",
  in_process: "IN PROGRESS",
  awaiting_qc: "UNDER QA REVIEW",
  quarantined: "UNDER QA REVIEW",
  released: "FINAL",
  rejected: "FINAL – REJECTED",
  closed: "FINAL",
};

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-lg p-10 text-center">
      <h1 className="text-[18px] font-semibold">{title}</h1>
      <p className="mt-2 text-[13px] text-[#5b5951]">{body}</p>
      <Link href="/production" className="mt-4 inline-block text-[13px] text-[#23703f] underline">
        Back to batches
      </Link>
    </main>
  );
}

function Sig({ name, at }: { name: string | null | undefined; at?: Date | string | null }) {
  if (!name) return <span className="sig-empty" />;
  return (
    <span>
      {name}
      {at ? <span className="sig-at">{fmtDateTime(at)}</span> : null}
    </span>
  );
}

export default async function BmrPrintPage({ params }: Params) {
  const { batchId } = await params;
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Message title="You don't have access" body="Your role does not include viewing batch records." />;
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return <Message title="Batch not found" body="Check the link and try again." />;
  let rec: BatchRecord;
  try {
    rec = await getBatchRecord(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError) return <Message title="Batch not found" body="It does not exist or belongs to a site you are not assigned to." />;
    throw e;
  }
  const { batch, product, snapshot } = rec;
  const qr = await QRCode.toString(`BC:DOC:${batch.batchNumber}`, { type: "svg", margin: 0 });
  const generatedAt = fmtDateTime(new Date());
  const released = batch.status === "released" || batch.status === "closed";
  const docState = DOC_STATE[batch.status] ?? batch.status.toUpperCase();
  const footer = `${batch.batchNumber} · Generated ${generatedAt} by ${ctx.displayName} · electronic record, signatures are attestations pending validation`;
  const disposition = [...rec.dispositions].reverse().find((d) => d.decision === "release" || d.decision === "reject") ?? null;
  const approved = disposition?.decision === "release";
  const disapproved = disposition?.decision === "reject";
  const firstTest = rec.tests[0];
  const testDate = firstTest ? fmtDate(firstTest.testedAt) : "";
  const testers = [...new Set(rec.tests.map((t) => t.testedByName).filter(Boolean))].join(", ");
  const exceptions = rec.ingredients.flatMap((i) => i.records.filter((r) => !r.isWithinTolerance).map((r) => ({ i, r })));
  const fillerRows = Math.max(0, 8 - rec.ingredients.length);

  return (
    <div className="bmr-root">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 12mm 12mm 16mm 12mm;
          @bottom-left { content: ${cssString(footer)}; font-size: 7pt; color: #444; font-family: Inter, Arial, sans-serif; }
          @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7pt; color: #444; font-family: Inter, Arial, sans-serif; }
        }
        .bmr-root { background: #e9e7e1; min-height: 100vh; padding: 16px 0 40px; color: #111; }
        .bmr-toolbar { max-width: 210mm; margin: 0 auto 12px; display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 0 4px; font-size: 13px; }
        .bmr-page { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 12mm; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-family: Inter, Arial, sans-serif; font-size: 9pt; line-height: 1.3; overflow: hidden; }
        .bmr-page table { width: 100%; border-collapse: collapse; }
        .bmr-page th, .bmr-page td { border: 0.8px solid #222; padding: 3px 5px; vertical-align: top; text-align: left; }
        .bmr-page thead { display: table-header-group; }
        .bmr-page tr { break-inside: avoid; }
        .bmr-page .lbl { font-size: 7.5pt; color: #333; display: block; }
        .bmr-page .val { font-weight: 700; font-size: 10pt; }
        .bmr-page table.disp { table-layout: fixed; font-size: 8pt; }
        .bmr-page table.disp th { font-size: 7.5pt; font-weight: 600; }
        .bmr-page table.disp td, .bmr-page table.disp th { overflow-wrap: anywhere; }
        .bmr-page th.num { white-space: normal; }
        .bmr-page .nowrap { white-space: nowrap; overflow-wrap: normal !important; font-size: 7.5pt; }
        .bmr-page .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .bmr-page h2 { font-size: 9pt; font-weight: 700; margin: 10px 0 4px; letter-spacing: .02em; }
        .bmr-page .title { text-align: center; font-weight: 800; font-size: 12pt; letter-spacing: .03em; }
        .bmr-page .brand { font-weight: 800; font-size: 15pt; color: #28804b; }
        .bmr-page .brand small { display: block; font-size: 6.5pt; font-weight: 500; color: #555; }
        .bmr-page .sig-at { display: block; font-size: 6.5pt; color: #555; }
        .bmr-page .sig-empty { display: inline-block; min-width: 30mm; height: 10px; }
        .bmr-page .box { display: inline-block; width: 9px; height: 9px; border: 1px solid #222; margin-right: 4px; vertical-align: -1px; text-align: center; line-height: 8px; font-size: 8pt; }
        .bmr-page .muted { color: #555; font-size: 7.5pt; }
        .bmr-page .flag { font-weight: 700; }
        .bmr-qr svg { width: 22mm; height: 22mm; display: block; }
        .bmr-watermark { position: absolute; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 38pt; font-weight: 800; color: rgba(198, 40, 40, .13); white-space: nowrap; pointer-events: none; z-index: 0; }
        .bmr-content { position: relative; z-index: 1; }
        .bmr-screen-footer { margin-top: 10mm; border-top: 0.8px solid #999; padding-top: 4px; display: flex; justify-content: space-between; font-size: 7pt; color: #444; }
        @media print {
          .bmr-root { background: #fff; padding: 0; min-height: 0; }
          .bmr-page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; overflow: visible; }
          .bmr-watermark { position: fixed; }
          .bmr-screen-footer { display: none; }
        }
      `}</style>

      <div className="bmr-toolbar no-print">
        <Link href={`/production/${batch.id}`} className="text-[#23703f] underline">
          ← Back to batch {batch.batchNumber}
        </Link>
        <span>
          Document state: <b>{docState}</b>
        </span>
        <PrintButton />
      </div>

      <article className="bmr-page" aria-label={`Batch Manufacturing Record ${batch.batchNumber}`}>
        {!released && <div className="bmr-watermark" aria-hidden>DRAFT — batch not released</div>}
        <div className="bmr-content">
          <table>
            <tbody>
              <tr>
                <td colSpan={4} className="title">
                  BATCH MANUFACTURING RECORD
                </td>
              </tr>
              <tr>
                <td rowSpan={2} style={{ width: "24%", verticalAlign: "middle" }}>
                  <Logo tagline className="h-[52px] w-auto" />
                </td>
                <td colSpan={2}>
                  <span className="lbl">Product Name:</span>
                  <span className="val">{product.name.toUpperCase()}</span>
                  <span className="muted"> ({product.skuCode})</span>
                </td>
                <td style={{ width: "26%" }}>
                  <span className="lbl">Batch Number:</span>
                  <span className="val">{batch.batchNumber}</span>
                </td>
              </tr>
              <tr>
                <td>
                  <span className="lbl">Department:</span>
                  <span className="val">PRODUCTION</span>
                </td>
                <td>
                  <span className="lbl">Batch Formula No.:</span>
                  <span className="val">
                    {snapshot.formulaCode} rev {snapshot.revisionNo}
                  </span>
                </td>
                <td>
                  <span className="lbl">Batch Size:</span>
                  <span className="val">{fmtQty(batch.plannedSizeG, "g", 0)}</span>
                </td>
              </tr>
              <tr>
                <td colSpan={2}>
                  <span className="lbl">Start Date:</span>
                  <span className="val">{batch.startedAt ? fmtDate(batch.startedAt).toUpperCase() : ""}</span>
                  {!batch.startedAt && <span className="muted">Planned {fmtDate(batch.plannedStartOn)}</span>}
                </td>
                <td colSpan={2}>
                  <span className="lbl">End Date:</span>
                  <span className="val">{batch.completedAt ? fmtDate(batch.completedAt).toUpperCase() : ""}</span>
                </td>
              </tr>
            </tbody>
          </table>

          <h2>DISPENSING AND WEIGHING</h2>
          <table className="disp">
            <colgroup>
              <col style={{ width: "23%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Ingredient (INCI Name)</th>
                <th>Batch Number</th>
                <th>Expiration Date</th>
                <th className="num">Theoretical Weight/ Volume (g)</th>
                <th className="num">Actual Weigh/ Volume (g)</th>
                <th>Within tolerance</th>
                <th>Conducted by</th>
                <th>Checked by</th>
              </tr>
            </thead>
            <tbody>
              {rec.ingredients.map((i) => {
                const r = i.records[0];
                return (
                  <tr key={i.id}>
                    <td>
                      <b>{i.materialName}</b>
                      {i.inciName && <span className="muted" style={{ display: "block" }}>{i.inciName}</span>}
                      <span className="muted">
                        {i.materialCode} · tol ±{fmtQty(i.tolerancePct, "%", 2)}
                      </span>
                    </td>
                    <td className="nowrap">{r?.lotNumber ?? ""}</td>
                    <td>{r ? fmtDate(r.lotExpiresOn) : ""}</td>
                    <td className="num">{fmtQty(i.theoreticalQtyG, "", 1)}</td>
                    <td className="num">{r ? fmtQty(r.actualQtyG, "", 1) : ""}</td>
                    <td>{r ? (r.isWithinTolerance ? "✓ Yes" : <span className="flag">✗ No (exception)</span>) : ""}</td>
                    <td>
                      <Sig name={r?.operator} at={r?.recordedAt} />
                    </td>
                    <td>
                      <Sig name={r?.checker} />
                    </td>
                  </tr>
                );
              })}
              {Array.from({ length: fillerRows }).map((_, k) => (
                <tr key={`f${k}`}>
                  <td>&nbsp;</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
              <tr>
                <td colSpan={3}>
                  <b>TOTAL</b>
                </td>
                <td className="num">
                  <b>{fmtQty(rec.totals.theoreticalG, "", 1)}</b>
                </td>
                <td className="num">
                  <b>{D(rec.totals.actualG).gt(0) ? fmtQty(rec.totals.actualG, "", 1) : "-"}</b>
                </td>
                <td colSpan={3} className="muted">
                  Tolerances are placeholders pending process-owner approval.
                </td>
              </tr>
            </tbody>
          </table>

          <h2>PROCEDURE</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: "4%" }}>#</th>
                <th style={{ width: "40%" }}>Step and instruction</th>
                <th>Readings</th>
                <th>Conducted by</th>
                <th>Checked by</th>
              </tr>
            </thead>
            <tbody>
              {rec.steps.map((s) => (
                <tr key={s.stepNo}>
                  <td>{s.stepNo}</td>
                  <td>
                    <b>{s.name}</b>
                    {s.instruction && <span className="muted" style={{ display: "block" }}>{s.instruction}</span>}
                  </td>
                  <td>{s.record?.readings ?? ""}</td>
                  <td>
                    <Sig name={s.record?.conductedBy} at={s.record?.completedAt} />
                  </td>
                  <td>
                    <Sig name={s.record?.checkedBy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <td style={{ width: "38%" }}>
                  <span className="lbl">Theoretical Yield:</span>
                  <span className="val">{fmtQty(batch.theoreticalYieldG, "g", 0)}</span>
                  <span className="muted"> ({fmtQty(snapshot.theoreticalYieldPct, "%", 1)} of batch size)</span>
                </td>
                <td style={{ width: "32%" }}>
                  <span className="lbl">Actual Yield:</span>
                  {batch.actualOutputG ? (
                    <>
                      <span className="val">{fmtQty(batch.actualOutputG, "g", 0)}</span>
                      <span className="muted">
                        {" "}
                        ({fmtQty(batch.actualUnits, "pcs", 0)} × {fmtQty(product.unitNetMassG, "g", 0)}; {fmtQty(batch.yieldPct, "%", 2)})
                      </span>
                    </>
                  ) : null}
                </td>
                <td>
                  <span className="lbl">Expiration Date:</span>
                  <span className="val">{rec.outputLot ? fmtDate(rec.outputLot.expiresOn) : ""}</span>
                  {rec.outputLot && <span className="muted"> (lot {rec.outputLot.lotNumber})</span>}
                </td>
              </tr>
              <tr>
                <td colSpan={3}>
                  <span className="lbl">Test Results:</span>
                  {rec.tests.length === 0 ? (
                    <span className="muted">No results recorded.</span>
                  ) : (
                    <table style={{ marginTop: 3 }}>
                      <tbody>
                        {rec.tests.map((t) => (
                          <tr key={t.id}>
                            <td style={{ width: "34%" }}>{t.testName}</td>
                            <td>Spec: {t.specification}</td>
                            <td>Result: {t.result}</td>
                            <td style={{ width: "12%" }}>{t.passed ? "✓ Pass" : <span className="flag">✗ Fail</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td>
              </tr>
              <tr>
                <td>
                  <span className="lbl">Test Date:</span>
                  {testDate}
                </td>
                <td>
                  <span className="lbl">Conducted:</span>
                  {testers}
                </td>
                <td>
                  <span className="lbl">Checked By:</span>
                  <Sig name={disposition?.decidedByName} />
                </td>
              </tr>
              <tr>
                <td colSpan={3}>
                  <span className="lbl">Final Disposition:</span>
                  <span style={{ display: "inline-block", minWidth: "45%", marginLeft: "18%" }}>
                    <span className="box">{approved ? "✓" : ""}</span>Approved
                  </span>
                  <span>
                    <span className="box">{disapproved ? "✓" : ""}</span>Disapproved
                  </span>
                  {disposition?.reason && <span className="muted" style={{ display: "block" }}>Reason: {disposition.reason}</span>}
                </td>
              </tr>
              <tr>
                <td colSpan={2}>
                  <span className="lbl">Name and Signature of QA:</span>
                  {disposition ? <b>{disposition.decidedByName}</b> : null}
                  {disposition && <span className="muted"> (electronic attestation)</span>}
                </td>
                <td>
                  <span className="lbl">Date:</span>
                  {disposition ? fmtDateTime(disposition.decidedAt) : ""}
                </td>
              </tr>
              <tr>
                <td colSpan={3} style={{ minHeight: 40 }}>
                  <span className="lbl">Remarks:</span>
                  {batch.remarks ?? ""}
                  {exceptions.map(({ i, r }) => (
                    <span key={r.id} style={{ display: "block" }}>
                      Weighing exception, {i.materialName}: {fmtQty(r.actualQtyG, "g", 1)} vs {fmtQty(i.theoreticalQtyG, "g", 1)} (range {fmtQty(i.minG, "", 1)}–{fmtQty(i.maxG, "g", 1)}). Reason: {r.exceptionReason}
                    </span>
                  ))}
                  {!batch.remarks && exceptions.length === 0 && <span className="muted">None</span>}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: "flex", gap: "6mm", alignItems: "flex-start", marginTop: 10, breakInside: "avoid" }}>
            <div className="bmr-qr" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="muted" style={{ fontSize: "7.5pt" }}>
              <div>
                Scan: BC:DOC:{batch.batchNumber} · Status {docState} · Site {rec.batch.siteId ? ctx.allowedSites.find((s) => s.id === batch.siteId)?.code : ""}
              </div>
              <div>
                Formula snapshot {snapshot.formulaCode} rev {snapshot.revisionNo} taken {fmtDateTime(snapshot.takenAt ?? batch.createdAt)}; created by {rec.createdByName}.
              </div>
              <div>Printed copies are uncontrolled unless signed. Formula, tolerances and steps are demo values: verify with authorized personnel before production use.</div>
            </div>
          </div>

          <div className="bmr-screen-footer">
            <span>{footer}</span>
            <span>Page numbers appear when printed</span>
          </div>
        </div>
      </article>
    </div>
  );
}
