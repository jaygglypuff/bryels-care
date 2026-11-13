import { describe, expect, it } from "vitest";
import { defaultBmrPaperPageDefinition } from "@/modules/documents/renderers/bmr-paper-page-v1";
import { composePaperPack } from "@/modules/production/paper-pack-html";
import { renderFrozen } from "@/modules/documents/renderers/registry";
import type { DocumentMeta } from "@/modules/documents/renderers/types";

/**
 * ADR-134: the paper batch record pack. Each page of the pack is a `bmr_paper_page` document; a page of the weighing
 * step lists every ingredient with blank boxes, the last page lists the finish counts. A page issued before ADR-134
 * (no weighing lines, no finish counts) renders to exactly the same text, so its checksum still matches. Fictional data.
 */
const meta: DocumentMeta = {
  documentNumber: "DOC-26-0000201",
  documentKind: "bmr_paper_page",
  templateCode: "BMR-PAPER",
  templateName: "BMR paper page",
  templateVersionNo: 1,
  definitionChecksum: "c".repeat(64),
  watermark: null,
  recordRevisionNo: 1,
  reprintNo: 0,
  reprintOfNumber: null,
  sourceRevisionAt: "2026-11-13T01:00:00.000Z",
  sourceState: "planned",
  generatedAt: "13 Nov 2026, 09:00",
  generatedByName: "Lito Pascual",
  siteCode: "NFD",
  organizationName: "Bryel's Care Corporation (demo)",
  traceRef: "ABCDEF12",
};
const base = {
  schema: "bmr_paper_page/v1" as const,
  batch: { id: "0190c3a2-0000-7000-8000-000000000001", number: "B-26-0099", productName: "Acapulco Soap 135 g", productCode: "ACS-135", formulaLabel: "F-ACS-01 rev 1", routingLabel: "R-ACS-01 rev 1", siteCode: "NFD", batchSizeText: "17,600 g" },
  page: {
    reference: "B-26-0099-P02",
    pageNo: 2,
    stepNo: 2,
    stepName: "Weigh the oils",
    kindLabel: "dispensing",
    mode: "electronic",
    instruction: "Weigh each ingredient.",
    workInstruction: null,
    parameters: [{ name: "Room temperature", uom: "°C", limits: "min 18 · max 30" }],
    checklist: [{ itemNo: 1, text: "Scale is clean" }],
    issuedBy: "Lito Pascual",
    issuedAt: "13 Nov 2026, 09:00",
  },
  notice: "Limits and procedure text are configuration to be verified by authorized personnel before production use.",
};

/** The definition stored on templates approved before ADR-134 (no weighing or finish sections listed). */
const OLD_DEFINITION = (() => {
  const d = defaultBmrPaperPageDefinition();
  return { ...d, sections: d.sections.filter((s) => ["parameters", "checklist", "notes", "signatures"].includes(s.id)) };
})();

const weighings = [
  { lineNo: 1, materialName: "Coconut Oil", materialCode: "MAT-0012", targetText: "3,723.2 g", toleranceText: "± 1.00 %", rangeText: "3,685.968 g – 3,760.432 g", needsCheck: true, lotHint: "L-2611-00001" },
  { lineNo: 2, materialName: "Palm Oil <refined>", materialCode: "MAT-0013", targetText: "1,861.6 g", toleranceText: "± 5 g", rangeText: "1,856.6 g – 1,866.6 g", needsCheck: false, lotHint: null },
];
const finishCounts = [{ label: "Good pieces made", uom: "pcs" }, { label: "Rejected pieces", uom: "pcs" }, { label: "Wrappers used", uom: "pcs" }];

describe("paper batch record pages (ADR-134)", () => {
  it("a page issued before ADR-134 renders to the same checksum (old and new template definitions)", () => {
    expect(renderFrozen(OLD_DEFINITION, "bmr", { meta, data: base }).checksumSha256).toBe("f661eb17e5aeb125f4715979057a62d583649c46071d79124e6fd420aeee4c68");
    expect(renderFrozen(defaultBmrPaperPageDefinition(), "bmr", { meta, data: base }).checksumSha256).toBe("f661eb17e5aeb125f4715979057a62d583649c46071d79124e6fd420aeee4c68");
  });

  it("a weighing page lists every ingredient with its target, allowed range and blank boxes to write in", () => {
    const r = renderFrozen(OLD_DEFINITION, "bmr", { meta, data: { ...base, page: { ...base.page, weighings, outageNote: "No internet? Write here, then type it in later." } } });
    const html = r.html;
    expect(html).toContain('data-testid="paper-weighings"');
    for (const w of ["Coconut Oil", "3,723.2 g", "3,685.968 g – 3,760.432 g", "± 5 g", "L-2611-00001"]) expect(html).toContain(w);
    // Escaped, never raw markup.
    expect(html).toContain("Palm Oil &lt;refined&gt;");
    for (const head of ["Lot number", "Weight", "Time", "Done by", "Checked by"]) expect(html).toContain(`${head}</th>`);
    expect(html).toContain("No internet? Write here, then type it in later.");
    // A line that needs no second person says so.
    expect(html).toContain("no check needed");
  });

  it("a finish page lists the counts to write in; QA can switch the new sections off", () => {
    const data = { ...base, page: { ...base.page, weighings, finishCounts } };
    const on = renderFrozen(OLD_DEFINITION, "bmr", { meta, data }).html;
    expect(on).toContain('data-testid="paper-finish-counts"');
    expect(on).toContain("Good pieces made");
    const def = defaultBmrPaperPageDefinition();
    expect(def.sections.map((s) => s.id)).toEqual(expect.arrayContaining(["weighings", "finish_counts"]));
    const off = { ...def, sections: def.sections.map((s) => (["weighings", "finish_counts"].includes(s.id) ? { ...s, enabled: false } : s)) };
    const html = renderFrozen(off, "bmr", { meta, data }).html;
    expect(html).not.toContain('data-testid="paper-weighings"');
    expect(html).not.toContain('data-testid="paper-finish-counts"');
  });

  it("the pack puts the pages one after another, each on its own sheet, and keeps every DOC number and QR", () => {
    const p1 = renderFrozen(OLD_DEFINITION, "bmr", { meta, data: base });
    const p2 = renderFrozen(OLD_DEFINITION, "bmr", { meta: { ...meta, documentNumber: "DOC-26-0000202" }, data: { ...base, page: { ...base.page, reference: "B-26-0099-P03", pageNo: 3 } } });
    const pack = composePaperPack({ batchNumber: "B-26-0099", productName: "Acapulco Soap <135 g>", pages: [{ css: p1.css, body: p1.body.value }, { css: p2.css, body: p2.body.value }] });
    expect(pack.startsWith("<!doctype html>")).toBe(true);
    expect(pack).toContain("Acapulco Soap &lt;135 g&gt;");
    expect(pack.match(/class="paper-pack-page"/g)).toHaveLength(2);
    expect(pack).toContain("break-before: page");
    expect(pack).toContain("BC:DOC:DOC-26-0000201");
    expect(pack).toContain("BC:DOC:DOC-26-0000202");
    // The margin boxes name the batch, not one page's reference (each page shows its own reference and QR in its body).
    expect(pack).toContain("@top-right");
    expect(pack).not.toContain("<script");
  });
});
