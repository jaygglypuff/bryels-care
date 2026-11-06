import { describe, expect, it } from "vitest";
import type { BmrData } from "@/modules/documents/renderers/bmr-data";
import { defaultBmrDefinition } from "@/modules/documents/renderers/bmr-v1";
import { bmrRendererV2, bmrRunningHeader, defaultBmrDefinitionV2 } from "@/modules/documents/renderers/bmr-v2";
import { checkDefinition, findRenderer, renderFrozen, renderersForKind } from "@/modules/documents/renderers/registry";
import type { DocumentMeta } from "@/modules/documents/renderers/types";

/** BMR renderer v2 (owner 2026-11: clean A4 print in Chrome). Fictional data. */

const meta: DocumentMeta = {
  documentNumber: "DOC-26-0000099",
  documentKind: "bmr",
  templateCode: "BMR-STD",
  templateName: "Batch Manufacturing Record",
  templateVersionNo: 2,
  definitionChecksum: "a".repeat(64),
  watermark: "CONTROLLED COPY",
  recordRevisionNo: 3,
  reprintNo: 0,
  reprintOfNumber: null,
  sourceRevisionAt: "2026-10-16T03:00:00.000Z",
  sourceState: "closed",
  generatedAt: "16 Oct 2026, 11:05",
  generatedByName: "Dino Reyes",
  siteCode: "NFD",
  organizationName: "Bryel's Care Corporation (demo)",
  traceRef: "ABCDEF12",
};

function data(over: Partial<BmrData> = {}): BmrData {
  const rec = { lotNumber: "L-2611-00001", supplierLot: "LOS-1", expiryText: "23 Jun 2028", actualText: "3,723.2", withinTolerance: true, scale: "SC-01", operator: "Rhea Mendoza", at: "14 Oct 2026, 09:00", checker: "Jun Dela Cruz", operatorRole: "Production Operator", checkerRole: "Production Operator", checkedAt: "14 Oct 2026, 09:05", exceptionReason: null, struck: false, struckReason: null };
  return {
    schema: "bmr/v1",
    batch: { id: "01a197b0-a2fe-7909-a2a6-8b4878cbab41", number: "B-26-0001", statusCode: "closed", statusLabel: "CLOSED", productName: "Acapulco Soap 135 g", productCode: "ACS-135", department: "PRODUCTION", formulaLabel: "F-ACS-01 rev 1", routingLabel: "R-ACS-01 rev 1", inspectionPlanLabel: null, batchSizeText: "17,600 g", plannedStartText: null, startText: "14 OCT 2026", endText: "14 OCT 2026", siteCode: "NFD", createdBy: "Dino Reyes", snapshotTakenText: "13 Oct 2026, 15:00", reopenCount: 0, closedText: "16 Oct 2026, 11:00", lotNumber: "L-2611-00015", revisionText: "16 Oct 2026, 11:00" },
    summary: { stepsDone: 2, stepsTotal: 2, openDeviations: 0, holds: [] },
    materials: { groups: [{ phase: null, lines: [{ lineNo: 1, name: "Coconut Oil", inci: "Cocos Nucifera (Coconut) Oil", code: "MAT-0012", toleranceText: "± 0.5 % (3,704.6 – 3,741.8 g)", theoreticalText: "3,723.2", actualText: "3,723.2", status: "dispensed", records: [rec] }], totalTheoreticalText: "3,723.2", totalActualText: "3,723.2" }], totalTheoreticalText: "3,723.2", totalActualText: "3,723.2", roundingNote: null, toleranceNote: "Tolerances are configuration." },
    steps: [
      { stepNo: 1, name: "Weigh the ingredients", kindLabel: "dispensing", mode: "electronic", instruction: "One person weighs, a second person checks.", workInstruction: null, readings: null, conducted: { name: "Rhea Mendoza", at: "14 Oct 2026, 09:10", role: "Production Operator" }, checked: { name: "Jun Dela Cruz", at: "14 Oct 2026, 09:12", role: "Production Operator" }, startText: "14 Oct 2026, 08:50", endText: "14 Oct 2026, 09:12", statusText: "Done", notes: null },
      { stepNo: 2, name: "Heat and mix", kindLabel: "process", mode: "electronic", instruction: null, workInstruction: null, readings: null, conducted: { name: "Rhea Mendoza", at: "14 Oct 2026, 11:00", role: "Production Operator" }, checked: null, startText: "14 Oct 2026, 10:00", endText: "14 Oct 2026, 11:00", statusText: "Done", notes: null },
    ],
    lineClearance: { available: true, rows: [] },
    parameters: { available: true, rows: [{ stepNo: 2, parameter: "Mix temperature", uom: "°C", limits: "min 45 · max 55", value: "48", within: true, by: "Rhea Mendoza", at: "14 Oct 2026, 10:30", struck: false, struckReason: null }] },
    equipment: { available: true, rows: [{ stepNo: 2, code: "MX-01", name: "Mixer", calibrationDue: "1 Dec 2026", cleaning: "Clean", operator: "Rhea Mendoza", at: "14 Oct 2026, 10:00", exception: null }] },
    packaging: { available: true, rows: [] },
    outputYield: { theoreticalText: "16,720 g (95.0 % of batch size)", actualText: "16,740 g", detailText: "(124 pcs × 135 g; 100.12 %)", expiryText: "13 Oct 2028", outputLot: "L-2611-00015", yieldRecord: { available: true, rows: [] }, outputs: { available: true, rows: [] } },
    qc: { tests: [{ name: "pH (10% solution)", spec: "9.0 – 10.5", result: "9.8", passed: true, testedBy: "Nina Quiambao", at: "15 Oct 2026, 10:00" }], testDateText: "15 Oct 2026", conductedBy: "Nina Quiambao", checkedBy: "Teresa Ocampo", inspections: { available: true, rows: [] } },
    deviations: { available: true, rows: [] },
    exceptions: [],
    materialChanges: ["Palm Oil: lot changed from L-2611-00002 to L-2611-00003 — first lot damaged, by Rhea Mendoza, Tue 14 Oct 09:20"],
    packagingLines: [{ name: "Acapulco wrapper", neededText: "124 pcs", takenText: "126 pcs", lots: "L-2611-00030 (126 pcs)" }],
    boxes: { summary: "3 boxes, 124 pcs in all", rows: [{ boxNo: 1, pieces: "48 pcs", number: "BOX-26-0001", status: "Packed" }] },
    labelsPrinted: [{ kind: "Product labels", copies: 124, status: "Printed", by: "Rhea Mendoza", at: "14 Oct 2026, 14:00", reprint: null }],
    disposition: { decision: "release", label: "Approved [release]", decidedBy: "Teresa Ocampo", decidedAt: "16 Oct 2026, 11:00", reason: "All within specification", decidedByRole: "QA/QC" },
    remarks: null,
    amendments: [],
    reopens: [],
    attachments: [],
    audit: [{ at: "13 Oct 2026, 15:00", actor: "Dino Reyes", event: "Status: new → Waiting to start", detail: null }],
    documents: [],
    controlledRecord: "paper",
    notice: "Formula values are configuration.",
    ...over,
  };
}

const render = (d = data(), def = defaultBmrDefinitionV2()) => renderFrozen(def, "bmr", { meta, data: d });

describe("BMR renderer v2", () => {
  it("is the default for new BMR templates; v1 stays registered so printed BMRs keep their checksum", () => {
    expect(renderersForKind("bmr")[0]).toBe(bmrRendererV2);
    expect(findRenderer("bmr", 1)).not.toBeNull();
    expect(checkDefinition(defaultBmrDefinitionV2(), "bmr").ok).toBe(true);
    // An old v1 definition still renders with v1 (no data-renderer marker of v2).
    expect(renderFrozen(defaultBmrDefinition(), "bmr", { meta, data: data() }).body.value).not.toContain("bmr-v2");
  });

  it("prints the seven parts in the owner's order, then the appendix", () => {
    const body = render().body.value;
    const titles = ["Batch identity and recipe version", "Dispensing and weighing", "Procedure", "Packaging and labels", "Yield", "Problems and changes", "QA decision and sign-offs", "Appendix A · Paper record pages", "Appendix B · Audit trail"];
    const at = titles.map((t) => body.indexOf(t));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, z) => a - z)).toEqual(at);
  });

  it("A4 portrait with company, product, batch and lot on every page and Page x of y (Chrome margin boxes)", () => {
    const css = render().css;
    expect(css).toContain("size: A4 portrait");
    expect(css).toContain("Bryel's Care Corporation (demo) · Batch Manufacturing Record");
    expect(css).toContain("Acapulco Soap 135 g · Batch B-26-0001 · Lot L-2611-00015");
    expect(css).toContain('"Page " counter(page) " of " counter(pages)');
    expect(css).toMatch(/thead \{ display: table-header-group; \}/);
    expect(css).toMatch(/tr \{ display: table-row; break-inside: avoid/);
    expect(css).toContain("font: 10pt/1.38");
  });

  it("signatures are name + role + time; steps show start, end, readings with units and OK range, machines", () => {
    const body = render().body.value;
    expect(body).toContain("<b>Rhea Mendoza</b><span class=\"small\">Production Operator · 14 Oct 2026, 09:00</span>");
    expect(body).toContain("Teresa Ocampo</b><span class=\"small\">QA/QC</span>");
    expect(body).toContain("14 Oct 2026, 08:50");
    expect(body).toContain("Mix temperature");
    expect(body).toContain("min 45 · max 55 °C");
    expect(body).toContain("48 °C");
    expect(body).toContain("Mixer");
  });

  it("packaging, boxes, labels printed and material changes are on the record", () => {
    const body = render().body.value;
    expect(body).toContain("Acapulco wrapper");
    expect(body).toContain("Boxes: 3 boxes, 124 pcs in all");
    expect(body).toContain("Labels printed");
    expect(body).toContain("lot changed from L-2611-00002 to L-2611-00003");
  });

  it("keeps the QA-approved paper wording", () => {
    const body = render().body.value;
    for (const w of ["BATCH MANUFACTURING RECORD", "Product Name:", "Batch Number:", "Batch Formula No.:", "Batch Size:", "Start Date:", "End Date:", "Ingredient (INCI Name)", "Theoretical Weight/ Volume (g)", "Actual Weigh/ Volume (g)", "Conducted by", "Checked by", "Theoretical Yield:", "Actual Yield:", "Expiration Date:", "Test Results:", "Final Disposition:", "Approved", "Disapproved", "Name and Signature of QA:", "Remarks:"]) {
      expect(body, w).toContain(w);
    }
  });

  it("older datasets without the v2 fields still render (optional fields)", () => {
    const d = data();
    delete d.materialChanges;
    delete d.packagingLines;
    delete d.boxes;
    delete d.labelsPrinted;
    const body = render(d).body.value;
    expect(body).toContain("Packaging and labels");
    expect(body).toContain("Nothing recorded yet.");
  });

  it("is deterministic: same input, same checksum", () => {
    expect(render().checksumSha256).toBe(render().checksumSha256);
  });

  it("bmrRunningHeader leaves the lot out until there is one", () => {
    const d = data();
    expect(bmrRunningHeader({ batch: { ...d.batch, lotNumber: null }, outputYield: { ...d.outputYield, outputLot: null } })).toBe("Acapulco Soap 135 g · Batch B-26-0001");
  });
});
