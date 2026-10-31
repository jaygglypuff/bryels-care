import { describe, expect, it } from "vitest";
import { labelFace } from "@/modules/documents/label-face";
import { labelRendererV1, type LabelData } from "@/modules/documents/renderers/label-v1";
import { labelGeometry, labelRendererV2, labelV2CssParts } from "@/modules/documents/renderers/label-v2";
import { renderFrozen, renderersForKind } from "@/modules/documents/renderers/registry";
import { decodeCode128FromSvg, decodeQrFromSvg } from "./decode-svg";
import { BAR, BOX, SACK, SHELF, frozen } from "./fixtures";

const def1 = labelRendererV1.defaultDefinition("label", "label/material/v1");
const def2 = labelRendererV2.defaultDefinition("label", "label/material/v1");
const render2 = (d: LabelData) => renderFrozen(def2, "label", frozen(d));

describe("label renderer v2: name first, everything inside the label (ADR-099)", () => {
  it("new label layouts get v2 by default; v1 stays for labels already printed", () => {
    expect(renderersForKind("label")[0]).toBe(labelRendererV2);
    expect(def2.renderer).toEqual({ id: "label", version: 2 });
    expect(renderFrozen(def1, "label", frozen(SACK)).checksumSha256).toBe("fa2034305c0d5c0245db049bb1f32b772ae7895135e1c2f2f195248d2b92256b");
  });

  it.each([[50, 30], [60, 40], [70, 40], [100, 50], [100, 150]])("%i × %i mm: QR square and text column fit inside; name > code > details", (w, h) => {
    const g = labelGeometry(w, h);
    expect(g.qr).toBeLessThanOrEqual(h - 2 * 1.5 - 2.2 - g.status - 0.8 + 1e-9);
    expect(g.qr).toBeLessThanOrEqual(w * 0.42 + 1e-9);
    expect(w - 3 - g.qr).toBeGreaterThan(20);
    expect(g.nameSize).toBeGreaterThan(g.idSize);
    expect(g.idSize).toBeGreaterThan(g.rowSize);
    const css = labelV2CssParts(w, h).face;
    expect(css).toContain("grid-template-rows: minmax(0, 1fr) auto 2.2mm"); // status and trace are own rows
    expect(css).toMatch(/\.lbl \{ width: [\d.]+mm; height: [\d.]+mm;[^}]*overflow: hidden/);
  });

  const SMALL_SACK: LabelData = { ...SACK, label: { ...SACK.label, mediaWidthMm: 50, mediaHeightMm: 30 } };
  it.each([
    ["sack 100×50", SACK, "BC:LOT:L-2610-00001", ["Coconut Oil", "L-2610-00001", "22 Jun 2028", "QUARANTINE"]],
    ["sack 50×30", SMALL_SACK, "BC:LOT:L-2610-00001", ["Coconut Oil", "L-2610-00001", "22 Jun 2028", "QUARANTINE"]],
    ["bar 50×30", BAR, "BC:LOT:LOT-26-00042", ["Oat Milk Soap 100 g", "LOT-26-00042", "31 Oct 2028", "BM-2611-0001"]],
    ["shelf (Code 128)", SHELF, "BC:LOC:QUA-01", ["Quarantine rack 1", "QUA-01", "QUARANTINE"]],
    ["box", BOX, "BC:BOX:BX-00000001", ["Oat Milk Soap 100 g", "BX-00000001", "RELEASED"]],
  ] as const)("%s: the name comes before the code, and the code scans", (_n, d, payload, words) => {
    const body = render2(d).body.value;
    for (const w of words) expect(body).toContain(w);
    const nameAt = body.indexOf('class="lbl-name"');
    expect(nameAt).toBeGreaterThan(0);
    expect(nameAt).toBeLessThan(body.indexOf('class="lbl-key"'));
    expect(d.label.symbology === "code128" ? decodeCode128FromSvg(body) : decodeQrFromSvg(body)).toBe(payload);
  });

  it("a product label (bar) has no status bar and no bulk quantity", () => {
    const body = render2(BAR).body.value;
    expect(body).not.toMatch(/lbl-status|QUARANTINE|RELEASED|Qty/);
  });

  it("the face CSS taken from either renderer's stylesheet has no @page or print rules", () => {
    for (const out of [renderFrozen(def1, "label", frozen(SACK)), render2(SACK)]) {
      const f = labelFace(SACK, out.body.value, out.css);
      expect(f.css.split("\n@page lf_")[0]).not.toMatch(/@page|@media/);
      expect(f.css).toContain("@page lf_100x50 { size: 100mm 50mm; margin: 0; }");
    }
  });
});
