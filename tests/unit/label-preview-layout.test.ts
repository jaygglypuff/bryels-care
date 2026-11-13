/**
 * ADR-132 §11 (round 5 A report, label and pack previews): the label's layout code and version are not shown to floor
 * people on screen (they still print small in the label's footer); QA and layout editors find them under "More
 * details".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabelPreview } from "@/ui/labels/label-preview";

(globalThis as unknown as { React: typeof React }).React = React;
const root = path.resolve(__dirname, "../..");
const face = { sizeKey: "lf-100x50", widthMm: 100, heightMm: 50, css: "", body: '<article class="lbl"><div class="lbl-foot"><span>LBL-SACK v3</span><span>T1</span></div></article>', payload: "BC:LOT:L-1", copies: 1 };

describe("label preview", () => {
  it("shows no layout details without the layout (floor)", () => {
    const html = renderToStaticMarkup(createElement(LabelPreview, { kind: "sack", data: face }));
    expect(html).not.toContain("More details</summary>");
  });

  it("shows the layout under More details when given (QA)", () => {
    const html = renderToStaticMarkup(createElement(LabelPreview, { kind: "sack", data: face, layout: { code: "LBL-SACK", name: "Sack label", versionNo: 3 } }));
    expect(html).toContain("More details</summary>");
    expect(html).toContain("version 3");
  });

  it("hides the footer's layout code and version on screen only", () => {
    const src = readFileSync(path.join(root, "src/ui/labels/label-face.tsx"), "utf8");
    const screen = src.slice(src.indexOf("@media screen"), src.indexOf("@media print"));
    expect(screen).toContain(".lf-face .lbl-foot > span:first-child { visibility: hidden; }");
    expect(src.slice(src.indexOf("@media print"))).not.toContain("lbl-foot");
  });

  it("the service decides who sees the layout: QA and layout editors, not the floor", () => {
    const src = readFileSync(path.join(root, "src/modules/documents/label-preview.ts"), "utf8");
    expect(src).toContain('showLayout: ctx.can("quality.disposition.view") || ctx.can("documents.template.edit")');
    expect(readFileSync(path.join(root, "src/ui/labels/label-print-card.tsx"), "utf8")).toContain("layout={preview.showLayout ? opt.layout : null}");
  });
});
