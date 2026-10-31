import { describe, expect, it } from "vitest";
import { decodeCode128FromSvg, decodeQrFromSvg } from "./decode-svg";
import { labelFace, scopeCss, sizeKeyOf } from "@/modules/documents/label-face";
import { labelCssParts, labelRendererV1, type LabelData } from "@/modules/documents/renderers/label-v1";
import { renderFrozen } from "@/modules/documents/renderers/registry";
import { parseScan } from "@/lib/scan/payload";
import { BAR, BOX, SACK, SHELF, frozen } from "./fixtures";

const def = labelRendererV1.defaultDefinition("label", "label/material/v1");
const render = (d: LabelData) => renderFrozen(def, "label", frozen(d));

describe("label renderer v1 stays byte-identical (stored labels keep their checksum, ADR-099)", () => {
  it.each([
    ["SACK", SACK, "fa2034305c0d5c0245db049bb1f32b772ae7895135e1c2f2f195248d2b92256b"],
    ["BAR", BAR, "dfc0c1bbe8b988ffd947166b93dd3a7dc1fec259595a029091f3d1dd92193d52"],
    ["SHELF", SHELF, "c3f5adcbc71fe37540ce3e9d1036b609a1c04354f671e0e3c599432c637ca095"],
    ["BOX", BOX, "800da1d7bded8aaf2dd0af3a7fed4755e083a269ded3b4d0657c64f3a70fd3f5"],
  ] as const)("%s checksum unchanged", (_n, d, hash) => {
    expect(render(d).checksumSha256).toBe(hash);
  });

  it("the stylesheet is exactly page + face + print rules", () => {
    const { page, face, print } = labelCssParts(100, 50);
    expect(render(SACK).css).toBe(`\n${page}\n${face}\n${print}`);
    expect(face).not.toMatch(/@page|@media/);
  });
});

describe("label face: the one render used by preview and print", () => {
  it("scopes every rule to the label size, so two sizes on one page never clash", () => {
    const r = render(SACK);
    const f = labelFace(SACK, r.body.value, r.css);
    const rules = f.css.split("@page")[0].match(/[^{}]+\{/g) ?? [];
    expect(rules.length).toBeGreaterThan(10);
    for (const r of rules) expect(r.trim().startsWith(`.${sizeKeyOf(100, 50)} `)).toBe(true);
    expect(f.css).toContain("@page lf_100x50 { size: 100mm 50mm; margin: 0; }");
    expect(f.css).toContain(".lf-face.lf-100x50 { page: lf_100x50; }");
    expect(sizeKeyOf(50, 30)).not.toBe(sizeKeyOf(100, 50));
    expect(scopeCss(".a { x: 1; } .b c { y: 2; }", "s")).toBe(".s .a { x: 1; } .s .b c { y: 2; }");
  });

  it("keeps the renderer's body untouched and reports what the code encodes", () => {
    const out = render(SACK);
    const f = labelFace(SACK, out.body.value, out.css);
    expect(f.body).toBe(out.body.value);
    expect(f.payload).toBe("BC:LOT:L-2610-00001");
    expect(f.copies).toBe(3);
    expect(f.body.match(/<article class="lbl"/g)).toHaveLength(3);
  });
});

describe("label content per kind: readable words and a code that scans to the record", () => {
  const cases = [
    { name: "sack (raw material lot)", d: SACK, payload: "BC:LOT:L-2610-00001", words: ["RAW MATERIAL", "L-2610-00001", "Coconut Oil", "22 Jun 2028", "25 kg", "Cool, dry place", "QUARANTINE"] },
    { name: "bar (batch product label)", d: BAR, payload: "BC:LOT:LOT-26-00042", words: ["Oat Milk Soap 100 g", "LOT-26-00042", "BM-2611-0001", "Made", "31 Oct 2026", "Expiry", "31 Oct 2028", "Keep dry"] },
    { name: "shelf (location)", d: SHELF, payload: "BC:LOC:QUA-01", words: ["LOCATION", "QUA-01", "Quarantine rack 1", "WH1", "QUARANTINE, ON HOLD"] },
    { name: "box (container)", d: BOX, payload: "BC:BOX:BX-00000001", words: ["BOX", "BX-00000001", "Oat Milk Soap 100 g", "48 pcs", "1 of 3", "RELEASED"] },
  ];
  it.each(cases)("$name", ({ d, payload, words }) => {
    const body = render(d).body.value;
    for (const w of words) expect(body).toContain(w);
    expect(body).toContain(`data-payload="${payload}"`);
    const decoded = d.label.symbology === "code128" ? decodeCode128FromSvg(body) : decodeQrFromSvg(body);
    expect(decoded).toBe(payload);
    const parsed = parseScan(decoded);
    expect(parsed).toMatchObject({ kind: "typed", type: payload.split(":")[1], value: d.entity.value });
  });

  it("the product label of a bar carries no quality status word (it goes on the product)", () => {
    expect(render(BAR).body.value).not.toMatch(/QUARANTINE|RELEASED|STATUS AT PRINT/);
  });
});
